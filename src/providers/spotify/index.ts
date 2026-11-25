import { UnavailableCatalogAdapter, UnavailablePlaybackAdapter } from '../unavailable';

/**
 * Spotify. The real adapter remote-controls the installed Spotify app (App
 * Remote and the Web API); q’d never streams Spotify audio. Until that card
 * lands and is tested on an iPhone, these say "not in this build" instead of
 * pretending to work.
 */
export const spotifyCatalog = new UnavailableCatalogAdapter('spotify');

export function createSpotifyPlayback() {
  return new UnavailablePlaybackAdapter('spotify');
}
