import type { MusicProvider } from '@/domain/music-provider';
import { isEnabled } from '@/services/flags';
import { providerCredentials } from '@/services/providerCredentials';

import { QdMusicKit } from '../../modules/qd-music-kit';
import {
  AppleMusicPlaybackAdapter,
  appleMusicConnectionStatus,
  connectAppleMusic,
  createAppleMusicPlayback,
  disconnectAppleMusic,
} from './apple';
import { mockCatalog } from './mock/catalog';
import { MockPlaybackAdapter } from './mock/playback';
import { mockVersions } from './mock/versions';
import {
  connectSpotify,
  createSpotifyPlayback,
  disconnectSpotify,
  spotify,
  spotifyConnectionStatus,
} from './spotify';
import type { CatalogAdapter, ConnectionState, PlaybackAdapter, VersionSource } from './types';

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

/** The versions "Wrong version?" offers. Mock only until the live provider cards. */
export const versions: VersionSource = mockVersions;

/**
 * A player for this phone. Spotify with the `realSpotify` flag on
 * remote-controls the Spotify app. Apple Music with `realAppleMusic` on
 * plays inside q’d through MusicKit when the native module is here (the q’d
 * app build); without it (Expo Go, web) it's the "not in this build" stand-in,
 * never the mock. Everything else is the labeled mock.
 */
export function createPlayback(provider: MusicProvider): PlaybackAdapter {
  if (provider === 'apple_music' && usesRealAppleMusic()) {
    return QdMusicKit.availability().available
      ? new AppleMusicPlaybackAdapter({ kit: QdMusicKit, marker: providerCredentials })
      : createAppleMusicPlayback();
  }
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
 * Whether this build talks to MusicKit for Apple Music. Off by default
 * (`EXPO_PUBLIC_FLAG_REAL_APPLE_MUSIC`): it's built but untested on a
 * device. With it on in Expo Go or on the web, Apple Music says it needs the
 * q’d app build instead of connecting the mock.
 */
export function usesRealAppleMusic(): boolean {
  return isEnabled('realAppleMusic');
}

/**
 * "Connect" for a music service. Real Spotify (flag on) opens Spotify's
 * sign-in sheet and stores the tokens on this phone. Real Apple Music (flag
 * on) asks iOS for Apple Music access through MusicKit. Everything else
 * connects the labeled mock.
 */
export async function connectProvider(provider: MusicProvider): Promise<ConnectionState> {
  if (provider === 'apple_music' && usesRealAppleMusic()) {
    return connectAppleMusic(QdMusicKit, providerCredentials);
  }
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
 * - Apple Music with `realAppleMusic` on: this account's marker on this
 *   phone, then MusicKit's authorization and subscription, never a prompt.
 *   Null without the native module (Expo Go, web) or before the Swift
 *   methods exist, so a row made on another build stays.
 */
export async function storedConnection(provider: MusicProvider): Promise<ConnectionState | null> {
  if (provider === 'apple_music' && usesRealAppleMusic()) {
    return appleMusicConnectionStatus(QdMusicKit, providerCredentials);
  }
  if (provider === 'spotify' && usesRealSpotify()) {
    const { auth, api } = spotify();
    return spotifyConnectionStatus(auth, api);
  }
  return null;
}

/**
 * "Disconnect": real Spotify forgets its tokens on this phone, and real
 * Apple Music its marker (iOS keeps q’d's MusicKit permission; only Settings
 * can take it back). Mocks hold none.
 */
export async function disconnectProvider(provider: MusicProvider): Promise<void> {
  if (provider === 'apple_music' && usesRealAppleMusic()) {
    await disconnectAppleMusic(providerCredentials);
    return;
  }
  if (provider === 'spotify' && usesRealSpotify()) {
    await disconnectSpotify(spotify().auth);
  }
}
