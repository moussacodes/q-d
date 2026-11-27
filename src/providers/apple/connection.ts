import type { ProviderCredentialStore } from '@/services/providerCredentials';

import type { QdMusicKitApi } from '../../../modules/qd-music-kit';
import type { ConnectionState, ProviderErrorCode } from '../types';

/**
 * Whether this phone can play through Apple Music, as a `ConnectionState`,
 * over the qd-music-kit module (MusicKit). A real Apple connection is never a
 * mock. Built, untested on a device: it needs the q’d development build and
 * the Swift methods listed in modules/qd-music-kit/README.md.
 *
 * - No native module (Expo Go, the web) or a Swift method not built yet:
 *   `not_in_this_build`, which reads "Apple Music needs the q’d app build".
 * - Authorized with a subscription: `connected`, with the storefront.
 * - Authorized without one: `needs_subscription`.
 * - Said no, or restricted: on Connect, `permission_denied` (only iOS
 *   Settings can change it); when checking, `needs_authorization`.
 *
 * MusicKit's permission belongs to the iPhone, not to the q’d account, and
 * an app can't take it back. So a successful Connect also saves a marker in
 * this phone's provider credentials (SecureStore): "this account connected
 * Apple Music here". It holds no token (MusicKit manages its own). Disconnect
 * and sign-out remove it, so the next account on this phone, or this one
 * after Disconnect, isn't connected just because iOS still says authorized.
 */

export type AppleMusicKit = Pick<
  QdMusicKitApi,
  'availability' | 'authorizationStatus' | 'requestAuthorization' | 'subscription' | 'storefront'
>;

/** The marker's stored value. Not a secret: MusicKit keeps the real tokens. */
export const APPLE_MUSIC_MARKER = 'musickit-authorized-on-this-phone';

export type AppleMarkerStore = Pick<ProviderCredentialStore, 'save' | 'peek' | 'clear'>;

const notMock = { isMock: false } as const;

const errorState = (code: ProviderErrorCode): ConnectionState => ({
  status: 'error',
  code,
  ...notMock,
});

/** What a MusicKit failure means. Only `unavailable` / `not_implemented` are "not in this build". */
function errorCodeOf(error: unknown): ProviderErrorCode {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code: unknown }).code
      : undefined;
  if (code === 'unavailable' || code === 'not_implemented') return 'not_in_this_build';
  return 'provider_unavailable';
}

/** Authorized: is there a subscription, and which storefront? */
async function subscribedState(kit: AppleMusicKit): Promise<ConnectionState> {
  const subscription = await kit.subscription();
  if (!subscription.canPlayCatalogContent) return { status: 'needs_subscription', ...notMock };
  // A storefront is nice to have; failing to read it doesn't block playing.
  const storefront = await kit.storefront().catch(() => null);
  return { status: 'connected', ...notMock, ...(storefront ? { storefront } : {}) };
}

function hasModule(kit: AppleMusicKit): boolean {
  return kit.availability().available;
}

/** "Connect Apple Music": asks iOS for access (once), then checks the subscription. */
export async function connectAppleMusic(
  kit: AppleMusicKit,
  marker: AppleMarkerStore,
): Promise<ConnectionState> {
  if (!hasModule(kit)) return errorState('not_in_this_build');
  let state: ConnectionState;
  try {
    const status = await kit.requestAuthorization();
    if (status === 'not_determined') return { status: 'needs_authorization', ...notMock };
    if (status !== 'authorized') return errorState('permission_denied');
    state = await subscribedState(kit);
  } catch (error) {
    return errorState(errorCodeOf(error));
  }
  if (state.status !== 'connected') return state;
  try {
    await marker.save('apple_music', { accessToken: APPLE_MUSIC_MARKER });
  } catch {
    // Without the marker the next start would drop the connection; say so now.
    return errorState('provider_unavailable');
  }
  return state;
}

/** "Disconnect Apple Music": forgets this account's connection on this phone. */
export async function disconnectAppleMusic(marker: AppleMarkerStore): Promise<void> {
  await marker.clear('apple_music');
}

/**
 * The connection this phone holds, checked without any prompt (startup
 * reconcile). Null when this build can't tell (no module, or the Swift
 * methods aren't built), so a row made on another build stays.
 */
export async function appleMusicConnectionStatus(
  kit: AppleMusicKit,
  marker: AppleMarkerStore,
): Promise<ConnectionState | null> {
  if (!hasModule(kit)) return null;
  const held = await marker.peek('apple_music').catch(() => 'unreadable' as const);
  // A Keychain that can't be read right now isn't "disconnected".
  if (held === 'unreadable') return errorState('provider_unavailable');
  if (held === 'none') return { status: 'needs_authorization', ...notMock };
  try {
    const status = await kit.authorizationStatus();
    if (status !== 'authorized') return { status: 'needs_authorization', ...notMock };
    return await subscribedState(kit);
  } catch (error) {
    const code = errorCodeOf(error);
    return code === 'not_in_this_build' ? null : errorState(code);
  }
}
