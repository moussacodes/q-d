import {
  describeCatalogAdapterContract,
  describePlaybackAdapterContract,
} from '@/test/providerContract';

import { appleMusicCatalog, createAppleMusicPlayback } from './apple';
import { catalog, createPlayback } from './index';
import { mockCatalog, toProviderTrack } from './mock/catalog';
import { mockQueue } from './mock/data';
import { MockPlaybackAdapter } from './mock/playback';
import { createSpotifyPlayback, spotifyCatalog } from './spotify';
import type { MusicProvider } from './types';

/** The shared contract suite (src/test/providerContract.ts) against every adapter. */

const tracksFor = (provider: MusicProvider) =>
  [mockQueue[0], mockQueue[1]].map((track) => ({ ...toProviderTrack(track), provider })) as [
    ReturnType<typeof toProviderTrack>,
    ReturnType<typeof toProviderTrack>,
  ];

for (const provider of ['apple_music', 'spotify'] as const) {
  describePlaybackAdapterContract({
    name: `Mock ${provider}`,
    create: () => new MockPlaybackAdapter(provider, () => 0),
    isMock: true,
    available: true,
    tracks: tracksFor(provider),
  });
}

describePlaybackAdapterContract({
  name: 'Apple Music (not in this build)',
  create: createAppleMusicPlayback,
  isMock: false,
  available: false,
});

describePlaybackAdapterContract({
  name: 'Spotify (not in this build)',
  create: createSpotifyPlayback,
  isMock: false,
  available: false,
});

describeCatalogAdapterContract({
  name: 'Mock catalog',
  create: () => mockCatalog,
  available: true,
  query: 'daniel caesar',
  trackId: 'q2',
});

describeCatalogAdapterContract({
  name: 'Apple Music catalog (not in this build)',
  create: () => appleMusicCatalog,
  available: false,
});

describeCatalogAdapterContract({
  name: 'Spotify catalog (not in this build)',
  create: () => spotifyCatalog,
  available: false,
});

describe('the adapters the app uses', () => {
  it('are the labeled mocks while data mode is mock', async () => {
    expect(catalog).toBe(mockCatalog);
    for (const provider of ['apple_music', 'spotify'] as const) {
      const player = createPlayback(provider);
      expect(player.provider).toBe(provider);
      expect(player.capabilities().isMock).toBe(true);
      expect(await player.connect()).toMatchObject({ status: 'connected', isMock: true });
    }
  });

  it('give each caller its own player', () => {
    expect(createPlayback('spotify')).not.toBe(createPlayback('spotify'));
  });
});
