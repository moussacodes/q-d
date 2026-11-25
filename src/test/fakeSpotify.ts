import type { HttpRequest, HttpResponse } from '@/providers/spotify/config';
import type { PkceCrypto } from '@/providers/spotify/pkce';
import {
  createProviderCredentialStore,
  type ProviderCredentials,
} from '@/services/providerCredentials';
import type { SecureKeyValue } from '@/services/secureStore.types';

/**
 * A fake Spotify (accounts service and Web API) for tests. Nothing here talks
 * to the network. Tokens are obviously fake, and tests check they never reach
 * a log.
 */

/** The parts of Node's `crypto` the tests use (the project has no Node types). */
type NodeCrypto = {
  randomBytes(size: number): Uint8Array & { toString(encoding: 'base64url'): string };
  createHash(algorithm: 'sha256'): {
    update(data: string): { digest(encoding: 'base64' | 'base64url'): string };
  };
};

export const nodeCrypto = jest.requireActual<NodeCrypto>('crypto');

/** Node's crypto behind the `PkceCrypto` interface the app fills with expo-crypto. */
export const nodePkceCrypto: PkceCrypto = {
  randomBytes: (count) => new Uint8Array(nodeCrypto.randomBytes(count)),
  sha256Base64: async (text) => nodeCrypto.createHash('sha256').update(text).digest('base64'),
};

/** A memory SecureStore, with switches to make it fail. */
export function memorySecureStore() {
  const values = new Map<string, string>();
  const fail = { get: false, set: false, delete: false };
  const storage: SecureKeyValue = {
    persistent: true,
    getItem: async (key) => {
      if (fail.get) throw new Error('keychain locked');
      return values.get(key) ?? null;
    },
    setItem: async (key, value) => {
      if (fail.set) throw new Error('keychain full');
      values.set(key, value);
    },
    deleteItem: async (key) => {
      if (fail.delete) throw new Error('keychain busy');
      values.delete(key);
    },
  };
  return { storage, values, fail, store: createProviderCredentialStore(storage) };
}

export type FakeResponse = { status: number; body?: unknown; headers?: Record<string, string> };

export function response({ status, body, headers = {} }: FakeResponse): HttpResponse {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: async () =>
      body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
  };
}

export type RecordedCall = {
  method: string;
  url: string;
  /** Path after the host, without the query, e.g. `/v1/me/player`. */
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string | undefined;
};

