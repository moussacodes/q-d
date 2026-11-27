import { createQdMusicKit } from '../../../modules/qd-music-kit';
import { memorySecureStore } from '@/test/fakeSpotify';
import { createFakeMusicKit, nativeError, type FakeMusicKitOptions } from '@/test/fakeMusicKit';

import {
  APPLE_MUSIC_MARKER,
  appleMusicConnectionStatus,
  connectAppleMusic,
  disconnectAppleMusic,
} from './connection';

// Apple Music connection over the qd-music-kit wrapper, with a fake Swift
// module (src/test/fakeMusicKit.ts) and a memory SecureStore.

function setup(options: FakeMusicKitOptions = {}) {
  const fake = createFakeMusicKit(options);
  const secure = memorySecureStore();
  return { ...fake, kit: createQdMusicKit(fake.native, 'ios'), secure, marker: secure.store };
}

const notMock = { isMock: false };

describe('connectAppleMusic', () => {
  it('asks iOS, checks the subscription, keeps the storefront and saves the marker', async () => {
    const { kit, marker, native, secure } = setup();
    expect(await connectAppleMusic(kit, marker)).toEqual({
      status: 'connected',
      storefront: 'us',
      ...notMock,
    });
    expect(native.requestAuthorization).toHaveBeenCalledTimes(1);
    expect(await marker.load('apple_music')).toEqual({ accessToken: APPLE_MUSIC_MARKER });
    // Not a token: MusicKit keeps its own.
    expect([...secure.values.values()].join()).not.toMatch(/eyJ|Bearer/);
  });

  it('connects without a storefront when MusicKit gives none, or fails reading it', async () => {
    const none = setup({ storefront: 'not-a-code' });
    expect(await connectAppleMusic(none.kit, none.marker)).toEqual({
      status: 'connected',
      ...notMock,
    });
    const failing = setup();
    failing.native.storefront.mockRejectedValueOnce(nativeError('ERR_OFFLINE'));
    expect(await connectAppleMusic(failing.kit, failing.marker)).toEqual({
      status: 'connected',
      ...notMock,
    });
  });

  it('without a subscription is needs_subscription, and saves no marker', async () => {
    const { kit, marker } = setup({ subscribed: false });
    expect(await connectAppleMusic(kit, marker)).toEqual({
      status: 'needs_subscription',
      ...notMock,
    });
    expect(await marker.peek('apple_music')).toBe('none');
  });

  it.each(['denied', 'restricted'] as const)(
    '%s is permission_denied (only iOS Settings can change it)',
    async (authorization) => {
      const { kit, marker, native } = setup({ authorization });
      expect(await connectAppleMusic(kit, marker)).toEqual({
        status: 'error',
        code: 'permission_denied',
        ...notMock,
      });
      expect(native.subscriptionStatus).not.toHaveBeenCalled();
      expect(await marker.peek('apple_music')).toBe('none');
    },
  );

  it('the prompt dismissed without an answer is needs_authorization', async () => {
    const { kit, marker } = setup({ grants: 'notDetermined' });
    expect(await connectAppleMusic(kit, marker)).toEqual({
      status: 'needs_authorization',
      ...notMock,
    });
  });

  it('no native module (Expo Go, web) is not_in_this_build, never a fake success', async () => {
    const { marker } = setup();
    for (const kit of [createQdMusicKit(null, 'ios'), createQdMusicKit(null, 'web')]) {
      expect(await connectAppleMusic(kit, marker)).toEqual({
        status: 'error',
        code: 'not_in_this_build',
        ...notMock,
      });
    }
    expect(await marker.peek('apple_music')).toBe('none');
  });

  it('today’s Swift skeleton (no authorization methods) is not_in_this_build', async () => {
    const { native, marker } = setup();
    const skeleton = { ...native } as Partial<typeof native>;
    delete skeleton.requestAuthorization;
    delete skeleton.authorizationStatus;
    delete skeleton.subscriptionStatus;
    delete skeleton.storefront;
    const kit = createQdMusicKit(skeleton as typeof native, 'ios');
    expect(await connectAppleMusic(kit, marker)).toMatchObject({ code: 'not_in_this_build' });
  });

  it('a MusicKit failure is provider_unavailable', async () => {
    const { kit, marker, native } = setup();
    native.subscriptionStatus.mockRejectedValueOnce(nativeError('ERR_OFFLINE'));
    expect(await connectAppleMusic(kit, marker)).toMatchObject({
      status: 'error',
      code: 'provider_unavailable',
    });
    native.requestAuthorization.mockResolvedValueOnce('surprise');
    expect(await connectAppleMusic(kit, marker)).toMatchObject({ code: 'provider_unavailable' });
  });

  it('a marker that can’t be saved is not reported as connected', async () => {
    const { kit, marker, secure } = setup();
    secure.fail.set = true;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await connectAppleMusic(kit, marker)).toMatchObject({
      status: 'error',
      code: 'provider_unavailable',
    });
  });
});

