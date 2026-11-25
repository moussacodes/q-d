import {
  createFakeSpotify,
  FAKE_CLIENT_ID,
  FAKE_REDIRECT,
  fakeAuthSession,
  nodeCrypto,
  nodePkceCrypto,
  splitUrl,
  type FakeSpotify,
} from '@/test/fakeSpotify';

import { isProviderError } from '../errors';
import { buildAuthorizeUrl, createSpotifyAuth, parseRedirect, type OpenAuthSession } from './auth';
import { SPOTIFY_SCOPES } from './config';

const NOW = 1_000_000;

let fake: FakeSpotify;
let clock: number;

beforeEach(() => {
  clock = NOW;
  fake = createFakeSpotify({ now: () => clock });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function setup(options: { open?: OpenAuthSession; clientId?: string | null } = {}) {
  const session = fakeAuthSession(fake);
  const auth = createSpotifyAuth({
    clientId: options.clientId === undefined ? FAKE_CLIENT_ID : options.clientId,
    redirectUri: FAKE_REDIRECT,
    fetch: fake.fetch,
    crypto: nodePkceCrypto,
    openAuthSession: options.open ?? session.open,
    store: fake.store,
    now: () => clock,
  });
  return { auth, session };
}

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return isProviderError(error) ? error.code : error;
  }
  throw new Error('Expected a rejection');
}

describe('buildAuthorizeUrl', () => {
  it('asks for a code with an S256 challenge, the state and only the three player scopes', () => {
    const url = buildAuthorizeUrl({
      clientId: FAKE_CLIENT_ID,
      redirectUri: FAKE_REDIRECT,
      challenge: 'challenge-value',
      state: 'state-value',
    });
    const { path, query } = splitUrl(url);
    expect(url.startsWith('https://accounts.spotify.com/authorize?')).toBe(true);
    expect(path).toBe('/authorize');
    expect(query).toEqual({
      response_type: 'code',
      client_id: FAKE_CLIENT_ID,
      redirect_uri: FAKE_REDIRECT,
      code_challenge_method: 'S256',
      code_challenge: 'challenge-value',
      state: 'state-value',
      scope: 'user-read-playback-state user-modify-playback-state user-read-currently-playing',
    });
  });

  it('never asks for streaming, library, email, profile or playlist scopes', () => {
    expect([...SPOTIFY_SCOPES].sort()).toEqual([
      'user-modify-playback-state',
      'user-read-currently-playing',
      'user-read-playback-state',
    ]);
    expect(SPOTIFY_SCOPES.join(' ')).not.toMatch(/streaming|library|email|private|playlist/);
  });
});

describe('parseRedirect', () => {
  it('reads the query and decodes it', () => {
    const params = parseRedirect('qd://spotify-auth?code=a%2Bb&state=x+y');
    expect(params.get('code')).toBe('a+b');
    expect(params.get('state')).toBe('x y');
  });

  it('reads parameters after a fragment too, and survives bad escapes', () => {
    const params = parseRedirect(
      'exp://192.168.1.2:8081/--/spotify-auth?error=access_denied#state=s',
    );
    expect(params.get('error')).toBe('access_denied');
    expect(params.get('state')).toBe('s');
    expect(parseRedirect('qd://x?code=%E0%A4%A&state=ok').get('state')).toBe('ok');
    expect(parseRedirect('qd://spotify-auth').size).toBe(0);
  });
});

