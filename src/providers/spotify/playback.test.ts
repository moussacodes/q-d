import type { ProviderTrack } from '@/domain/recording';
import {
  createFakeSpotify,
  FAKE_CLIENT_ID,
  FAKE_REDIRECT,
  installFakePlayer,
  nodePkceCrypto,
  spotifyTrackObject,
  type FakeSpotify,
} from '@/test/fakeSpotify';

import { isProviderError } from '../errors';
import { createSpotifyApi, MAX_RETRY_AFTER_MS, type SpotifyApiDeps } from './api';
import { createSpotifyAuth } from './auth';
import { spotifyCapabilities, SpotifyPlaybackAdapter, trackFromSpotify } from './playback';

const track = (id: string, durationMs = 200_000): ProviderTrack => ({
  provider: 'spotify',
  providerTrackId: id,
  title: `Song ${id}`,
  artists: ['Artist'],
  album: 'Album',
  durationMs,
  isrc: 'USRC17607839',
  explicit: false,
  artworkUrl: 'https://i.scdn.co/image/abc',
  artworkBackgroundColor: null,
});

const A = track('trackAAAAAAAAAAAAAAAAA1');
const B = track('trackBBBBBBBBBBBBBBBBB2');
const C = track('trackCCCCCCCCCCCCCCCCC3');

let fake: FakeSpotify;
let player: ReturnType<typeof installFakePlayer>;

beforeEach(async () => {
  fake = createFakeSpotify({ now: () => Date.now() });
  player = installFakePlayer(fake, [A, B, C]);
  await fake.connectAccount();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function setup(apiOptions: Partial<SpotifyApiDeps> = {}) {
  const auth = createSpotifyAuth({
    clientId: FAKE_CLIENT_ID,
    redirectUri: FAKE_REDIRECT,
    fetch: fake.fetch,
    crypto: nodePkceCrypto,
    openAuthSession: async () => ({ type: 'cancel' }),
    store: fake.store,
  });
  const api = createSpotifyApi({ auth, fetch: fake.fetch, ...apiOptions });
  return { auth, adapter: new SpotifyPlaybackAdapter({ auth, api }) };
}

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return isProviderError(error) ? error.code : error;
  }
  throw new Error('Expected a rejection');
}