describe('appleMusicConnectionStatus (startup, no prompt)', () => {
  it('connected only with this account’s marker, permission and a subscription', async () => {
    const { kit, marker, native } = setup({ authorization: 'authorized' });
    await marker.save('apple_music', { accessToken: APPLE_MUSIC_MARKER });
    expect(await appleMusicConnectionStatus(kit, marker)).toEqual({
      status: 'connected',
      storefront: 'us',
      ...notMock,
    });
    expect(native.requestAuthorization).not.toHaveBeenCalled();
  });

  it('no marker (never connected here, disconnected, or signed out) is needs_authorization even if iOS says authorized', async () => {
    const { kit, marker, native } = setup({ authorization: 'authorized' });
    expect(await appleMusicConnectionStatus(kit, marker)).toEqual({
      status: 'needs_authorization',
      ...notMock,
    });
    expect(native.authorizationStatus).not.toHaveBeenCalled();
  });

  it('a Keychain that can’t be read is provider_unavailable, so the row is kept', async () => {
    const { kit, secure, marker } = setup({ authorization: 'authorized' });
    secure.fail.get = true;
    expect(await appleMusicConnectionStatus(kit, marker)).toMatchObject({
      status: 'error',
      code: 'provider_unavailable',
    });
  });

  it.each(['denied', 'restricted', 'notDetermined'] as const)(
    'permission %s is needs_authorization',
    async (authorization) => {
      const { kit, marker } = setup({ authorization });
      await marker.save('apple_music', { accessToken: APPLE_MUSIC_MARKER });
      expect(await appleMusicConnectionStatus(kit, marker)).toEqual({
        status: 'needs_authorization',
        ...notMock,
      });
    },
  );

  it('a lapsed subscription is needs_subscription', async () => {
    const { kit, marker } = setup({ authorization: 'authorized', subscribed: false });
    await marker.save('apple_music', { accessToken: APPLE_MUSIC_MARKER });
    expect(await appleMusicConnectionStatus(kit, marker)).toMatchObject({
      status: 'needs_subscription',
    });
  });

  it('can’t tell without the native module or the Swift methods: null', async () => {
    const { native, marker } = setup({ authorization: 'authorized' });
    await marker.save('apple_music', { accessToken: APPLE_MUSIC_MARKER });
    expect(await appleMusicConnectionStatus(createQdMusicKit(null, 'ios'), marker)).toBeNull();
    const skeleton = { ...native } as Partial<typeof native>;
    delete skeleton.authorizationStatus;
    expect(
      await appleMusicConnectionStatus(createQdMusicKit(skeleton as typeof native, 'ios'), marker),
    ).toBeNull();
  });

  it('MusicKit failing is provider_unavailable', async () => {
    const { kit, marker, native } = setup({ authorization: 'authorized' });
    await marker.save('apple_music', { accessToken: APPLE_MUSIC_MARKER });
    native.subscriptionStatus.mockRejectedValueOnce(nativeError('ERR_OFFLINE'));
    expect(await appleMusicConnectionStatus(kit, marker)).toMatchObject({
      code: 'provider_unavailable',
    });
  });
});

it('disconnectAppleMusic forgets the marker, so the next check is needs_authorization', async () => {
  const { kit, marker } = setup();
  await connectAppleMusic(kit, marker);
  await disconnectAppleMusic(marker);
  expect(await appleMusicConnectionStatus(kit, marker)).toMatchObject({
    status: 'needs_authorization',
  });
});

it('signing out (clearAll) forgets the marker too', async () => {
  const { kit, marker, secure } = setup();
  await connectAppleMusic(kit, marker);
  await secure.store.clearAll();
  expect(await appleMusicConnectionStatus(kit, marker)).toMatchObject({
    status: 'needs_authorization',
  });
});
