import { createQdMusicKit } from '../../../modules/qd-music-kit';
import type { ProviderTrack } from '@/domain/recording';
import { createFakeMusicKit, nativeError, type FakeMusicKitOptions } from '@/test/fakeMusicKit';
import { memorySecureStore } from '@/test/fakeSpotify';
import { describePlaybackAdapterContract } from '@/test/providerContract';

import { isProviderError } from '../errors';
import { APPLE_MUSIC_MARKER } from './connection';
import { AppleMusicPlaybackAdapter } from './playback';

// The Apple Music PlaybackAdapter over the real qd-music-kit wrapper and a
// fake Swift player (src/test/fakeMusicKit.ts). Not MusicKit.

const song = (id: string, durationMs = 200_000): ProviderTrack => ({
  provider: 'apple_music',
  providerTrackId: id,
  title: `Song ${id}`,
  artists: ['Artist'],
  album: 'Album',
  durationMs,
  isrc: null,
  explicit: false,
  artworkUrl: null,
  artworkBackgroundColor: '#112233',
});
const first = song('1440857781');
const second = song('1440857782', 180_000);

function setup(options: FakeMusicKitOptions = {}) {
  const fake = createFakeMusicKit(options);
  const kit = createQdMusicKit(fake.native, 'ios');
  const secure = memorySecureStore();
  const adapter = new AppleMusicPlaybackAdapter({ kit, marker: secure.store });
  return { ...fake, kit, secure, adapter };
}

describePlaybackAdapterContract({
  name: 'Apple Music MusicKit (fake native player)',
  create: () => setup().adapter,
  isMock: false,
  available: true,
  tracks: [first, second],
});

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isProviderError(error)).toBe(true);
  return isProviderError(error) ? error.code : null;
}

describe('capabilities', () => {
  it('plays in q’d: never needs another app, never a mock', () => {
    const { adapter } = setup({
      capabilities: { inAppAudio: true, backgroundPlayback: true, requiresExternalApp: true },
    });
    expect(adapter.capabilities()).toEqual({
      inAppAudio: true,
      backgroundPlayback: true,
      requiresExternalApp: false,
      autoplay: false,
      isMock: false,
    });
  });

  it('claims autoplay only when the module reports it', () => {
    expect(setup().adapter.capabilities().autoplay).toBe(false);
    expect(setup({ capabilities: { autoplay: true } }).adapter.capabilities().autoplay).toBe(true);
  });

  it('claims nothing with today’s Swift skeleton (all false)', () => {
    expect(
      Object.values(
        setup({
          capabilities: { inAppAudio: false, backgroundPlayback: false },
        }).adapter.capabilities(),
      ).every((value) => value === false),
    ).toBe(true);
  });
});

describe('connect', () => {
  it('today’s Swift skeleton with no marker is not_in_this_build, not "needs authorization"', async () => {
    const { native } = setup();
    const skeleton = { ...native } as Partial<typeof native>;
    delete skeleton.authorizationStatus;
    delete skeleton.requestAuthorization;
    delete skeleton.subscriptionStatus;
    delete skeleton.storefront;
    const { store } = memorySecureStore();
    const adapter = new AppleMusicPlaybackAdapter({
      kit: createQdMusicKit(skeleton as typeof native, 'ios'),
      marker: store,
    });
    expect(await adapter.connect()).toEqual({
      status: 'error',
      code: 'not_in_this_build',
      isMock: false,
    });
  });

  it('is the stored check, never a prompt', async () => {
    const { adapter, native, secure } = setup({ authorization: 'authorized' });
    expect(await adapter.connect()).toEqual({ status: 'needs_authorization', isMock: false });
    await secure.store.save('apple_music', { accessToken: APPLE_MUSIC_MARKER });
    expect(await adapter.connect()).toEqual({
      status: 'connected',
      storefront: 'us',
      isMock: false,
    });
    expect(native.requestAuthorization).not.toHaveBeenCalled();
  });

  it('without the Swift methods is not_in_this_build', async () => {
    const { native } = setup();
    const skeleton = { ...native } as Partial<typeof native>;
    delete skeleton.authorizationStatus;
    const kit = createQdMusicKit(skeleton as typeof native, 'ios');
    const { store } = memorySecureStore();
    await store.save('apple_music', { accessToken: APPLE_MUSIC_MARKER });
    const adapter = new AppleMusicPlaybackAdapter({ kit, marker: store });
    expect(await adapter.connect()).toEqual({
      status: 'error',
      code: 'not_in_this_build',
      isMock: false,
    });
  });
});

