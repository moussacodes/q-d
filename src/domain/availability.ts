import type { TrackMatch, TrackMatchWarning } from './recording';

/**
 * What a song's stored track match (docs/API_CONTRACTS.md §6, `TrackMatch`)
 * means for the room (PRODUCT_SPEC.md §6). Clients read the match the server
 * stored; they never rematch. Pure, so every phone shows the same answer.
 *
 * - `playable`: matched automatically (ISRC or a clear score) or picked by the
 *   host ("Wrong version?"). Plays without comment.
 * - `uncertain`: the closest track is kept with a warning (rule 7). It plays,
 *   but never silently: everyone sees the warning, and the host can skip it
 *   or, with the override card, pick the right version.
 * - `unavailable`: no track on this service is this recording. The host's
 *   phone never plays a stand-in; the host skips it or switches services.
 * - `unknown`: no match is stored yet. Mappings are resolved when playback
 *   needs them, so the host's phone waits rather than guess.
 */
export type TrackAvailability =
  | { kind: 'playable'; confidence: number }
  | { kind: 'uncertain'; warning: TrackMatchWarning; confidence: number }
  | { kind: 'unavailable' }
  | { kind: 'unknown' };

export type TrackAvailabilityKind = TrackAvailability['kind'];

export function availabilityOf(match: TrackMatch | null | undefined): TrackAvailability {
  if (!match) return { kind: 'unknown' };
  if (match.providerTrackId === null) return { kind: 'unavailable' };
  // An override is the host's own choice, so it never carries a warning.
  if (match.method === 'override') return { kind: 'playable', confidence: match.confidence };
  if (match.warning) {
    return { kind: 'uncertain', warning: match.warning, confidence: match.confidence };
  }
  return { kind: 'playable', confidence: match.confidence };
}

/**
 * Whether the host's phone may start the song. An uncertain match plays with
 * its warning showing; an unavailable or unresolved one never does.
 */
export function canPlayOnHostPhone(availability: TrackAvailability): boolean {
  return availability.kind === 'playable' || availability.kind === 'uncertain';
}
