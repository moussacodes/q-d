import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { env } from '@/services/env';
import { providerCredentials } from '@/services/providerCredentials';

import { UnavailableCatalogAdapter } from '../unavailable';
import { createSpotifyApi, type SpotifyApi } from './api';
import { createSpotifyAuth, type SpotifyAuth } from './auth';
import { SPOTIFY_REDIRECT_PATH, type FetchLike } from './config';
import type { PkceCrypto } from './pkce';
import { SpotifyPlaybackAdapter } from './playback';

export { connectSpotify, disconnectSpotify, spotifyConnectionStatus } from './connection';

/**
 * Spotify. q’d remote-controls the Spotify app; it never streams, relays or
 * rebroadcasts Spotify audio. Connecting an account (Authorization Code with
 * PKCE) and playback over the Web API are built but untested on a device,
 * and only used when the `realSpotify` flag is on. The catalog still says
 * "not in this build" until its card lands.
 */
export const spotifyCatalog = new UnavailableCatalogAdapter('spotify');

/** A player that remote-controls this phone's Spotify app (Web API). */
export function createSpotifyPlayback(): SpotifyPlaybackAdapter {
  return new SpotifyPlaybackAdapter(spotify());
}

const expoCrypto: PkceCrypto = {
  randomBytes: (count) => Crypto.getRandomBytes(count),
  sha256Base64: (text) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
};

/**
 * `qd://spotify-auth` in a development build. In Expo Go it's an `exp://`
 * URL with the computer's address, which Spotify's dashboard must list too.
 */
export function spotifyRedirectUri(): string {
  try {
    return Linking.createURL(SPOTIFY_REDIRECT_PATH);
  } catch {
    // No manifest to read the scheme from (tests, some web setups).
    return `qd://${SPOTIFY_REDIRECT_PATH}`;
  }
}

let instance: { auth: SpotifyAuth; api: SpotifyApi } | null = null;

/** The app's Spotify auth and API client, created on first use. */
export function spotify(): { auth: SpotifyAuth; api: SpotifyApi } {
  if (!instance) {
    const fetchLike: FetchLike = (url, init) => globalThis.fetch(url, init);
    const auth = createSpotifyAuth({
      clientId: env.spotifyClientId,
      redirectUri: spotifyRedirectUri(),
      fetch: fetchLike,
      crypto: expoCrypto,
      openAuthSession: (url, redirectUri) => WebBrowser.openAuthSessionAsync(url, redirectUri),
      store: providerCredentials,
    });
    instance = { auth, api: createSpotifyApi({ auth, fetch: fetchLike }) };
  }
  return instance;
}