describe('authorize', () => {
  it('opens Spotify with PKCE, exchanges the code and stores the tokens', async () => {
    const { auth, session } = setup();
    expect(await auth.authorize()).toEqual({ type: 'authorized' });

    expect(session.opened).toHaveLength(1);
    const { query } = splitUrl(session.opened[0].url);
    expect(session.opened[0].redirect).toBe(FAKE_REDIRECT);
    expect(query.code_challenge_method).toBe('S256');

    const [exchange] = fake.tokenCalls();
    expect(exchange.method).toBe('POST');
    expect(exchange.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = splitUrl(`https://x/?${exchange.body}`).query;
    expect(form).toEqual({
      grant_type: 'authorization_code',
      code: 'fake-auth-code',
      redirect_uri: FAKE_REDIRECT,
      client_id: FAKE_CLIENT_ID,
      code_verifier: expect.stringMatching(/^[A-Za-z0-9\-_]{86}$/),
    });
    // The verifier sent with the code matches the challenge sent to the browser.
    expect(nodeCrypto.createHash('sha256').update(form.code_verifier).digest('base64url')).toBe(
      query.code_challenge,
    );
    expect(form).not.toHaveProperty('client_secret');

    expect(await fake.store.load('spotify')).toEqual({
      accessToken: 'fake-access-1',
      refreshToken: 'fake-refresh-1',
      expiresAt: NOW + 3_600_000,
      scope: fake.grantedScope,
    });
    expect(await auth.hasCredentials()).toBe(true);
  });

  it('uses a new verifier and state for every attempt', async () => {
    const { auth, session } = setup();
    await auth.authorize();
    await auth.authorize();
    const [first, second] = session.opened.map((open) => splitUrl(open.url).query);
    expect(first.state).not.toBe(second.state);
    expect(first.code_challenge).not.toBe(second.code_challenge);
  });

  it('runs one sign-in sheet at a time', async () => {
    const { auth, session } = setup();
    const [a, b] = await Promise.all([auth.authorize(), auth.authorize()]);
    expect(a).toEqual({ type: 'authorized' });
    expect(b).toBe(a);
    expect(session.open).toHaveBeenCalledTimes(1);
    expect(fake.tokenCalls()).toHaveLength(1);
  });

  it.each(['cancel', 'dismiss', 'locked'])(
    'treats a %s result as cancelled and stores nothing',
    async (type) => {
      const { auth } = setup({ open: async () => ({ type }) });
      expect(await auth.authorize()).toEqual({ type: 'cancelled' });
      expect(fake.calls).toHaveLength(0);
      expect(await auth.hasCredentials()).toBe(false);
    },
  );

  it('treats “Cancel” on Spotify’s page (access_denied) as cancelled', async () => {
    const session = fakeAuthSession(fake, (_url, state) => ({
      type: 'success',
      url: `${FAKE_REDIRECT}?error=access_denied&state=${state}`,
    }));
    const { auth } = setup({ open: session.open });
    expect(await auth.authorize()).toEqual({ type: 'cancelled' });
    expect(fake.calls).toHaveLength(0);
  });

  it.each([
    ['a different state', (state: string) => `?code=fake-auth-code&state=${state}x`],
    ['no state', () => '?code=fake-auth-code'],
    ['an empty state', () => '?code=fake-auth-code&state='],
    ['a forged access_denied', () => '?error=access_denied&state=attacker'],
  ])('rejects a redirect with %s and never exchanges the code', async (_name, tail) => {
    const session = fakeAuthSession(fake, (_url, state) => ({
      type: 'success',
      url: `${FAKE_REDIRECT}${tail(state)}`,
    }));
    const { auth } = setup({ open: session.open });
    expect(await auth.authorize()).toEqual({ type: 'failed', code: 'auth_failed' });
    expect(fake.tokenCalls()).toHaveLength(0);
    expect(await auth.hasCredentials()).toBe(false);
  });

  it('fails on another error or a missing code', async () => {
    for (const tail of ['?error=server_error', '?error=<script>', '']) {
      const session = fakeAuthSession(fake, (_url, state) => ({
        type: 'success',
        url: `${FAKE_REDIRECT}${tail ? `${tail}&` : '?'}state=${state}`,
      }));
      const { auth } = setup({ open: session.open });
      expect(await auth.authorize()).toEqual({ type: 'failed', code: 'auth_failed' });
    }
    expect(fake.tokenCalls()).toHaveLength(0);
  });

  it('fails if the sheet can’t open', async () => {
    const { auth } = setup({
      open: async () => {
        throw new Error('Another session is in progress');
      },
    });
    expect(await auth.authorize()).toEqual({ type: 'failed', code: 'auth_failed' });
  });

  it('reports not_configured without a client ID, and never opens a sheet', async () => {
    const open = jest.fn();
    const { auth } = setup({ clientId: null, open });
    expect(auth.configured).toBe(false);
    expect(await auth.authorize()).toEqual({ type: 'failed', code: 'not_configured' });
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    [400, { error: 'invalid_grant' }, 'auth_failed'],
    [400, 'not json', 'auth_failed'],
    [429, undefined, 'rate_limited'],
    [500, undefined, 'provider_unavailable'],
    [503, { error: 'temporarily_unavailable' }, 'provider_unavailable'],
  ] as const)('maps a %i code exchange to %p', async (status, body, code) => {
    fake.script('POST', '/api/token', { status, body });
    const { auth } = setup();
    expect(await auth.authorize()).toEqual({ type: 'failed', code });
    expect(await auth.hasCredentials()).toBe(false);
  });

  it('fails when the exchange can’t reach Spotify', async () => {
    fake.script('POST', '/api/token', 'network_error');
    const { auth } = setup();
    expect(await auth.authorize()).toEqual({ type: 'failed', code: 'provider_unavailable' });
  });

  it.each([
    ['no access token', { token_type: 'Bearer', expires_in: 3600, refresh_token: 'r' }],
    ['no refresh token', { access_token: 'a', token_type: 'Bearer', expires_in: 3600 }],
    ['no expiry', { access_token: 'a', refresh_token: 'r' }],
  ])('rejects an exchange with %s', async (_name, body) => {
    fake.script('POST', '/api/token', { status: 200, body });
    const { auth } = setup();
    expect(await auth.authorize()).toEqual({ type: 'failed', code: 'auth_failed' });
    expect(await auth.hasCredentials()).toBe(false);
  });

  it('rejects a grant missing a scope q’d needs', async () => {
    fake.grantedScope = 'user-read-playback-state';
    const { auth } = setup();
    expect(await auth.authorize()).toEqual({ type: 'failed', code: 'auth_failed' });
    expect(await auth.hasCredentials()).toBe(false);
  });

  it('accepts a grant that omits the scope field', async () => {
    fake.grantedScope = undefined;
    const { auth } = setup();
    expect(await auth.authorize()).toEqual({ type: 'authorized' });
  });

  it('fails if SecureStore can’t save', async () => {
    fake.secure.fail.set = true;
    const { auth } = setup();
    expect(await auth.authorize()).toEqual({ type: 'failed', code: 'auth_failed' });
  });
});

describe('tokens', () => {
  it('returns the stored access token while it’s fresh, without calling Spotify', async () => {
    const { auth } = setup();
    await fake.connectAccount();
    expect(await auth.accessToken()).toBe('fake-access-1');
    expect(fake.calls).toHaveLength(0);
  });

  it('refreshes an expired token (or one about to expire) before using it', async () => {
    const { auth } = setup();
    await fake.connectAccount({ expiresAt: NOW + 30_000 });
    expect(await auth.accessToken()).toBe('fake-access-2');
    const [refresh] = fake.tokenCalls();
    expect(splitUrl(`https://x/?${refresh.body}`).query).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'fake-refresh-1',
      client_id: FAKE_CLIENT_ID,
    });
    expect(await fake.store.load('spotify')).toEqual({
      accessToken: 'fake-access-2',
      refreshToken: 'fake-refresh-2',
      expiresAt: NOW + 3_600_000,
    });
  });

  it('keeps the old refresh token when Spotify doesn’t send a new one', async () => {
    fake.rotateRefreshTokens = false;
    const { auth } = setup();
    await fake.connectAccount({ expiresAt: NOW - 1 });
    await auth.accessToken();
    expect((await fake.store.load('spotify'))?.refreshToken).toBe('fake-refresh-1');
  });

  it('shares one refresh between concurrent callers', async () => {
    const { auth } = setup();
    await fake.connectAccount({ expiresAt: NOW - 1 });
    const tokens = await Promise.all([
      auth.accessToken(),
      auth.accessToken(),
      auth.refreshAfterRejection('fake-access-1'),
    ]);
    expect(tokens).toEqual(['fake-access-2', 'fake-access-2', 'fake-access-2']);
    expect(fake.tokenCalls()).toHaveLength(1);
  });

  it('after a 401, uses a token another request already refreshed', async () => {
    const { auth } = setup();
    await fake.connectAccount();
    expect(await auth.refreshAfterRejection('fake-access-1')).toBe('fake-access-2');
    expect(await auth.refreshAfterRejection('fake-access-1')).toBe('fake-access-2');
    expect(fake.tokenCalls()).toHaveLength(1);
  });

  it('with nothing stored, says to connect', async () => {
    const { auth } = setup();
    expect(await errorCode(auth.accessToken())).toBe('needs_authorization');
    expect(await errorCode(auth.refreshAfterRejection('x'))).toBe('needs_authorization');
  });

  it('a revoked refresh token clears the tokens and says to reconnect', async () => {
    const { auth } = setup();
    await fake.connectAccount({ expiresAt: NOW - 1 });
    fake.revokeAll();
    expect(await errorCode(auth.accessToken())).toBe('needs_authorization');
    expect(await auth.hasCredentials()).toBe(false);
  });

  it('credentials without a refresh token are cleared when they expire', async () => {
    const { auth } = setup();
    await fake.connectAccount({ expiresAt: NOW - 1, refreshToken: undefined });
    expect(await errorCode(auth.accessToken())).toBe('needs_authorization');
    expect(await auth.hasCredentials()).toBe(false);
    expect(fake.tokenCalls()).toHaveLength(0);
  });

  it.each([
    [500, 'provider_unavailable'],
    [503, 'provider_unavailable'],
    [429, 'rate_limited'],
  ] as const)('a %i refresh keeps the tokens (%s)', async (status, code) => {
    const { auth } = setup();
    await fake.connectAccount({ expiresAt: NOW - 1 });
    fake.script('POST', '/api/token', { status });
    expect(await errorCode(auth.accessToken())).toBe(code);
    expect(await auth.hasCredentials()).toBe(true);
    // The next try works.
    expect(await auth.accessToken()).toBe('fake-access-2');
  });

  it('a refresh that can’t reach Spotify keeps the tokens', async () => {
    const { auth } = setup();
    await fake.connectAccount({ expiresAt: NOW - 1 });
    fake.script('POST', '/api/token', 'network_error');
    expect(await errorCode(auth.accessToken())).toBe('provider_unavailable');
    expect(await auth.hasCredentials()).toBe(true);
  });

  it('a 200 refresh with a broken body keeps the tokens', async () => {
    const { auth } = setup();
    await fake.connectAccount({ expiresAt: NOW - 1 });
    fake.script('POST', '/api/token', { status: 200, body: { nope: true } });
    expect(await errorCode(auth.accessToken())).toBe('provider_unavailable');
    expect(await auth.hasCredentials()).toBe(true);
  });

  it('a refreshed token that SecureStore can’t save still works for now', async () => {
    const { auth } = setup();
    await fake.connectAccount({ expiresAt: NOW - 1 });
    fake.secure.fail.set = true;
    expect(await auth.accessToken()).toBe('fake-access-2');
  });

  it('a locked keychain reads as not connected', async () => {
    const { auth } = setup();
    await fake.connectAccount();
    fake.secure.fail.get = true;
    expect(await auth.hasCredentials()).toBe(false);
    expect(await errorCode(auth.accessToken())).toBe('needs_authorization');
  });
});

