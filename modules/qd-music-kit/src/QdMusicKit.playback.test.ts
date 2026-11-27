import { createQdMusicKit, QdMusicKitError } from './QdMusicKit';
import type { QdMusicKitNativeModule } from './QdMusicKit.types';

// What the Apple playback card added to the TypeScript wrapper: the native
// error codes for playback, autoplay and song details in the player state,
// and the state-change event.

const base = (overrides: Partial<QdMusicKitNativeModule> = {}): QdMusicKitNativeModule => ({
  capabilities: () => ({}),
  connect: async () => ({ status: 'connected' }),
  prepare: async () => {},
  play: async () => {},
  pause: async () => {},
  seek: async () => {},
  enqueue: async () => {},
  getState: async () => ({ status: 'stopped', providerTrackId: null, positionMs: 0 }),
  disconnect: async () => {},
  ...overrides,
});

const apple = { provider: 'apple_music' as const, providerTrackId: '1' };

it.each([
  ['ERR_QD_NOT_AUTHORIZED', 'not_authorized'],
  ['ERR_QD_NOT_SUBSCRIBED', 'not_subscribed'],
  ['ERR_QD_UNAVAILABLE_IN_STOREFRONT', 'unavailable_in_storefront'],
  ['ERR_QD_NOT_FOUND', 'not_found'],
  ['ERR_QD_NOT_IMPLEMENTED', 'not_implemented'],
  ['ERR_OTHER', 'native_error'],
])('native %s becomes %s', async (nativeCode, code) => {
  const kit = createQdMusicKit(
    base({
      prepare: async () => {
        throw Object.assign(new Error('x'), { code: nativeCode });
      },
    }),
    'ios',
  );
  const error = await kit.prepare(apple).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(QdMusicKitError);
  expect((error as QdMusicKitError).code).toBe(code);
});

describe('player state extras', () => {
  const metadata = {
    title: 'Song',
    artists: ['A', '', 3],
    album: '',
    durationMs: 1000.4,
    isrc: 'USRC17607839',
    explicit: true,
    artworkUrl: 'https://example.com/a.jpg',
    artworkBackgroundColor: '#000000',
  };

  it('keeps autoplay only when it’s exactly true, and cleans the details', async () => {
    const kit = createQdMusicKit(
      base({
        getState: async () => ({
          status: 'playing',
          providerTrackId: '9',
          positionMs: 5,
          autoplay: true,
          metadata,
        }),
      }),
      'ios',
    );
    expect(await kit.getState()).toEqual({
      status: 'playing',
      providerTrackId: '9',
      positionMs: 5,
      autoplay: true,
      metadata: {
        title: 'Song',
        artists: ['A'],
        album: null,
        durationMs: 1000,
        isrc: 'USRC17607839',
        explicit: true,
        artworkUrl: 'https://example.com/a.jpg',
        artworkBackgroundColor: '#000000',
      },
    });
  });

  it.each([
    [{ autoplay: 'yes' }],
    [{ metadata: { title: 'x', artists: [], durationMs: 1 } }],
    [{ metadata: { title: '', artists: ['a'], durationMs: 1 } }],
    [{ metadata: { title: 'x', artists: ['a'], durationMs: 0 } }],
    [{ metadata: 'nope' }],
  ])('leaves out extras that don’t parse: %j', async (extra) => {
    const kit = createQdMusicKit(
      base({
        getState: async () => ({ status: 'paused', providerTrackId: '9', positionMs: 0, ...extra }),
      }),
      'ios',
    );
    expect(await kit.getState()).toEqual({ status: 'paused', providerTrackId: '9', positionMs: 0 });
  });
});

describe('addStateListener', () => {
  it('passes parsed states on, drops broken ones, and unsubscribes', () => {
    let send: (raw: unknown) => void = () => {};
    const remove = jest.fn();
    const kit = createQdMusicKit(
      base({
        addListener: (_event, listener) => {
          send = listener;
          return { remove };
        },
      }),
      'ios',
    );
    const seen: unknown[] = [];
    const stop = kit.addStateListener((state) => seen.push(state));
    send({ status: 'playing', providerTrackId: '1', positionMs: 10 });
    send({ status: 'broken' });
    expect(seen).toEqual([{ status: 'playing', providerTrackId: '1', positionMs: 10 }]);
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without the native module or without events', () => {
    expect(() => createQdMusicKit(null, 'ios').addStateListener(() => {})()).not.toThrow();
    expect(() => createQdMusicKit(base(), 'ios').addStateListener(() => {})()).not.toThrow();
  });
});
