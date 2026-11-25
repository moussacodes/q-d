import { providerNames, type MusicProvider } from './music-provider';

/**
 * Provider autoplay (docs/PRODUCT_SPEC.md §5). When a room's queue runs out
 * in `aux`, the host's service may keep playing songs it picks itself. q’d
 * didn't choose those songs, so it says whose they are. In `sync (beta)`
 * autoplay stays off, because every service would pick different songs.
 */

export type RoomMode = 'aux' | 'sync';

/**
 * Whose songs play once the last queued one has ended: the provider's, when
 * it kept playing on its own in `aux`, or nobody's.
 */
export function afterQueueEnds({
  mode,
  provider,
  providerKeptPlaying,
}: {
  mode: RoomMode;
  /** The service the host's phone plays through. */
  provider: MusicProvider;
  /** The host's player reported a song the provider picked itself. */
  providerKeptPlaying: boolean;
}): { autoplay: MusicProvider | null } {
  return { autoplay: mode === 'aux' && providerKeptPlaying ? provider : null };
}

/** "Autoplay by Spotify". */
export function autoplayLabel(provider: MusicProvider): string {
  return `Autoplay by ${providerNames[provider]}`;
}
