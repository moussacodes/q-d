import { z } from 'zod';

import { musicProviderSchema } from './music-provider';
import { idSchema, millisecondsSchema, timestampSchema } from './primitives';

/** What a room is playing, sync slots and what a player can do (docs/API_CONTRACTS.md §5–6). */

export const playbackStatuses = ['playing', 'paused', 'stopped', 'autoplay'] as const;

/** The room's playback, as the host's phone last reported it. */
export const playbackStateSchema = z.object({
  roomId: idSchema,
  entryId: idSchema.nullable(),
  /** `autoplay`: the queue ended and the provider kept playing on its own. */
  status: z.enum(playbackStatuses),
  positionMs: millisecondsSchema,
  /** Server time. */
  reportedAt: timestampSchema,
});
export type PlaybackState = z.infer<typeof playbackStateSchema>;
export type PlaybackStatus = PlaybackState['status'];

/** The most people in a room, and so the most sync slots. */
export const maxRoomParticipants = 15;

export const playbackSlotReadiness = ['ready', 'catching_up', 'sitting_out'] as const;

/** `sync (beta)` only. Slot 1 is always the host. */
export const playbackSlotSchema = z.object({
  roomId: idSchema,
  slot: z.int().min(1).max(maxRoomParticipants),
  userId: idSchema,
  provider: musicProviderSchema,
  readiness: z.enum(playbackSlotReadiness),
});
export type PlaybackSlot = z.infer<typeof playbackSlotSchema>;

/**
 * What a playback adapter can do. The UI asks this instead of checking which
 * provider it is. No adapter claims a capability it doesn't have.
 */
export const playbackCapabilitiesSchema = z.object({
  /** Apple: true. Spotify: false (the Spotify app plays). */
  inAppAudio: z.boolean(),
  /** Keeps playing with the screen locked. */
  backgroundPlayback: z.boolean(),
  /** Spotify: the Spotify app must be installed and active. */
  requiresExternalApp: z.boolean(),
  /** The provider can continue after the queue ends. */
  autoplay: z.boolean(),
  /** True only for mock adapters; the UI labels them. */
  isMock: z.boolean(),
});
export type PlaybackCapabilities = z.infer<typeof playbackCapabilitiesSchema>;
/** The Forge card's name for {@link PlaybackCapabilities}. */
export type ProviderCapabilities = PlaybackCapabilities;
