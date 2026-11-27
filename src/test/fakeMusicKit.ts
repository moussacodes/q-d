import type { QdMusicKitNativeModule } from '../../modules/qd-music-kit';

/**
 * A fake of the qd-music-kit Swift module, as the README says it will
 * behave once Moussa builds it. Nothing here is MusicKit: it's a
 * deterministic stand-in so the TypeScript side can be tested on Windows.
 * Pass it to `createQdMusicKit(native, 'ios')`.
 */

export type FakeMusicKitOptions = {
  authorization?: 'authorized' | 'denied' | 'restricted' | 'notDetermined';
  /** What `requestAuthorization` turns a `notDetermined` into. */
  grants?: 'authorized' | 'denied' | 'notDetermined';
  subscribed?: boolean;
  storefront?: unknown;
};

export function nativeError(code: string, message = 'MusicKit failed') {
  return Object.assign(new Error(message), { code });
}

export function createFakeMusicKit(options: FakeMusicKitOptions = {}) {
  const state = {
    authorization: options.authorization ?? 'notDetermined',
    grants: options.grants ?? 'authorized',
    subscribed: options.subscribed ?? true,
    storefront: 'storefront' in options ? options.storefront : 'us',
  };
  const native = {
    capabilities: jest.fn(() => ({
      inAppAudio: true,
      backgroundPlayback: true,
      requiresExternalApp: false,
      autoplay: false,
      isMock: false,
    })),
    connect: jest.fn(async (): Promise<unknown> => ({ status: 'connected' })),
    prepare: jest.fn(async (_trackId: string, _startPositionMs: number) => {}),
    play: jest.fn(async () => {}),
    pause: jest.fn(async () => {}),
    seek: jest.fn(async (_positionMs: number) => {}),
    enqueue: jest.fn(async (_trackIds: string[]) => {}),
    getState: jest.fn(async (): Promise<unknown> => ({
      status: 'stopped',
      providerTrackId: null,
      positionMs: 0,
    })),
    disconnect: jest.fn(async () => {}),
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
  };
  return { native: native as typeof native & QdMusicKitNativeModule, state };
}
