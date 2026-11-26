import type { MusicProvider } from '@/domain/music-provider';
import { isEnabled } from '@/services/flags';

import { mockCatalog } from './mock/catalog';
import { MockPlaybackAdapter } from './mock/playback';
import {
  connectSpotify,
  createSpotifyPlayback,
  disconnectSpotify,
  spotify,
  spotifyConnectionStatus,
} from './spotify';
import type { CatalogAdapter, ConnectionState, PlaybackAdapter } from './types';

export type * from './types';
export { isProviderError, ProviderError } from './errors';
/** Canonical search through the catalog-search Edge Function; the app wires it in live mode. */
export { createAppleMusicCatalog } from './apple';

/**
 * The adapters the app uses. Data mode `mock` is the only mode so far (see
 * services/dataMode), so the app gets the labeled mock adapters. The Apple
 * Music and Spotify adapters in `./apple` and `./spotify` are stubs that
 * report "not in this build"; their cards wire the live ones in here.
 */
export const catalog: CatalogAdapter = mockCatalog;

/**
 * A player for this phone. Spotify with the `realSpotify` flag on
 * remote-controls the Spotify app; everything else is the labeled mock.
 */
export function createPlayback(provider: MusicProvider): PlaybackAdapter {
  if (provider === 'spotify' && usesRealSpotify()) return createSpotifyPlayback();
  // Both services can autoplay once the queue ends; the mock does too, labeled.
  return new MockPlaybackAdapter(provider, Date.now, { autoplay: true });
}

/**
 * Whether this build talks to the real Spotify account flow. Off by default
 * (`EXPO_PUBLIC_FLAG_REAL_SPOTIFY`): it's built but untested on a device.
 */
export function usesRealSpotify(): boolean {
  return isEnabled('realSpotify');
}

/**
 * "Connect" for a music service. Real Spotify (flag on) opens Spotify's
 * sign-in sheet and stores the tokens on this phone. Everything else connects
 * the labeled mock.
 */
export async function connectProvider(provider: MusicProvider): Promise<ConnectionState> {
  if (provider === 'spotify' && usesRealSpotify()) {
    const { auth, api } = spotify();
    return connectSpotify(auth, api);
  }
  return createPlayback(provider).connect();
}

/**
 * A real connection this phone already holds, checked without opening any
 * sign-in sheet: for startup, before trusting a `provider_connections` row.
 * Null when this build can't tell: the labeled mock holds nothing to check.
 *
 * - Spotify with `realSpotify` on: the stored tokens, checked with Spotify.
 * - Apple Music: always null for now. The MusicKit path needs the Mac
 *   (`modules/qd-music-kit`); the Apple card answers here whether this phone
 *   is authorized, and the rows then follow it the same way.
 */
export async function storedConnection(provider: MusicProvider): Promise<ConnectionState | null> {
  if (provider === 'spotify' && usesRealSpotify()) {
    const { auth, api } = spotify();
    return spotifyConnectionStatus(auth, api);
  }
  return null;
}

/** "Disconnect": real Spotify forgets its tokens on this phone. Mocks hold none. */
export async function disconnectProvider(provider: MusicProvider): Promise<void> {
  if (provider === 'spotify' && usesRealSpotify()) {
    await disconnectSpotify(spotify().auth);
  }
}
