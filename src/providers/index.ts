import type { MusicProvider } from '@/domain/music-provider';

import { mockCatalog } from './mock/catalog';
import { MockPlaybackAdapter } from './mock/playback';
import type { CatalogAdapter, PlaybackAdapter } from './types';

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
