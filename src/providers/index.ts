import type { MusicProvider } from '@/domain/music-provider';

import { mockCatalog } from './mock/catalog';
import { MockPlaybackAdapter } from './mock/playback';
import type { CatalogAdapter, PlaybackAdapter } from './types';

export type * from './types';

/**
 * The adapters the app uses. Only mock adapters exist so far (data mode
 * `mock`, see services/dataMode); the Apple and Spotify cards add the live
 * ones here.
 */
export const catalog: CatalogAdapter = mockCatalog;

export function createPlayback(provider: MusicProvider): PlaybackAdapter {
  return new MockPlaybackAdapter(provider);
}
