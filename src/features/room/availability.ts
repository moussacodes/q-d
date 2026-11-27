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
 * `availableOn` still says whether the service has the song, but only for
 * the services it checked (`checkedOn`). Live search checks only Apple Music,
 * so on Spotify a song stays `unknown` until it's matched: it isn't "Not on
 * Spotify" just because nobody has looked.
 */
export function resultAvailability(
  result: CatalogResult,
  playsThrough: MusicProvider,
): TrackAvailability {
  const availability = availabilityOf(result.matches?.[playsThrough]);
  if (availability.kind !== 'unknown') return availability;
  if (result.availableOn.includes(playsThrough)) {
    // The catalog has it but no match is stored: the mock catalog, or Apple
    // Music's own songs in live search.
    return result.checkedOn ? { kind: 'playable', confidence: 100 } : availability;
  }
  const checked = result.checkedOn ?? [playsThrough];
  return checked.includes(playsThrough) ? { kind: 'unavailable' } : availability;
}

/**
 * Whether a result belongs under a service's filter chip: it's on that
 * service, or nobody has checked yet (unknown, not ruled out).
 */
export function mayBeOn(result: CatalogResult, provider: MusicProvider): boolean {
  if (result.availableOn.includes(provider)) return true;
  return !(result.checkedOn ?? [provider]).includes(provider);
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
    case 'unknown':
      return `${service} version not matched yet`;
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

/**
 * The note under a queued song: the host's "Wrong version?" pick says so, so
 * listeners know why the song may sound different; otherwise `queueNote`.
 */
export function entryNote(track: Pick<MockTrack, 'matches'>, playsThrough: MusicProvider) {
  if (track.matches?.[playsThrough]?.method === 'override') return 'Version picked by the host';
  return queueNote(entryAvailability(track, playsThrough), playsThrough);
}
