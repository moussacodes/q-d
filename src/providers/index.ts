import type { MusicProvider } from '@/domain/music-provider';
import { isEnabled } from '@/services/flags';

import { mockCatalog } from './mock/catalog';
import { MockPlaybackAdapter } from './mock/playback';
import { connectSpotify, disconnectSpotify, spotify } from './spotify';
import type { CatalogAdapter, ConnectionState, PlaybackAdapter } from './types';

export type * from './types';
export { isProviderError, ProviderError } from './errors';

/**
 * The adapters the app uses. Data mode `mock` is the only mode so far (see
 * services/dataMode), so the app gets the labeled mock adapters. The Apple
 * Music and Spotify adapters in `./apple` and `./spotify` are stubs that
 * report "not in this build"; their cards wire the live ones in here.
 */
export const catalog: CatalogAdapter = mockCatalog;

export function createPlayback(provider: MusicProvider): PlaybackAdapter {
  return new MockPlaybackAdapter(provider);
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

/** "Disconnect": real Spotify forgets its tokens on this phone. Mocks hold none. */
export async function disconnectProvider(provider: MusicProvider): Promise<void> {
  if (provider === 'spotify' && usesRealSpotify()) {
    await disconnectSpotify(spotify().auth);
  }
}
