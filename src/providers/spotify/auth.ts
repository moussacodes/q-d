import { z } from 'zod';

import { log } from '@/services/logger';
import {
  credentialsExpired,
  type ProviderCredentials,
  type ProviderCredentialStore,
} from '@/services/providerCredentials';

import { ProviderError } from '../errors';
import type { ProviderErrorCode } from '../types';
import {
  encodeForm,
  readJson,
  SPOTIFY_AUTHORIZE_URL,
  SPOTIFY_SCOPES,
  SPOTIFY_TOKEN_URL,
  type FetchLike,
  type HttpResponse,
} from './config';
import { createPkcePair, createState, type PkceCrypto } from './pkce';

/**
 * Connecting a Spotify account: Authorization Code with PKCE, then token
 * storage and refresh. Built, untested on a device.
 *
 * - Tokens live only in the provider credential store (SecureStore on a
 *   phone, memory on the web). They never go to Supabase, and they're never
 *   logged: log entries here carry an HTTP status or Spotify's error code
 *   string, nothing else.
 * - There's no client secret. The client ID is public.
 */

/** Opens the system browser sheet and resolves when it redirects back (expo-web-browser). */
export type OpenAuthSession = (
  url: string,
  redirectUri: string,
) => Promise<{ type: 'success'; url: string } | { type: string }>;

export type SpotifyAuthDeps = {
  /** null when this build has no client ID: connecting reports `not_configured`. */
  clientId: string | null;
  redirectUri: string;
  fetch: FetchLike;
  crypto: PkceCrypto;
  openAuthSession: OpenAuthSession;
  store: ProviderCredentialStore;
  now?: () => number;
};

export type AuthorizeResult =
  | { type: 'authorized' }
  /** The person closed the sheet or declined. Nothing is stored. */
  | { type: 'cancelled' }
  | { type: 'failed'; code: ProviderErrorCode };

export interface SpotifyAuth {
  readonly configured: boolean;
  /** Runs the browser flow and stores the tokens. One flow at a time. */
  authorize(): Promise<AuthorizeResult>;
  /** Whether tokens are stored. Doesn't check them with Spotify. */
  hasCredentials(): Promise<boolean>;
  /** A usable access token, refreshed first if it has expired. */
  accessToken(): Promise<string>;
  /**
   * Spotify rejected `rejected` (401). Refreshes once and returns the new
   * token; a request that already refreshed doesn't call this again.
   */
  refreshAfterRejection(rejected: string): Promise<string>;
  /** Forgets the tokens, e.g. "Disconnect" or a revoked refresh token. */
  disconnect(): Promise<void>;
}

const authLog = log.child('spotify.auth');

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

/** Spotify's token endpoint errors look like `{ error: 'invalid_grant', error_description }`. */
function tokenErrorCode(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string' && /^[a-z_]{1,40}$/.test(error)) return error;
  }
  return undefined;
}

