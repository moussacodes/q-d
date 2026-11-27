import type { QdMusicKitNativeModule } from '../../modules/qd-music-kit';

/**
 * A fake of the qd-music-kit Swift module, as modules/qd-music-kit/README.md
 * says it will behave once Moussa builds it. Nothing here is MusicKit: it's
 * a deterministic stand-in so the TypeScript side can be tested on Windows.
 * Pass `native` to `createQdMusicKit(native, 'ios')`.
 *
 * The player is a small state machine: `prepare` loads a song paused at a
 * position, `play`/`pause` change the status, `seek` moves the position,
 * `enqueue` appends, `finish()` (tests only) ends the song and moves to the
 * next queued one, or to an autoplay song when `autoplaySong` is set.
 */

export type FakeMusicKitOptions = {
  authorization?: 'authorized' | 'denied' | 'restricted' | 'notDetermined';
  /** What `requestAuthorization` turns a `notDetermined` into. */
  grants?: 'authorized' | 'denied' | 'notDetermined';
  subscribed?: boolean;
  storefront?: unknown;
  /** Capabilities the native side reports. */
  capabilities?: Record<string, unknown>;
  /** Metadata MusicKit sends for the song it picks after the queue ends. */
  autoplaySong?: { providerTrackId: string; metadata: Record<string, unknown> } | null;
};

export function nativeError(code: string, message = 'MusicKit failed') {
  return Object.assign(new Error(message), { code });
}

type Listener = (state: unknown) => void;

export function createFakeMusicKit(options: FakeMusicKitOptions = {}) {
  const state = {
    authorization: options.authorization ?? 'notDetermined',
    grants: options.grants ?? 'authorized',
    subscribed: options.subscribed ?? true,
    storefront: 'storefront' in options ? options.storefront : 'us',
  };
  const player = {
    status: 'stopped' as 'playing' | 'paused' | 'stopped',
    trackId: null as string | null,
    positionMs: 0,
    queue: [] as string[],
    autoplay: false,
    metadata: undefined as Record<string, unknown> | undefined,
  };
  const listeners = new Set<Listener>();
  const snapshot = () => ({
    status: player.status,
    providerTrackId: player.trackId,
    positionMs: player.positionMs,
    ...(player.autoplay ? { autoplay: true } : {}),
    ...(player.metadata ? { metadata: player.metadata } : {}),
  });
  const emit = () => listeners.forEach((listener) => listener(snapshot()));

  const native = {
    capabilities: jest.fn(
      () =>
        options.capabilities ?? {
          inAppAudio: true,
          backgroundPlayback: true,
          requiresExternalApp: false,
          autoplay: false,
          isMock: false,
        },
    ),
    connect: jest.fn(async (): Promise<unknown> => ({ status: 'connected' })),
    prepare: jest.fn(async (trackId: string, startPositionMs: number) => {
      Object.assign(player, {
        status: 'paused',
        trackId,
        positionMs: startPositionMs,
        autoplay: false,
        metadata: undefined,
      });
      emit();
    }),
    play: jest.fn(async () => {
      if (player.trackId) player.status = 'playing';
      emit();
    }),
    pause: jest.fn(async () => {
      if (player.trackId) player.status = 'paused';
      emit();
    }),
    seek: jest.fn(async (positionMs: number) => {
      player.positionMs = positionMs;
      emit();
    }),
    enqueue: jest.fn(async (trackIds: string[]) => {
      player.queue.push(...trackIds);
    }),
    getState: jest.fn(async (): Promise<unknown> => snapshot()),
    disconnect: jest.fn(async () => {
      Object.assign(player, {
        status: 'stopped',
        trackId: null,
        positionMs: 0,
        queue: [],
        autoplay: false,
        metadata: undefined,
      });
      emit();
    }),
    authorizationStatus: jest.fn(async (): Promise<unknown> => state.authorization),
    requestAuthorization: jest.fn(async (): Promise<unknown> => {
      if (state.authorization === 'notDetermined') state.authorization = state.grants;
      return state.authorization;
    }),
    subscriptionStatus: jest.fn(async (): Promise<unknown> => ({
      canPlayCatalogContent: state.subscribed,
      canBecomeSubscriber: !state.subscribed,
    })),
    storefront: jest.fn(async (): Promise<unknown> => state.storefront),
    addListener: jest.fn((_event: 'onPlayerStateChange', listener: Listener) => {
      listeners.add(listener);
      return { remove: () => void listeners.delete(listener) };
    }),
  };

  /** Tests only: the song ends, like MusicKit reaching its end. */
  function finish() {
    const next = player.queue.shift();
    if (next) {
      Object.assign(player, { status: 'playing', trackId: next, positionMs: 0 });
    } else if (options.autoplaySong) {
      Object.assign(player, {
        status: 'playing',
        trackId: options.autoplaySong.providerTrackId,
        positionMs: 0,
        autoplay: true,
        metadata: options.autoplaySong.metadata,
      });
    } else {
      Object.assign(player, { status: 'stopped', trackId: null, positionMs: 0 });
    }
    emit();
  }

  return {
    native: native as typeof native & QdMusicKitNativeModule,
    state,
    player,
    finish,
    /** Tests only: send a raw event, as the Swift side would. */
    emitRaw: (raw: unknown) => listeners.forEach((listener) => listener(raw)),
    listenerCount: () => listeners.size,
  };
}