describe('disconnect', () => {
  it('clears the tokens from SecureStore', async () => {
    const { auth } = setup();
    await auth.authorize();
    expect(fake.secure.values.size).toBe(1);
    await auth.disconnect();
    expect(fake.secure.values.size).toBe(0);
    expect(await auth.hasCredentials()).toBe(false);
    expect(await errorCode(auth.accessToken())).toBe('needs_authorization');
  });

  it('reports a failed delete', async () => {
    const { auth } = setup();
    await fake.connectAccount();
    fake.secure.fail.delete = true;
    await expect(auth.disconnect()).rejects.toThrow('Could not delete credentials.');
  });
});

describe('review: edge cases', () => {
  it('a Disconnect during a refresh isn’t undone when the refresh comes back', async () => {
    const { auth } = setup();
    await fake.connectAccount({ expiresAt: NOW - 1 });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.script('POST', '/api/token', async () => {
      await gate;
      return {
        status: 200,
        body: { access_token: 'late-access', expires_in: 3600, refresh_token: 'late-refresh' },
      };
    });
    const pending = errorCode(auth.accessToken());
    // Let the refresh reach the token endpoint, then disconnect.
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    await auth.disconnect();
    release();
    expect(await pending).toBe('needs_authorization');
    expect(await auth.hasCredentials()).toBe(false);
    expect(fake.secure.values.size).toBe(0);
  });

  it('a refused refresh with invalid_client also clears the tokens', async () => {
    const { auth } = setup();
    await fake.connectAccount({ expiresAt: NOW - 1 });
    fake.script('POST', '/api/token', { status: 400, body: { error: 'invalid_client' } });
    expect(await errorCode(auth.accessToken())).toBe('needs_authorization');
    expect(await auth.hasCredentials()).toBe(false);
  });

  it('a rotated refresh token is the one used next time', async () => {
    const { auth } = setup();
    await fake.connectAccount({ expiresAt: NOW - 1 });
    await auth.accessToken();
    clock += 3_600_000;
    expect(await auth.accessToken()).toBe('fake-access-3');
    const [, second] = fake.tokenCalls();
    expect(splitUrl(`https://x/?${second.body}`).query.refresh_token).toBe('fake-refresh-2');
    // The old one is no longer accepted by Spotify, and q’d never sends it again.
    expect(fake.validRefresh.has('fake-refresh-1')).toBe(false);
  });

  it('a second sign-in can start once the first has finished', async () => {
    const { auth, session } = setup({});
    await auth.authorize();
    await auth.authorize();
    expect(session.open).toHaveBeenCalledTimes(2);
  });

  it('a redirect without a state is auth_failed, and its code is never exchanged', async () => {
    const { auth } = setup({
      open: async () => ({ type: 'success', url: `${FAKE_REDIRECT}?code=fake-auth-code` }),
    });
    expect(await auth.authorize()).toEqual({ type: 'failed', code: 'auth_failed' });
    expect(fake.tokenCalls()).toHaveLength(0);
  });

  it('an access_denied with a forged state is auth_failed, not cancelled', async () => {
    const { auth } = setup({
      open: async () => ({
        type: 'success',
        url: `${FAKE_REDIRECT}?error=access_denied&state=forged`,
      }),
    });
    expect(await auth.authorize()).toEqual({ type: 'failed', code: 'auth_failed' });
  });

  it('the authorize URL carries the redirect URI exactly, and the exchange repeats it', async () => {
    const { auth, session } = setup();
    await auth.authorize();
    const { query } = splitUrl(session.opened[0].url);
    expect(query.redirect_uri).toBe(FAKE_REDIRECT);
    const form = splitUrl(`https://x/?${fake.tokenCalls()[0].body}`).query;
    expect(form.redirect_uri).toBe(query.redirect_uri);
  });

  it('never stores tokens anywhere but the credential store', async () => {
    const { auth } = setup();
    await auth.authorize();
    expect([...fake.secure.values.keys()]).toEqual(['qd.provider.spotify']);
  });
});
