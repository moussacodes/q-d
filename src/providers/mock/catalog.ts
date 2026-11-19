import type { MusicProvider } from '@/domain/music-provider';
import { parseDuration } from '@/domain/time';
import { mockNowPlaying, mockQueue, mockSearchResults, type MockTrack } from './data';

import type { CatalogAdapter, CatalogResult, ProviderTrack } from '../types';

const allProviders: MusicProvider[] = ['apple_music', 'spotify'];

/** Mock fixtures as provider tracks. The id is the fixture id. */
export function toProviderTrack(track: MockTrack): ProviderTrack {
  return {
    provider: track.provider,
    providerTrackId: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: parseDuration(track.duration),
    explicit: false,
    artworkUrl: null,
    artworkBackgroundColor: null,
  };
}

function toResult(track: MockTrack): CatalogResult {
  return {
    track: toProviderTrack(track),
    availableOn: allProviders.filter((provider) => provider !== track.unavailableOn),
  };
}

/** Every fixture track once, in a fixed order. */
const catalog: CatalogResult[] = [mockNowPlaying, ...mockQueue, ...mockSearchResults]
  .filter((track, index, all) => all.findIndex((other) => other.id === track.id) === index)
  .map(toResult);

/** Lowercase, strip accents and punctuation, and treat "&" as "and". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Deterministic catalog search over the fixtures: every word in the query has
 * to appear in the title, artist or album. Results keep catalog order.
 */
export const mockCatalog: CatalogAdapter = {
  provider: 'apple_music',
  async search(query) {
    const words = normalize(query).split(' ').filter(Boolean);
    if (words.length === 0) {
      return [];
    }
    return catalog.filter(({ track }) => {
      const haystack = normalize(`${track.title} ${track.artist} ${track.album}`);
      return words.every((word) => haystack.includes(word));
    });
  },
  async getTrack(id) {
    const found = catalog.find(({ track }) => track.providerTrackId === id);
    if (!found) {
      throw new Error(`Mock catalog has no track ${id}`);
    }
    return found.track;
  },
};
