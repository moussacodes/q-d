import { UnavailableCatalogAdapter, UnavailablePlaybackAdapter } from '../unavailable';

export { CATALOG_SEARCH_FUNCTION, createAppleMusicCatalog } from './catalog';
export {
  APPLE_MUSIC_MARKER,
  appleMusicConnectionStatus,
  connectAppleMusic,
  disconnectAppleMusic,
  type AppleMarkerStore,
  type AppleMusicKit,
} from './connection';

/**
 * Apple Music. The real adapters wrap `modules/qd-music-kit` (MusicKit,
 * in-app audio, background playback) and need a development build on the
 * Mac. Until that card lands and is tested on an iPhone, these say "not in
 * this build" instead of pretending to work.
 */
export const appleMusicCatalog = new UnavailableCatalogAdapter('apple_music');
// The live canonical catalog is `createAppleMusicCatalog` (./catalog.ts). It
// needs a Supabase session and the catalog-search Edge Function, so the app
// wires it in once live data mode exists (the Supabase client card).

export { AppleMusicPlaybackAdapter, type AppleMusicPlaybackDeps } from './playback';

/** The stand-in when real Apple Music isn't in this build (no native module). */
export function createAppleMusicPlayback() {
  return new UnavailablePlaybackAdapter('apple_music');
}
