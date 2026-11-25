import {
  createFakeSpotify,
  FAKE_CLIENT_ID,
  FAKE_REDIRECT,
  fakeAuthSession,
  nodePkceCrypto,
  type FakeSpotify,
} from '@/test/fakeSpotify';

import { isProviderError } from '../errors';
import { createSpotifyApi, errorCodeFor, spotifyReason, SpotifyApiError } from './api';
import { createSpotifyAuth } from './auth';

const NOW = 1_000_000;
let fake: FakeSpotify;

beforeEach(() => {
  fake = createFakeSpotify({ now: () => NOW });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function setup() {
  const auth = createSpotifyAuth({
    clientId: FAKE_CLIENT_ID,
    redirectUri: FAKE_REDIRECT,
    fetch: fake.fetch,
    crypto: nodePkceCrypto,
    openAuthSession: fakeAuthSession(fake).open,
    store: fake.store,
    now: () => NOW,
  });
  return { auth, api: createSpotifyApi({ auth, fetch: fake.fetch }) };
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected a rejection');
}

const playerError = (status: number, message: string, reason?: string) => ({
  error: { status, message, ...(reason ? { reason } : {}) },
});

describe('errorCodeFor', () => {
  it.each([
    [401, undefined, '/me/player', 'needs_authorization'],
    [
      403,
      playerError(403, 'Premium required', 'PREMIUM_REQUIRED'),
      '/me/player/play',
      'premium_required',
    ],
    [
      403,
      playerError(403, 'Player command failed: Premium required'),
      '/me/player/play',
      'premium_required',
    ],
    [
      403,
      playerError(403, 'No active device', 'NO_ACTIVE_DEVICE'),
      '/me/player/play',
      'no_active_device',
    ],
    [
      403,
      playerError(
        403,
        'Check settings on developer.spotify.com/dashboard, the user may not be registered.',
      ),
      '/me/player',
      'not_approved_user',
    ],
    [403, 'User not registered in the Developer Dashboard', '/me/player', 'not_approved_user'],
    [403, 'Forbidden', '/me/player', 'playback_refused'],
    [
      403,
      playerError(403, 'Restriction violated', 'UNKNOWN'),
      '/me/player/seek',
      'playback_refused',
    ],
    [
      403,
      playerError(403, 'Device not controllable', 'DEVICE_NOT_CONTROLLABLE'),
      '/me/player/play',
      'playback_refused',
    ],
    [
      404,
      playerError(404, 'Player command failed: No active device found', 'NO_ACTIVE_DEVICE'),
      '/me/player/play',
      'no_active_device',
    ],
    [404, playerError(404, 'No active device found'), '/tracks/x', 'no_active_device'],
    [404, undefined, '/me/player/pause', 'no_active_device'],
    [404, playerError(404, 'Not found'), '/tracks/x', 'not_found'],
    [400, playerError(400, 'Invalid track uri'), '/me/player/play', 'invalid_argument'],
    [429, undefined, '/me/player', 'rate_limited'],
    [500, undefined, '/me/player', 'provider_unavailable'],
    [502, undefined, '/me/player', 'provider_unavailable'],
    [418, undefined, '/me/player', 'provider_unavailable'],
  ] as const)('%i %j on %s → %s', (status, body, path, code) => {
    expect(errorCodeFor(status, body, path)).toBe(code);
  });
});

describe('request', () => {
  it('sends the bearer token, the query and a JSON body to api.spotify.com/v1', async () => {
    await fake.connectAccount();
    fake.handleApi = () => ({ status: 200, body: { ok: true } });
    const { api } = setup();
    const result = await api.request({
      method: 'PUT',
      path: '/me/player/play',
      query: { device_id: 'dev 1', skipped: undefined },
      body: { uris: ['spotify:track:abc'], position_ms: 5 },
    });
    expect(result).toEqual({ status: 200, data: { ok: true } });
    const [call] = fake.apiCalls();
    expect(call.url).toBe('https://api.spotify.com/v1/me/player/play?device_id=dev%201');
    expect(call.headers).toEqual({
      Authorization: 'Bearer fake-access-1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(call.body!)).toEqual({ uris: ['spotify:track:abc'], position_ms: 5 });
  });

  it('returns undefined data for a 204', async () => {
    await fake.connectAccount();
    const { api } = setup();
    expect(await api.request({ method: 'GET', path: '/me/player' })).toEqual({
      status: 204,
      data: undefined,
    });
    expect(fake.apiCalls()[0].headers).toEqual({ Authorization: 'Bearer fake-access-1' });
  });

  it('refreshes once on a 401 and retries with the new token', async () => {
    await fake.connectAccount();
    fake.validAccess.delete('fake-access-1');
    const { api } = setup();
    await api.request({ method: 'PUT', path: '/me/player/pause' });
    expect(fake.apiCalls().map((call) => call.headers.Authorization)).toEqual([
      'Bearer fake-access-1',
      'Bearer fake-access-2',
    ]);
    expect(fake.tokenCalls()).toHaveLength(1);
  });

  it('a second 401 after refreshing clears the tokens and asks to reconnect', async () => {
    await fake.connectAccount();
    fake.script('GET', '/v1/me/player', { status: 401 });
    fake.script('GET', '/v1/me/player', { status: 401 });
    const { api, auth } = setup();
    const error = await failure(api.request({ method: 'GET', path: '/me/player' }));
    expect(isProviderError(error) && error.code).toBe('needs_authorization');
    expect(fake.apiCalls()).toHaveLength(2);
    expect(fake.tokenCalls()).toHaveLength(1);
    expect(await auth.hasCredentials()).toBe(false);
  });

  it('a 401 whose refresh is refused asks to reconnect without retrying', async () => {
    await fake.connectAccount();
    fake.revokeAll();
    const { api } = setup();
    const error = await failure(api.request({ method: 'GET', path: '/me/player' }));
    expect(isProviderError(error) && error.code).toBe('needs_authorization');
    expect(fake.apiCalls()).toHaveLength(1);
  });

  it('with nothing stored, says to connect and sends nothing', async () => {
    const { api } = setup();
    const error = await failure(api.request({ method: 'GET', path: '/me/player' }));
    expect(isProviderError(error) && error.code).toBe('needs_authorization');
    expect(fake.calls).toHaveLength(0);
  });

  it('a network failure is provider_unavailable', async () => {
    await fake.connectAccount();
    fake.script('GET', '/v1/me/player', 'network_error');
    const { api } = setup();
    const error = await failure(api.request({ method: 'GET', path: '/me/player' }));
    expect(isProviderError(error) && error.code).toBe('provider_unavailable');
  });

  it('carries Spotify’s player reason and status', async () => {
    await fake.connectAccount();
    fake.script('PUT', '/v1/me/player/pause', {
      status: 403,
      body: playerError(403, 'Player command failed: Already paused', 'ALREADY_PAUSED'),
    });
    const { api } = setup();
    const error = await failure(api.request({ method: 'PUT', path: '/me/player/pause' }));
    expect(error).toBeInstanceOf(SpotifyApiError);
    expect((error as SpotifyApiError).status).toBe(403);
    expect(spotifyReason(error)).toBe('ALREADY_PAUSED');
    expect(spotifyReason(new Error('x'))).toBeUndefined();
    expect((error as Error).message).toBe('Spotify answered 403');
  });
});

describe('review: the loose development-mode match', () => {
  it.each([
    ['UNKNOWN', 'Restriction violated: not approved for this device'],
    ['DEVICE_NOT_CONTROLLABLE', 'See the developer dashboard'],
    ['PREMIUM_REQUIRED', 'User not registered'],
  ])('a player 403 with a reason (%s) is never read as not_approved_user', (reason, message) => {
    const code = errorCodeFor(403, playerError(403, message, reason), '/me/player/play');
    expect(code).not.toBe('not_approved_user');
  });

  it('a player refusal keeps the tokens; only the development-mode refusal is not_approved_user', async () => {
    const { auth, api } = setup();
    await fake.connectAccount();
    fake.script('PUT', '/v1/me/player/play', {
      status: 403,
      body: playerError(403, 'Restriction violated: not approved', 'UNKNOWN'),
    });
    const error = await failure(api.request({ method: 'PUT', path: '/me/player/play' }));
    expect(isProviderError(error) && error.code).toBe('playback_refused');
    expect(await auth.hasCredentials()).toBe(true);
  });

  it('never puts the token in the URL, only the Authorization header', async () => {
    const { api } = setup();
    await fake.connectAccount();
    await api.request({ method: 'GET', path: '/me/player', query: { market: 'US' } });
    const [call] = fake.apiCalls();
    expect(call.url).not.toContain('fake-access');
    expect(call.headers.Authorization).toBe('Bearer fake-access-1');
  });

  it('an error never carries Spotify’s message text (it can echo request data)', async () => {
    const { api } = setup();
    await fake.connectAccount();
    fake.script('PUT', '/v1/me/player/play', {
      status: 400,
      body: playerError(400, 'Invalid track uri: spotify:track:abc123SECRETISH'),
    });
    const error = await failure(api.request({ method: 'PUT', path: '/me/player/play' }));
    expect(String((error as Error).message)).toBe('Spotify answered 400');
  });
});