const commands = () =>
  fake.apiCalls().map((call) => {
    const query = Object.entries(call.query)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${call.method} ${call.path.replace('/v1', '')}${query ? `?${query}` : ''}`;
  });

describe('capabilities', () => {
  it('needs the Spotify app, plays no audio itself and claims nothing untested', () => {
    expect(setup().adapter.capabilities()).toEqual({
      inAppAudio: false,
      backgroundPlayback: false,
      requiresExternalApp: true,
      autoplay: false,
      isMock: false,
    });
    expect(Object.isFrozen(spotifyCapabilities)).toBe(true);
  });
});

describe('prepare and play', () => {
  it('prepare calls nothing; play starts the track by URI at the position', async () => {
    const { adapter } = setup();
    await adapter.prepare(A, 12_345.4);
    expect(fake.apiCalls()).toHaveLength(0);
    await adapter.play();
    const [call] = fake.apiCalls();
    expect(call.method).toBe('PUT');
    expect(call.path).toBe('/v1/me/player/play');
    expect(JSON.parse(call.body!)).toEqual({
      uris: ['spotify:track:trackAAAAAAAAAAAAAAAAA1'],
      position_ms: 12_345,
    });
    expect(await adapter.getState()).toEqual({ status: 'playing', track: A, positionMs: 12_345 });
  });

  it('a prepared position past the end is clamped to the track', async () => {
    const { adapter } = setup();
    await adapter.prepare(A, 10_000_000);
    expect((await adapter.getState()).positionMs).toBe(A.durationMs);
  });

  it('with no active Spotify app, moves playback to this phone and plays there', async () => {
    player.devices = [
      { id: 'tv', name: 'TV', type: 'TV', is_active: false, is_restricted: false },
      { id: 'phone-1', name: 'iPhone', type: 'Smartphone', is_active: false, is_restricted: false },
    ];
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    expect(commands()).toEqual([
      'PUT /me/player/play',
      'GET /me/player/devices',
      'PUT /me/player',
      'PUT /me/player/play?device_id=phone-1',
    ]);
    expect(JSON.parse(fake.apiCalls()[2].body!)).toEqual({ device_ids: ['phone-1'], play: false });
    // Later commands go to the same device.
    await adapter.pause();
    expect(commands().at(-1)).toBe('PUT /me/player/pause?device_id=phone-1');
  });

  it('uses the only device when there is just one', async () => {
    player.devices = [
      { id: 'mac', name: 'Mac', type: 'Computer', is_active: false, is_restricted: false },
    ];
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    expect(commands().at(-1)).toBe('PUT /me/player/play?device_id=mac');
  });

  it.each([
    ['no devices', []],
    [
      'several devices and no phone',
      [
        { id: 'tv', name: 'TV', type: 'TV', is_active: false, is_restricted: false },
        { id: 'mac', name: 'Mac', type: 'Computer', is_active: false, is_restricted: false },
      ],
    ],
    [
      'only a restricted device',
      [{ id: 'car', name: 'Car', type: 'Automobile', is_active: false, is_restricted: true }],
    ],
  ])('with %s, says no_active_device and keeps the track ready', async (_name, devices) => {
    player.devices = devices;
    const { adapter } = setup();
    await adapter.prepare(A, 1_000);
    expect(await code(adapter.play())).toBe('no_active_device');
    expect(commands()).not.toContain('PUT /me/player');
    // Honest state: nothing plays, the track is still ready.
    expect(await adapter.getState()).toEqual({ status: 'paused', track: A, positionMs: 1_000 });
    // Once Spotify is open on the phone, play works.
    player.devices = [
      { id: 'phone-1', name: 'iPhone', type: 'Smartphone', is_active: true, is_restricted: false },
    ];
    await adapter.play();
    expect((await adapter.getState()).status).toBe('playing');
  });

  it('a free account gets premium_required', async () => {
    player.premium = false;
    const { adapter } = setup();
    await adapter.prepare(A);
    expect(await code(adapter.play())).toBe('premium_required');
  });

  it('resuming something already playing is fine', async () => {
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    await expect(adapter.play()).resolves.toBeUndefined();
    expect(commands()).toEqual(['PUT /me/player/play', 'PUT /me/player/play']);
  });

  it('play after pause resumes without a track URI', async () => {
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    await adapter.pause();
    await adapter.play();
    expect(fake.apiCalls()[2].body).toBeUndefined();
    expect((await adapter.getState()).status).toBe('playing');
  });

  it('play with nothing prepared sends nothing', async () => {
    const { adapter } = setup();
    await adapter.play();
    expect(fake.apiCalls()).toHaveLength(0);
  });

  it('other refusals surface as playback_refused', async () => {
    fake.script('PUT', '/v1/me/player/play', {
      status: 403,
      body: {
        error: {
          status: 403,
          message: 'Device not controllable',
          reason: 'DEVICE_NOT_CONTROLLABLE',
        },
      },
    });
    const { adapter } = setup();
    await adapter.prepare(A);
    expect(await code(adapter.play())).toBe('playback_refused');
  });
});

describe('pause and seek', () => {
  it('pausing twice is fine (ALREADY_PAUSED)', async () => {
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    await adapter.pause();
    await expect(adapter.pause()).resolves.toBeUndefined();
    expect((await adapter.getState()).status).toBe('paused');
  });

  it('pausing with no Spotify app left is fine: nothing plays', async () => {
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    player.devices = [];
    await expect(adapter.pause()).resolves.toBeUndefined();
  });

  it('pause before anything started sends nothing', async () => {
    const { adapter } = setup();
    await adapter.pause();
    await adapter.prepare(A);
    await adapter.pause();
    expect(fake.apiCalls()).toHaveLength(0);
  });

  it('a premium refusal on pause still surfaces', async () => {
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    player.premium = false;
    expect(await code(adapter.pause())).toBe('premium_required');
  });

  it('seek while playing sends the clamped position', async () => {
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    await adapter.seek(30_000.6);
    await adapter.seek(A.durationMs * 2);
    expect(commands().slice(-2)).toEqual([
      'PUT /me/player/seek?position_ms=30001',
      `PUT /me/player/seek?position_ms=${A.durationMs}`,
    ]);
  });

  it('rejects bad positions before calling Spotify', async () => {
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    const before = fake.apiCalls().length;
    expect(await code(adapter.seek(-1))).toBe('invalid_argument');
    expect(await code(adapter.seek(Number.NaN))).toBe('invalid_argument');
    expect(fake.apiCalls()).toHaveLength(before);
  });
});

describe('enqueue', () => {
  it('adds to Spotify’s queue while playing, and reports a queued track as q’d’s own', async () => {
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    await adapter.enqueue([B]);
    expect(commands().at(-1)).toBe(
      'POST /me/player/queue?uri=spotify:track:trackBBBBBBBBBBBBBBBBB2',
    );
    expect(player.queue).toEqual(['spotify:track:trackBBBBBBBBBBBBBBBBB2']);
    // Spotify moves on to B.
    player.itemId = B.providerTrackId;
    player.progressMs = 0;
    expect((await adapter.getState()).track).toBe(B);
  });

  it('holds tracks enqueued before play and sends them after the track starts', async () => {
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.enqueue([B, C]);
    expect(fake.apiCalls()).toHaveLength(0);
    await adapter.play();
    expect(commands()).toEqual([
      'PUT /me/player/play',
      'POST /me/player/queue?uri=spotify:track:trackBBBBBBBBBBBBBBBBB2',
      'POST /me/player/queue?uri=spotify:track:trackCCCCCCCCCCCCCCCCC3',
    ]);
  });

  it('checks every track before sending any', async () => {
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    const before = fake.apiCalls().length;
    expect(await code(adapter.enqueue([B, { ...C, provider: 'apple_music' }]))).toBe(
      'wrong_provider',
    );
    expect(fake.apiCalls()).toHaveLength(before);
  });

  it('never retries a failed queue add, so a song can’t be added twice', async () => {
    const { adapter } = setup({ sleep: async () => {} });
    await adapter.prepare(A);
    await adapter.play();
    fake.script('POST', '/v1/me/player/queue', { status: 502 });
    expect(await code(adapter.enqueue([B]))).toBe('provider_unavailable');
    expect(commands().filter((c) => c.startsWith('POST'))).toHaveLength(1);
  });
});

describe('getState', () => {
  it('is idle when Spotify has nothing (204)', async () => {
    expect(await setup().adapter.getState()).toEqual({
      status: 'idle',
      track: null,
      positionMs: 0,
    });
  });

  it('reports what Spotify plays even if someone changed it in the Spotify app', async () => {
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    player.itemId = C.providerTrackId;
    player.progressMs = 5_000;
    player.isPlaying = false;
    expect(await adapter.getState()).toEqual({
      status: 'paused',
      track: { ...C, album: 'Album' },
      positionMs: 5_000,
    });
  });

  it('is idle for a podcast episode or an unreadable item', async () => {
    for (const item of [{ type: 'episode', id: 'x', name: 'Pod' }, { id: '' }, null]) {
      fake.script('GET', '/v1/me/player', {
        status: 200,
        body: { is_playing: true, progress_ms: 10, item },
      });
      expect(await setup().adapter.getState()).toEqual({
        status: 'idle',
        track: null,
        positionMs: 0,
      });
    }
  });

  it('keeps the position within the track', async () => {
    fake.script('GET', '/v1/me/player', {
      status: 200,
      body: { is_playing: true, progress_ms: 9_999_999, item: spotifyTrackObject(A) },
    });
    fake.script('GET', '/v1/me/player', {
      status: 200,
      body: { is_playing: true, progress_ms: 'soon', item: spotifyTrackObject(A) },
    });
    const { adapter } = setup();
    expect((await adapter.getState()).positionMs).toBe(A.durationMs);
    expect((await adapter.getState()).positionMs).toBe(0);
  });

  it('refreshes once on a 401 and keeps polling', async () => {
    const { adapter } = setup();
    await adapter.prepare(A);
    await adapter.play();
    fake.validAccess.clear();
    expect((await adapter.getState()).status).toBe('playing');
    expect(fake.tokenCalls()).toHaveLength(1);
  });

  it('asks to reconnect when Spotify revoked access', async () => {
    const { adapter, auth } = setup();
    await adapter.prepare(A);
    await adapter.play();
    fake.revokeAll();
    expect(await code(adapter.getState())).toBe('needs_authorization');
    expect(await auth.hasCredentials()).toBe(false);
    expect(await adapter.connect()).toEqual({ status: 'needs_authorization', isMock: false });
  });
});

describe('rate limits and server errors', () => {
  it('waits for Retry-After on a 429, then retries', async () => {
    jest.useFakeTimers();
    fake.script('GET', '/v1/me/player', { status: 429, headers: { 'Retry-After': '2' } });
    const { adapter } = setup();
    const state = adapter.getState();
    await jest.advanceTimersByTimeAsync(1_999);
    expect(fake.apiCalls()).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(state).resolves.toMatchObject({ status: 'idle' });
    expect(fake.apiCalls()).toHaveLength(2);
  });

  it('waits one second when Retry-After is missing or unreadable', async () => {
    jest.useFakeTimers();
    fake.script('GET', '/v1/me/player', { status: 429 });
    fake.script('GET', '/v1/me/player', { status: 429, headers: { 'Retry-After': 'soon' } });
    const { adapter } = setup();
    const state = adapter.getState();
    await jest.advanceTimersByTimeAsync(999);
    expect(fake.apiCalls()).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fake.apiCalls()).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(state).resolves.toMatchObject({ status: 'idle' });
    expect(fake.apiCalls()).toHaveLength(3);
  });

  it('gives up with rate_limited after three waits', async () => {
    jest.useFakeTimers();
    for (let i = 0; i < 4; i += 1) {
      fake.script('GET', '/v1/me/player', { status: 429, headers: { 'Retry-After': '1' } });
    }
    const { adapter } = setup();
    const result = code(adapter.getState());
    await jest.advanceTimersByTimeAsync(3_000);
    expect(await result).toBe('rate_limited');
    expect(fake.apiCalls()).toHaveLength(4);
  });

  it('doesn’t wait for a Retry-After longer than the limit', async () => {
    jest.useFakeTimers();
    fake.script('GET', '/v1/me/player', {
      status: 429,
      headers: { 'Retry-After': String(MAX_RETRY_AFTER_MS / 1000 + 1) },
    });
    const { adapter } = setup();
    expect(await code(adapter.getState())).toBe('rate_limited');
    expect(fake.apiCalls()).toHaveLength(1);
  });

  it('retries a play command after a 429 too', async () => {
    jest.useFakeTimers();
    fake.script('PUT', '/v1/me/player/play', { status: 429, headers: { 'Retry-After': '3' } });
    const { adapter } = setup();
    await adapter.prepare(A);
    const playing = adapter.play();
    await jest.advanceTimersByTimeAsync(3_000);
    await playing;
    expect(commands()).toEqual(['PUT /me/player/play', 'PUT /me/player/play']);
  });

  it('retries a 5xx after 500 ms and 1 s, then says provider_unavailable', async () => {
    jest.useFakeTimers();
    for (let i = 0; i < 3; i += 1) fake.script('GET', '/v1/me/player', { status: 503 });
    const { adapter } = setup();
    const result = code(adapter.getState());
    await jest.advanceTimersByTimeAsync(499);
    expect(fake.apiCalls()).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fake.apiCalls()).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await result).toBe('provider_unavailable');
    expect(fake.apiCalls()).toHaveLength(3);
  });

  it('a 5xx that clears up on retry succeeds', async () => {
    fake.script('GET', '/v1/me/player', { status: 500 });
    const { adapter } = setup({ sleep: async () => {} });
    expect(await adapter.getState()).toMatchObject({ status: 'idle' });
  });
});

describe('connect and disconnect', () => {
  it('connect reads the stored account without opening a sign-in sheet', async () => {
    expect(await setup().adapter.connect()).toEqual({ status: 'connected', isMock: false });
  });

  it('disconnect pauses what q’d started, lets go, and keeps the account connected', async () => {
    const { adapter, auth } = setup();
    await adapter.prepare(A);
    await adapter.play();
    await adapter.disconnect();
    expect(player.isPlaying).toBe(false);
    expect(await adapter.getState()).toEqual({ status: 'idle', track: null, positionMs: 0 });
    expect(await auth.hasCredentials()).toBe(true);
    // Nothing more is sent until q’d takes over again.
    const before = fake.apiCalls().length;
    await adapter.play();
    await adapter.pause();
    await adapter.seek(1);
    expect(fake.apiCalls()).toHaveLength(before);
    expect(await adapter.connect()).toEqual({ status: 'connected', isMock: false });
  });

  it('disconnect doesn’t pause music q’d didn’t start, and survives errors', async () => {
    const { adapter } = setup();
    await adapter.disconnect();
    expect(fake.apiCalls()).toHaveLength(0);

    await adapter.prepare(A);
    await adapter.play();
    player.devices = [];
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });
});

describe('trackFromSpotify', () => {
  it('maps Spotify’s track object, with the ISRC in compact form and no artwork color', () => {
    const item = spotifyTrackObject({ ...A, isrc: 'us-rc1-76-07839' });
    expect(trackFromSpotify(item)).toEqual({ ...A, isrc: 'USRC17607839' });
  });

  it('keeps a track whose ISRC is malformed, without the ISRC', () => {
    expect(trackFromSpotify(spotifyTrackObject({ ...A, isrc: 'nope' }))?.isrc).toBeNull();
  });

  it('handles missing album, artwork and explicit flags', () => {
    expect(
      trackFromSpotify({ id: 'x', name: 'Song', artists: [{ name: 'A' }], duration_ms: 1000 }),
    ).toEqual({
      provider: 'spotify',
      providerTrackId: 'x',
      title: 'Song',
      artists: ['A'],
      album: null,
      durationMs: 1000,
      isrc: null,
      explicit: false,
      artworkUrl: null,
      artworkBackgroundColor: null,
    });
  });

  it.each([
    null,
    'track',
    { type: 'episode' },
    { id: 'x', name: 'S', artists: [], duration_ms: 1 },
  ])('rejects %p', (item) => {
    expect(trackFromSpotify(item)).toBeNull();
  });
});
