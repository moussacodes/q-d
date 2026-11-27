import { z } from 'zod';

import { musicProviderSchema, type MusicProvider } from './music-provider';
import { idSchema, timestampSchema } from './primitives';
import type { TrackMatch } from './recording';

/**
 * The host's "Wrong version?" choice (PRODUCT_SPEC.md §6, rule 8): a
 * `track_match_overrides` row, written only by `override_track_match`
 * (API_CONTRACTS.md § override_track_match). It belongs to one room. Rows are
 * never updated, so they're the audit trail; the newest one for a recording
 * and service wins.
 */
export const trackMatchOverrideSchema = z.object({
  id: idSchema,
  roomId: idSchema,
  recordingId: idSchema,
  provider: musicProviderSchema,
  providerTrackId: z.string().min(1).max(200),
  /** Null once the host deletes their account. */
  createdBy: idSchema.nullable(),
  createdAt: timestampSchema,
});
export type TrackMatchOverride = z.infer<typeof trackMatchOverrideSchema>;

/** The fields that order overrides and say what they're for. */
export type OverrideKey = Pick<TrackMatchOverride, 'id' | 'recordingId' | 'provider' | 'createdAt'>;

/** The newest override for a recording on one service, or null when the host hasn't picked one. */
export function latestOverride<T extends OverrideKey>(
  overrides: readonly T[],
  recordingId: string,
  provider: MusicProvider,
): T | null {
  let newest: T | null = null;
  for (const override of overrides) {
    if (override.recordingId !== recordingId || override.provider !== provider) continue;
    if (newest === null) {
      newest = override;
      continue;
    }
    const order = compareInstants(override.createdAt, newest.createdAt);
    // Same instant: the larger id, like the server's `order by created_at desc, id desc`.
    if (order > 0 || (order === 0 && override.id > newest.id)) newest = override;
  }
  return newest;
}

/**
 * Orders two server timestamps to the microsecond, like Postgres `timestamptz`.
 * `Date.parse` keeps only milliseconds, so two picks in the same millisecond
 * would otherwise tie here while the server tells them apart.
 */
function compareInstants(a: string, b: string): number {
  const [aSeconds, aMicros] = instant(a);
  const [bSeconds, bMicros] = instant(b);
  return aSeconds !== bSeconds ? aSeconds - bSeconds : aMicros - bMicros;
}

function instant(timestamp: string): [seconds: number, micros: number] {
  const fraction = /\.(\d+)/.exec(timestamp)?.[1] ?? '';
  const seconds = Date.parse(timestamp.replace(/\.\d+/, ''));
  return [seconds, Number(fraction.padEnd(6, '0').slice(0, 6))];
}

/**
 * The match a room plays: the host's override when there is one, otherwise
 * the stored automatic match. An override always wins (DECISIONS 2026-11-24)
 * and carries no warning, so `availabilityOf` reads it as `playable`.
 */
export function overriddenMatch(
  stored: TrackMatch | null | undefined,
  override: Pick<TrackMatchOverride, 'recordingId' | 'provider' | 'providerTrackId'> | null,
): TrackMatch | null {
  if (!override) return stored ?? null;
  return {
    recordingId: override.recordingId,
    provider: override.provider,
    providerTrackId: override.providerTrackId,
    confidence: 100,
    method: 'override',
    warning: null,
  };
}
