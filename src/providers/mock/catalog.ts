import { musicProviders, type MusicProvider } from '@/domain/music-provider';
import { parseDuration } from '@/domain/time';

import { ProviderError } from '../errors';
import { parseProviderLink } from '../links';
import type { CatalogAdapter, CatalogResult, ProviderEntity, ProviderTrack } from '../types';
import { mockNowPlaying, mockQueue, mockSearchResults, type MockTrack } from './data';

/**
 * Mock fixtures as provider tracks. The id is the fixture id. Fixtures carry
 * no ISRC and are never explicit, so nothing here pretends to be real
 * provider metadata.
 */
export function toProviderTrack(track: MockTrack): ProviderTrack {
  return {
    provider: track.provider,
    providerTrackId: track.id,
    title: track.title,
    artists: [track.artist],
    album: track.album,
    durationMs: parseDuration(track.duration),
    isrc: null,
    explicit: false,
    artworkUrl: null,
    // The canonical catalog is Apple's, which supplies this color.
    artworkBackgroundColor: track.artworkColor,
  };
}

function toResult(track: MockTrack): CatalogResult {
  return {
    track: toProviderTrack(track),
    availableOn: musicProviders.filter((provider) => provider !== track.unavailableOn),
  };
}

/** Every fixture track once, in a fixed order. */
const catalog: readonly CatalogResult[] = [mockNowPlaying, ...mockQueue, ...mockSearchResults]
  .filter((track, index, all) => all.findIndex((other) => other.id === track.id) === index)
  .map(toResult);

/**
 * Made-up share-link ids for a few fixtures, so link resolving can be tried in
 * mock mode. They aren't real Apple Music or Spotify ids.
 * e.g. `https://music.apple.com/us/song/always/1000000002`.
 */
export const mockLinkIds: Readonly<Record<MusicProvider, Readonly<Record<string, string>>>> = {
  apple_music: { '1000000001': 'q1', '1000000002': 'q2', '1000000003': 'q3' },
  spotify: { '0000000000000000000001': 'q1', '0000000000000000000002': 'q2' },
};

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

/** A copy, so a caller changing a result can't change the catalog. */
function copy(result: CatalogResult): CatalogResult {
  return {
    track: { ...result.track, artists: [...result.track.artists] },
    availableOn: [...result.availableOn],
  };
}

function find(id: string): CatalogResult {
  const found = catalog.find(({ track }) => track.providerTrackId === id);
  if (!found)
    throw new ProviderError('not_found', 'apple_music', `Mock catalog has no track ${id}`);
  return found;
}

/**
 * The mock canonical catalog. Search is deterministic: every word in the query
 * has to appear in the title, artists or album, and results keep catalog order.
 * It has no playlists (playlist import is post-demo), so `getPlaylist` is absent.
 */
export const mockCatalog: CatalogAdapter = {
  provider: 'apple_music',
  async search(query) {
    const words = normalize(query).split(' ').filter(Boolean);
    if (words.length === 0) {
      return [];
    }
    return catalog
      .filter(({ track }) => {
        const haystack = normalize(
          `${track.title} ${track.artists.join(' ')} ${track.album ?? ''}`,
        );
        return words.every((word) => haystack.includes(word));
      })
      .map(copy);
  },
  async resolveLink(url): Promise<ProviderEntity> {
    const link = parseProviderLink(url);
    if (!link) {
      throw new ProviderError('unsupported_link', 'apple_music', 'Not a supported music link');
    }
    if (link.kind === 'playlist') {
      return { kind: 'playlist', provider: link.provider, playlistId: link.id };
    }
    const fixtureId = mockLinkIds[link.provider][link.id];
    if (!fixtureId) {
      throw new ProviderError('not_found', 'apple_music', 'Mock catalog has no track for link');
    }
    return { kind: 'track', track: copy(find(fixtureId)).track };
  },
  async getTrack(id) {
    return copy(find(id)).track;
  },
};