function split(url: string): { path: string; query: Record<string, string> } {
  const match = /^https:\/\/[^/]+([^?]*)(?:\?(.*))?$/.exec(url);
  const query: Record<string, string> = {};
  for (const pair of (match?.[2] ?? '').split('&')) {
    if (!pair) continue;
    const [key, value = ''] = pair.split('=');
    query[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
  }
  return { path: match?.[1] ?? url, query };
}

export const FAKE_CLIENT_ID = '0123456789abcdef0123456789abcdef';
export const FAKE_REDIRECT = 'qd://spotify-auth';

type Scripted = {
  method: string;
  path: string;
  reply: FakeResponse | (() => FakeResponse | Promise<FakeResponse>) | 'network_error';
};

/**
 * Fake Spotify. Token requests mint numbered tokens (`fake-access-1`,
 * `fake-refresh-1`, …). Scripted replies (`script`) win over the defaults,
 * once each, in order. Unscripted Web API calls go to `handleApi`, which the
 * playback fake overrides; by default they answer 204.
 */
export function createFakeSpotify(options: { now?: () => number } = {}) {
  const now = options.now ?? (() => 1_000_000);
  const calls: RecordedCall[] = [];
  const scripted: Scripted[] = [];
  let minted = 0;
  /** The access tokens Spotify currently accepts. */
  const validAccess = new Set<string>();
  /** Refresh tokens Spotify currently accepts. */
  const validRefresh = new Set<string>();
  const secure = memorySecureStore();

  const mint = () => {
    minted += 1;
    const access = `fake-access-${minted}`;
    const refresh = `fake-refresh-${minted}`;
    validAccess.add(access);
    validRefresh.add(refresh);
    return { access, refresh };
  };

  const fake = {
    calls,
    secure,
    store: secure.store,
    validAccess,
    validRefresh,
    /** Spotify reports these scopes after a code exchange. */
    grantedScope:
      'user-read-playback-state user-modify-playback-state user-read-currently-playing' as
        string | undefined,
    /** Whether refresh responses include a new refresh token (rotation). */
    rotateRefreshTokens: true,
    /** The code the fake authorize page hands back. */
    authCode: 'fake-auth-code',
    /** Default Web API handler; tests and the playback fake replace it. */
    handleApi: (_call: RecordedCall): FakeResponse | Promise<FakeResponse> => ({ status: 204 }),

    script(method: string, path: string, reply: Scripted['reply']) {
      scripted.push({ method, path, reply });
    },

    /** Saves working credentials, as if the person had connected already. */
    async connectAccount(overrides: Partial<ProviderCredentials> = {}) {
      const { access, refresh } = mint();
      await secure.store.save('spotify', {
        accessToken: access,
        refreshToken: refresh,
        expiresAt: now() + 3_600_000,
        scope: fake.grantedScope,
        ...overrides,
      });
      return { access, refresh };
    },

    /** Spotify revokes every token, e.g. the person removed q’d from their account. */
    revokeAll() {
      validAccess.clear();
      validRefresh.clear();
    },

    /** Calls to the Web API only (not the accounts service). */
    apiCalls() {
      return calls.filter((call) => call.path.startsWith('/v1/'));
    },

    tokenCalls() {
      return calls.filter((call) => call.path === '/api/token');
    },

    fetch: async (url: string, init: HttpRequest): Promise<HttpResponse> => {
      const { path, query } = split(url);
      const call: RecordedCall = {
        method: init.method,
        url,
        path,
        query,
        headers: init.headers,
        body: init.body,
      };
      calls.push(call);

      const index = scripted.findIndex(
        (entry) => entry.method === init.method && path === entry.path,
      );
      if (index >= 0) {
        const [entry] = scripted.splice(index, 1);
        if (entry.reply === 'network_error') throw new TypeError('Network request failed');
        const reply = typeof entry.reply === 'function' ? await entry.reply() : entry.reply;
        return response(reply);
      }

      if (path === '/api/token') return response(tokenEndpoint(init.body ?? ''));

      const auth = init.headers.Authorization ?? '';
      const token = auth.replace(/^Bearer /, '');
      if (!validAccess.has(token)) {
        return response({
          status: 401,
          body: { error: { status: 401, message: 'The access token expired' } },
        });
      }
      return response(await fake.handleApi(call));
    },
  };

  function tokenEndpoint(body: string): FakeResponse {
    const form = split(`https://x/?${body}`).query;
    if (form.client_id !== FAKE_CLIENT_ID) {
      return { status: 400, body: { error: 'invalid_client' } };
    }
    if (form.client_secret !== undefined) {
      return { status: 400, body: { error: 'invalid_request' } };
    }
    if (form.grant_type === 'authorization_code') {
      if (form.code !== fake.authCode || form.redirect_uri !== FAKE_REDIRECT) {
        return { status: 400, body: { error: 'invalid_grant' } };
      }
      if (!form.code_verifier || form.code_verifier.length < 43) {
        return { status: 400, body: { error: 'invalid_request' } };
      }
      const { access, refresh } = mint();
      return {
        status: 200,
        body: {
          access_token: access,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: refresh,
          ...(fake.grantedScope !== undefined ? { scope: fake.grantedScope } : {}),
        },
      };
    }
    if (form.grant_type === 'refresh_token') {
      if (!validRefresh.has(form.refresh_token)) {
        return {
          status: 400,
          body: { error: 'invalid_grant', error_description: 'Refresh token revoked' },
        };
      }
      const { access, refresh } = mint();
      if (fake.rotateRefreshTokens) {
        validRefresh.delete(form.refresh_token);
      } else {
        validRefresh.delete(refresh);
      }
      return {
        status: 200,
        body: {
          access_token: access,
          token_type: 'Bearer',
          expires_in: 3600,
          ...(fake.rotateRefreshTokens ? { refresh_token: refresh } : {}),
        },
      };
    }
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  }

  return fake;
}

export type FakeSpotify = ReturnType<typeof createFakeSpotify>;

/**
 * A fake browser sheet. By default it "approves" and redirects back with the
 * fake code and the state from the authorize URL. Pass a function to return
 * something else.
 */
export function fakeAuthSession(
  fake: FakeSpotify,
  behave?: (
    authorizeUrl: string,
    state: string,
  ) => { type: 'success'; url: string } | { type: string },
) {
  const opened: { url: string; redirect: string }[] = [];
  const open = jest.fn(async (url: string, redirect: string) => {
    opened.push({ url, redirect });
    const state = split(url).query.state ?? '';
    if (behave) return behave(url, state);
    return {
      type: 'success' as const,
      url: `${FAKE_REDIRECT}?code=${encodeURIComponent(fake.authCode)}&state=${encodeURIComponent(state)}`,
    };
  });
  return { open, opened };
}

export { split as splitUrl };