/** Splits a redirect URL's query (and fragment) by hand; RN's `URL` is incomplete. */
export function parseRedirect(url: string): Map<string, string> {
  const params = new Map<string, string>();
  const query = url.split('?').slice(1).join('?');
  for (const part of query.split(/[&#]/)) {
    if (!part) continue;
    const [rawKey, ...rest] = part.split('=');
    try {
      params.set(
        decodeURIComponent(rawKey.replace(/\+/g, ' ')),
        decodeURIComponent(rest.join('=').replace(/\+/g, ' ')),
      );
    } catch {
      // A malformed escape: skip the pair. A missing code or state fails later.
    }
  }
  return params;
}

export function buildAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  return `${SPOTIFY_AUTHORIZE_URL}?${encodeForm({
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: options.challenge,
    state: options.state,
    scope: SPOTIFY_SCOPES.join(' '),
  })}`;
}

/** Constant-time-ish string compare, so `state` checks don't leak by timing. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hasRequiredScopes(scope: string | undefined): boolean {
  // Spotify omits `scope` in some responses; then it granted what was asked.
  if (scope === undefined) return true;
  const granted = new Set(scope.split(/\s+/));
  return SPOTIFY_SCOPES.every((required) => granted.has(required));
}

export function createSpotifyAuth(deps: SpotifyAuthDeps): SpotifyAuth {
  const { clientId, redirectUri, fetch, crypto, openAuthSession, store } = deps;
  const now = deps.now ?? Date.now;
  let authorizing: Promise<AuthorizeResult> | null = null;
  let refreshing: Promise<string> | null = null;

  const fail = (code: ProviderErrorCode, message: string) =>
    new ProviderError(code, 'spotify', message);

  /** POSTs to the token endpoint. Throws `provider_unavailable` if Spotify can't be reached. */
  async function postToken(form: Record<string, string>): Promise<HttpResponse> {
    try {
      return await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encodeForm(form),
      });
    } catch {
      throw fail('provider_unavailable', 'Could not reach Spotify');
    }
  }

  function toCredentials(
    body: z.infer<typeof tokenResponseSchema>,
    previousRefreshToken?: string,
  ): ProviderCredentials {
    const refreshToken = body.refresh_token ?? previousRefreshToken;
    return {
      accessToken: body.access_token,
      ...(refreshToken ? { refreshToken } : {}),
      expiresAt: now() + Math.round(body.expires_in * 1000),
      ...(body.scope !== undefined ? { scope: body.scope } : {}),
    };
  }

  async function exchange(code: string, verifier: string): Promise<AuthorizeResult> {
    if (!clientId) return { type: 'failed', code: 'not_configured' };
    let response: HttpResponse;
    try {
      response = await postToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      });
    } catch {
      return { type: 'failed', code: 'provider_unavailable' };
    }
    const body = await readJson(response);
    if (response.status !== 200) {
      authLog.warn('Code exchange refused', {
        status: response.status,
        reason: tokenErrorCode(body),
      });
      if (response.status === 429) return { type: 'failed', code: 'rate_limited' };
      if (response.status >= 500) return { type: 'failed', code: 'provider_unavailable' };
      return { type: 'failed', code: 'auth_failed' };
    }
    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success || !parsed.data.refresh_token) {
      authLog.warn('Code exchange returned an unexpected body', { status: response.status });
      return { type: 'failed', code: 'auth_failed' };
    }
    if (!hasRequiredScopes(parsed.data.scope)) {
      authLog.warn('Spotify granted fewer scopes than q’d needs');
      return { type: 'failed', code: 'auth_failed' };
    }
    try {
      await store.save('spotify', toCredentials(parsed.data));
    } catch {
      return { type: 'failed', code: 'auth_failed' };
    }
    return { type: 'authorized' };
  }

  async function runAuthorize(): Promise<AuthorizeResult> {
    if (!clientId) return { type: 'failed', code: 'not_configured' };
    const { verifier, challenge } = await createPkcePair(crypto);
    const state = createState(crypto);
    const url = buildAuthorizeUrl({ clientId, redirectUri, challenge, state });

    let result: Awaited<ReturnType<OpenAuthSession>>;
    try {
      result = await openAuthSession(url, redirectUri);
    } catch (error) {
      authLog.warn('Could not open the Spotify sign-in sheet', { error });
      return { type: 'failed', code: 'auth_failed' };
    }
    // `cancel` (closed or declined in the sheet), `dismiss`, `locked`…
    if (result.type !== 'success' || !('url' in result)) return { type: 'cancelled' };

    const params = parseRedirect(result.url);
    const returnedState = params.get('state');
    // Checked before anything else, so a forged redirect can't even report
    // "cancelled". A mismatched state never reaches the token endpoint.
    if (!returnedState || !sameString(returnedState, state)) {
      authLog.warn('Spotify redirect state did not match');
      return { type: 'failed', code: 'auth_failed' };
    }
    const error = params.get('error');
    if (error === 'access_denied') return { type: 'cancelled' };
    if (error) {
      authLog.warn('Spotify authorization returned an error', {
        reason: /^[a-z_]{1,40}$/.test(error) ? error : 'other',
      });
      return { type: 'failed', code: 'auth_failed' };
    }
    const code = params.get('code');
    if (!code) return { type: 'failed', code: 'auth_failed' };
    return exchange(code, verifier);
  }

  async function refresh(): Promise<string> {
    const current = await store.load('spotify');
    if (!current) throw fail('needs_authorization', 'Spotify is not connected');
    if (!current.refreshToken || !clientId) {
      await store.clear('spotify').catch(() => {});
      throw fail('needs_authorization', 'Spotify needs to be connected again');
    }
    const response = await postToken({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: clientId,
    });
    const body = await readJson(response);
    if (response.status === 200) {
      const parsed = tokenResponseSchema.safeParse(body);
      if (parsed.success) {
        const next = toCredentials(parsed.data, current.refreshToken);
        try {
          await store.save('spotify', next);
        } catch {
          // Still usable for this run; the next launch refreshes again.
        }
        return next.accessToken;
      }
    }
    const reason = tokenErrorCode(body);
    authLog.warn('Token refresh failed', { status: response.status, reason });
    if (response.status === 429) throw fail('rate_limited', 'Spotify is rate limiting');
    if (response.status >= 500 || (response.status === 200 && reason === undefined)) {
      // Spotify's side failed; keep the tokens and try again later.
      throw fail('provider_unavailable', 'Spotify could not refresh the token');
    }
    // invalid_grant (revoked or rotated away), invalid_client…: reconnect.
    await store.clear('spotify').catch(() => {});
    throw fail('needs_authorization', 'Spotify needs to be connected again');
  }

  /** One refresh at a time; concurrent callers share it. */
  function refreshOnce(): Promise<string> {
    refreshing ??= refresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  return {
    configured: clientId !== null,

    authorize() {
      authorizing ??= runAuthorize().finally(() => {
        authorizing = null;
      });
      return authorizing;
    },

    async hasCredentials() {
      return (await store.load('spotify')) !== null;
    },

    async accessToken() {
      if (refreshing) return refreshing;
      const credentials = await store.load('spotify');
      if (!credentials) throw fail('needs_authorization', 'Spotify is not connected');
      if (credentialsExpired(credentials, now())) return refreshOnce();
      return credentials.accessToken;
    },

    async refreshAfterRejection(rejected) {
      if (refreshing) return refreshing;
      const credentials = await store.load('spotify');
      // Another request already refreshed: use its token.
      if (credentials && credentials.accessToken !== rejected) return credentials.accessToken;
      return refreshOnce();
    },

    async disconnect() {
      await store.clear('spotify');
    },
  };
}