describe('playback through the native player', () => {
  it('sends Apple Music ids and clamps the start to the song', async () => {
    const { adapter, native } = setup();
    await adapter.prepare(first, first.durationMs + 5_000);
    expect(native.prepare).toHaveBeenCalledWith(first.providerTrackId, first.durationMs);
    expect(native.play).not.toHaveBeenCalled();
    await adapter.play();
    expect(await adapter.getState()).toEqual({
      status: 'playing',
      track: first,
      positionMs: first.durationMs,
    });
  });

  it('enqueues ids, and reports the queued song with q’d’s metadata when it comes up', async () => {
    const { adapter, native, finish } = setup();
    await adapter.prepare(first);
    await adapter.enqueue([second]);
    expect(native.enqueue).toHaveBeenCalledWith([second.providerTrackId]);
    await adapter.play();
    finish();
    expect(await adapter.getState()).toEqual({ status: 'playing', track: second, positionMs: 0 });
  });

  it('an empty enqueue doesn’t cross the bridge', async () => {
    const { adapter, native } = setup();
    await adapter.enqueue([]);
    expect(native.enqueue).not.toHaveBeenCalled();
  });

  it('the queue running out is idle, which tells the room the song ended', async () => {
    const { adapter, finish } = setup();
    await adapter.prepare(first);
    await adapter.play();
    finish();
    expect(await adapter.getState()).toEqual({ status: 'idle', track: null, positionMs: 0 });
  });

  const autoplaySong = {
    providerTrackId: '999',
    metadata: {
      title: 'Picked by Apple',
      artists: ['Someone'],
      album: null,
      durationMs: 210_000,
      isrc: 'USRC17607839',
      explicit: false,
      artworkUrl: null,
      artworkBackgroundColor: null,
    },
  };

  it('Apple Music autoplay is reported, labeled, only when the module claims autoplay', async () => {
    const { adapter, finish } = setup({ capabilities: { autoplay: true }, autoplaySong });
    await adapter.prepare(first);
    await adapter.play();
    finish();
    expect(await adapter.getState()).toEqual({
      status: 'playing',
      track: expect.objectContaining({ providerTrackId: '999', title: 'Picked by Apple' }),
      positionMs: 0,
      autoplay: true,
    });
  });

  it('a song q’d didn’t queue is not passed off as the room’s song', async () => {
    // Autoplay not claimed: the song ended for the room.
    const off = setup({ autoplaySong });
    await off.adapter.prepare(first);
    off.finish();
    expect(await off.adapter.getState()).toEqual({ status: 'idle', track: null, positionMs: 0 });
    // Claimed, but no usable details: also idle, never a blank track.
    const bare = setup({
      capabilities: { autoplay: true },
      autoplaySong: { providerTrackId: '999', metadata: { title: '' } },
    });
    await bare.adapter.prepare(first);
    bare.finish();
    expect(await bare.adapter.getState()).toEqual({ status: 'idle', track: null, positionMs: 0 });
  });

  it('play and pause with nothing loaded don’t touch MusicKit', async () => {
    const { adapter, native } = setup();
    await adapter.play();
    await adapter.pause();
    await adapter.seek(100);
    expect(native.play).not.toHaveBeenCalled();
    expect(native.pause).not.toHaveBeenCalled();
    expect(native.seek).not.toHaveBeenCalled();
    expect(native.getState).not.toHaveBeenCalled();
  });

  it('disconnect never throws, even when the native side fails', async () => {
    const { adapter, native } = setup();
    await adapter.prepare(first);
    native.disconnect.mockRejectedValueOnce(nativeError('ERR_QD_NOT_IMPLEMENTED'));
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(await adapter.getState()).toEqual({ status: 'idle', track: null, positionMs: 0 });
  });
});

