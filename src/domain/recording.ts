import { z } from 'zod';

import { musicProviderSchema } from './music-provider';
import { idSchema, isrcSchema, millisecondsSchema, versionTagSchema } from './primitives';

/**
 * Songs (docs/API_CONTRACTS.md §6, PRODUCT_SPEC.md §6). A canonical recording is
 * q’d's one copy of a song; each provider has its own track for it, and a track
 * match links the two.
 */

export const canonicalRecordingSchema = z.object({
  id: idSchema,
  title: z.string().min(1),
  primaryArtist: z.string().min(1),
  artists: z.array(z.string().min(1)).min(1),
  album: z.string().nullable(),
  durationMs: millisecondsSchema,
  isrc: isrcSchema.nullable(),
  explicit: z.boolean(),
  /** 'live', 'remix', 'acoustic', 'sped_up', … */
  versionTags: z.array(versionTagSchema),
});
export type CanonicalRecording = z.infer<typeof canonicalRecordingSchema>;

export const providerTrackSchema = z.object({
  provider: musicProviderSchema,
  providerTrackId: z.string().min(1),
  title: z.string().min(1),
  artists: z.array(z.string().min(1)).min(1),
  /** Added by the provider adapters card: matching scores album context. */
  album: z.string().nullable(),
  durationMs: millisecondsSchema,
  isrc: isrcSchema.nullable(),
  explicit: z.boolean(),
  artworkUrl: z.string().nullable(),
  /** Apple only. Spotify screens use provider-neutral colors (ARCHITECTURE.md §4.2). */
  artworkBackgroundColor: z.string().nullable(),
});
export type ProviderTrack = z.infer<typeof providerTrackSchema>;

/** Artists as one line of text: `['Delerium', 'Sarah McLachlan']` → "Delerium, Sarah McLachlan". */
export function formatArtists(artists: readonly string[]): string {
  return artists.join(', ');
}

export const trackMatchMethods = ['isrc', 'score', 'override'] as const;
export const trackMatchWarnings = ['low_confidence', 'explicit_conflict'] as const;

export const trackMatchSchema = z.object({
  recordingId: idSchema,
  provider: musicProviderSchema,
  /** `null` = not available on this provider. */
  providerTrackId: z.string().min(1).nullable(),
  /** 0–100. */
  confidence: z.number().min(0).max(100),
  method: z.enum(trackMatchMethods),
  warning: z.enum(trackMatchWarnings).nullable(),
});
export type TrackMatch = z.infer<typeof trackMatchSchema>;
export type TrackMatchMethod = TrackMatch['method'];
export type TrackMatchWarning = NonNullable<TrackMatch['warning']>;
