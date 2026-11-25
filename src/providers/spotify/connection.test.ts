import {
  createFakeSpotify,
  FAKE_CLIENT_ID,
  FAKE_REDIRECT,
  fakeAuthSession,
  nodePkceCrypto,
  type FakeSpotify,
} from '@/test/fakeSpotify';

import { createSpotifyApi } from './api';
import { createSpotifyAuth, type OpenAuthSession } from './auth';
import { connectSpotify, disconnectSpotify, spotifyConnectionStatus } from './connection';

const NOW = 1_000_000;
let fake: FakeSpotify;

beforeEach(() => {
  fake = createFakeSpotify({ now: () => NOW });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function setup(options: { open?: OpenAuthSession; clientId?: string | null } = {}) {
  const auth = createSpotifyAuth({
    clientId: options.clientId === undefined ? FAKE_CLIENT_ID : options.clientId,
    redirectUri: FAKE_REDIRECT,
    fetch: fake.fetch,
    crypto: nodePkceCrypto,
    openAuthSession: options.open ?? fakeAuthSession(fake).open,
    store: fake.store,
    now: () => NOW,
  });
  return { auth, api: createSpotifyApi({ auth, fetch: fake.fetch, sleep: async () => {} }) };
}

const premiumRequired = {
  status: 403,
  body: {
    error: {
      status: 403,
      message: 'Player command failed: Premium required',
      reason: 'PREMIUM_REQUIRED',
    },
  },
};
const notRegistered = {
  status: 403,
  body: {
    error: {
      status: 403,
      message: 'Check settings on developer.spotify.com/dashboard, the user may not be registered.',
    },
  },
};

describe('connectSpotify', () => {
  it('connects, checks the account by reading the player, and is never a mock', async () => {
    const { auth, api } = setup();
    expect(await connectSpotify(auth, api)).toEqual({ status: 'connected', isMock: false });
    const [check] = fake.apiCalls();
    expect(check.method).toBe('GET');
    expect(check.path).toBe('/v1/me/player');
    expect(check.headers.Authorization).toBe('Bearer fake-access-1');
  });

  it('counts “no Spotify app open” as connected', async () => {
    fake.script('GET', '/v1/me/player', {
      status: 404,
      body: { error: { status: 404, message: 'Player command failed: No active device found' } },
    });
    const { auth, api } = setup();
    expect(await connectSpotify(auth, api)).toEqual({ status: 'connected', isMock: false });
  });

  it('cancelled sign-in needs authorization and stores nothing', async () => {
    const { auth, api } = setup({ open: async () => ({ type: 'cancel' }) });
    expect(await connectSpotify(auth, api)).toEqual({
      status: 'needs_authorization',
      isMock: false,
    });
    expect(fake.secure.values.size).toBe(0);
  });

  it('a state mismatch is an auth_failed error', async () => {
    const open = fakeAuthSession(fake, () => ({
      type: 'success',
      url: `${FAKE_REDIRECT}?code=fake-auth-code&state=forged`,
    })).open;
    const { auth, api } = setup({ open });
    expect(await connectSpotify(auth, api)).toEqual({
      status: 'error',
      code: 'auth_failed',
      isMock: false,
    });
  });

  it('without a client ID says not_configured', async () => {
    const { auth, api } = setup({ clientId: null });
    expect(await connectSpotify(auth, api)).toEqual({
      status: 'error',
      code: 'not_configured',
      isMock: false,
    });
  });

  it('an account outside the development-mode user list is not_approved_user, and its tokens are dropped', async () => {
    fake.script('GET', '/v1/me/player', notRegistered);
    const { auth, api } = setup();
    expect(await connectSpotify(auth, api)).toEqual({
      status: 'error',
      code: 'not_approved_user',
      isMock: false,
    });
    expect(await auth.hasCredentials()).toBe(false);
  });

  it('Premium required is needs_subscription', async () => {
    fake.script('GET', '/v1/me/player', premiumRequired);
    const { auth, api } = setup();
    expect(await connectSpotify(auth, api)).toEqual({
      status: 'needs_subscription',
      isMock: false,
    });
  });

  it.each([
    [{ status: 500 }, 'provider_unavailable'],
    [{ status: 429, headers: { 'Retry-After': '120' } }, 'rate_limited'],
  ] as const)('a transient failure (%j) keeps the tokens and reports %s', async (reply, code) => {
    for (let i = 0; i < 3; i += 1) fake.script('GET', '/v1/me/player', reply);
    const { auth, api } = setup();
    expect(await connectSpotify(auth, api)).toEqual({ status: 'error', code, isMock: false });
    expect(await auth.hasCredentials()).toBe(true);
  });

  it('offline during the check keeps the tokens', async () => {
    fake.script('GET', '/v1/me/player', 'network_error');
    const { auth, api } = setup();
    expect(await connectSpotify(auth, api)).toEqual({
      status: 'error',
      code: 'provider_unavailable',
      isMock: false,
    });
    expect(await auth.hasCredentials()).toBe(true);
  });
});

describe('spotifyConnectionStatus', () => {
  it('needs authorization with nothing stored, without calling Spotify or opening a sheet', async () => {
    const open = jest.fn();
    const { auth, api } = setup({ open });
    expect(await spotifyConnectionStatus(auth, api)).toEqual({
      status: 'needs_authorization',
      isMock: false,
    });
    expect(open).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
  });

  it('is connected with working stored tokens', async () => {
    await fake.connectAccount();
    const { auth, api } = setup();
    expect(await spotifyConnectionStatus(auth, api)).toEqual({
      status: 'connected',
      isMock: false,
    });
  });

  it('refreshes once on a 401 and stays connected', async () => {
    await fake.connectAccount();
    fake.validAccess.delete('fake-access-1');
    const { auth, api } = setup();
    expect(await spotifyConnectionStatus(auth, api)).toEqual({
      status: 'connected',
      isMock: false,
    });
    expect(fake.tokenCalls()).toHaveLength(1);
    expect(fake.apiCalls().map((call) => call.headers.Authorization)).toEqual([
      'Bearer fake-access-1',
      'Bearer fake-access-2',
    ]);
  });

  it('asks to reconnect when Spotify revoked access', async () => {
    await fake.connectAccount();
    fake.revokeAll();
    const { auth, api } = setup();
    expect(await spotifyConnectionStatus(auth, api)).toEqual({
      status: 'needs_authorization',
      isMock: false,
    });
    expect(await auth.hasCredentials()).toBe(false);
  });

  it('says not_configured without a client ID', async () => {
    await fake.connectAccount();
    const { auth, api } = setup({ clientId: null });
    expect(await spotifyConnectionStatus(auth, api)).toEqual({
      status: 'error',
      code: 'not_configured',
      isMock: false,
    });
  });
});

describe('disconnectSpotify', () => {
  it('forgets the tokens, so the next status needs authorization', async () => {
    const { auth, api } = setup();
    await connectSpotify(auth, api);
    await disconnectSpotify(auth);
    expect(fake.secure.values.size).toBe(0);
    expect(await spotifyConnectionStatus(auth, api)).toEqual({
      status: 'needs_authorization',
      isMock: false,
    });
  });
});