describe('errors', () => {
  it.each([
    ['ERR_QD_NOT_AUTHORIZED', 'needs_authorization'],
    ['ERR_QD_NOT_SUBSCRIBED', 'premium_required'],
    ['ERR_QD_UNAVAILABLE_IN_STOREFRONT', 'unavailable_in_storefront'],
    ['ERR_QD_NOT_FOUND', 'not_found'],
    ['ERR_QD_NOT_IMPLEMENTED', 'not_in_this_build'],
    ['ERR_SOMETHING_ELSE', 'provider_unavailable'],
  ])('native %s on prepare is %s', async (nativeCode, expected) => {
    const { adapter, native } = setup();
    native.prepare.mockRejectedValueOnce(nativeError(nativeCode, 'Could not play "Secret Song"'));
    const promise = adapter.prepare(first);
    expect(await codeOf(promise)).toBe(expected);
    // Nothing loaded after a failed prepare.
    expect(await adapter.getState()).toEqual({ status: 'idle', track: null, positionMs: 0 });
  });

  it('never carries MusicKit’s message (it could name a song)', async () => {
    const { adapter, native } = setup();
    native.prepare.mockRejectedValueOnce(nativeError('ERR_X', 'Could not play "Secret Song"'));
    const error = await adapter.prepare(first).catch((e: Error) => e);
    expect(String((error as Error).message)).not.toContain('Secret');
  });

  it.each(['play', 'pause', 'getState'] as const)('a failing %s rejects with a code', async (m) => {
    const { adapter, native } = setup();
    await adapter.prepare(first);
    native[m].mockRejectedValueOnce(nativeError('ERR_QD_NOT_SUBSCRIBED'));
    expect(await codeOf(adapter[m]())).toBe('premium_required');
  });

  it('a failing seek or enqueue rejects with a code', async () => {
    const { adapter, native } = setup();
    await adapter.prepare(first);
    native.seek.mockRejectedValueOnce(nativeError('ERR_QD_NOT_AUTHORIZED'));
    expect(await codeOf(adapter.seek(1_000))).toBe('needs_authorization');
    native.enqueue.mockRejectedValueOnce(nativeError('ERR_QD_NOT_FOUND'));
    expect(await codeOf(adapter.enqueue([second]))).toBe('not_found');
  });

  it('a song whose enqueue failed is never reported with q’d’s metadata', async () => {
    const { adapter, native } = setup();
    await adapter.prepare(first);
    native.enqueue.mockRejectedValueOnce(nativeError('ERR_X'));
    await adapter.enqueue([second]).catch(() => {});
    native.getState.mockResolvedValueOnce({
      status: 'playing',
      providerTrackId: second.providerTrackId,
      positionMs: 0,
    });
    expect(await adapter.getState()).toEqual({ status: 'idle', track: null, positionMs: 0 });
  });

  it('a failed prepare of a song already known keeps its metadata', async () => {
    const { adapter, native } = setup();
    await adapter.prepare(first);
    native.prepare.mockRejectedValueOnce(nativeError('ERR_X'));
    await adapter.prepare({ ...first, title: 'Other title' }).catch(() => {});
    expect(await adapter.getState()).toMatchObject({ status: 'paused', track: first });
  });

  it('a state MusicKit returns that doesn’t parse is provider_unavailable', async () => {
    const { adapter, native } = setup();
    await adapter.prepare(first);
    native.getState.mockResolvedValueOnce({ status: 'dancing' });
    expect(await codeOf(adapter.getState())).toBe('provider_unavailable');
  });

  it('without the native module every player call is not_in_this_build', async () => {
    const { store } = memorySecureStore();
    const adapter = new AppleMusicPlaybackAdapter({
      kit: createQdMusicKit(null, 'ios'),
      marker: store,
    });
    expect(await codeOf(adapter.prepare(first))).toBe('not_in_this_build');
    expect(await codeOf(adapter.enqueue([first]))).toBe('not_in_this_build');
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(await adapter.connect()).toMatchObject({ code: 'not_in_this_build' });
  });
});

describe('state events', () => {
  it('passes native state changes on as PlayerState, and stops on unsubscribe', async () => {
    const { adapter, finish, listenerCount, emitRaw } = setup();
    const seen: unknown[] = [];
    const stop = adapter.onStateChange((state) => seen.push(state));
    await adapter.prepare(first);
    await adapter.play();
    emitRaw({ status: 'nonsense' }); // dropped
    finish();
    expect(seen).toEqual([
      { status: 'paused', track: first, positionMs: 0 },
      { status: 'playing', track: first, positionMs: 0 },
      { status: 'idle', track: null, positionMs: 0 },
    ]);
    stop();
    expect(listenerCount()).toBe(0);
  });

  it('without events from the native side, subscribing is harmless', () => {
    const { native } = setup();
    const quiet = { ...native } as Partial<typeof native>;
    delete quiet.addListener;
    const { store } = memorySecureStore();
    const adapter = new AppleMusicPlaybackAdapter({
      kit: createQdMusicKit(quiet as typeof native, 'ios'),
      marker: store,
    });
    const stop = adapter.onStateChange(() => {});
    expect(() => stop()).not.toThrow();
  });
});
