import { UnavailableCatalogAdapter, UnavailablePlaybackAdapter } from '../unavailable';

/**
 * Apple Music. The real adapters wrap `modules/qd-music-kit` (MusicKit,
 * in-app audio, background playback) and need a development build on the
 * Mac. Until that card lands and is tested on an iPhone, these say "not in
 * this build" instead of pretending to work.
 */
export const appleMusicCatalog = new UnavailableCatalogAdapter('apple_music');

export function createAppleMusicPlayback() {
  return new UnavailablePlaybackAdapter('apple_music');
}
