import { availabilityOf, type TrackAvailability } from '@/domain/availability';
import { providerNames, type MusicProvider } from '@/domain/music-provider';
import type { CatalogResult } from '@/providers';
import type { MockTrack } from '@/providers/mock/data';

/**
 * How a song stands on the service the room plays through (PRODUCT_SPEC.md §6),
 * read from its stored track match. See `availabilityOf` in src/domain.
 */
export function entryAvailability(
  track: Pick<MockTrack, 'matches'>,
  playsThrough: MusicProvider,
): TrackAvailability {
  return availabilityOf(track.matches?.[playsThrough]);
}

/**
 * A search result's availability. Without a stored match yet, the catalog's
 * `availableOn` still says whether the service has the song at all.
 */
export function resultAvailability(
  result: CatalogResult,
  playsThrough: MusicProvider,
): TrackAvailability {
  const availability = availabilityOf(result.matches?.[playsThrough]);
  if (availability.kind === 'unknown' && !result.availableOn.includes(playsThrough)) {
    return { kind: 'unavailable' };
  }
  return availability;
}

/** The availability line under a search result. */
export function availabilityLabel(availability: TrackAvailability, playsThrough: MusicProvider) {
  const service = providerNames[playsThrough];
  switch (availability.kind) {
    case 'unavailable':
      return `Not on ${service}`;
    case 'uncertain':
      return availability.warning === 'explicit_conflict'
        ? `Explicit/clean version differs on ${service}`
        : `Closest match on ${service} · may be another version`;
    default:
      return `On ${service}`;
  }
}

/** The warning under a queued song, or nothing when it will play as found. */
export function queueNote(availability: TrackAvailability, playsThrough: MusicProvider) {
  const service = providerNames[playsThrough];
  switch (availability.kind) {
    case 'unavailable':
      return `Not on ${service} · the host can skip it`;
    case 'uncertain':
      return availability.warning === 'explicit_conflict'
        ? `Explicit/clean version differs on ${service}`
        : `May be another version on ${service}`;
    default:
      return undefined;
  }
}
