import { z } from 'zod';

import { musicProviderSchema } from './music-provider';
import { idSchema, timestampSchema } from './primitives';

/** The room queue and playlist imports (docs/API_CONTRACTS.md §6). */

export const queueEntryStatuses = ['queued', 'playing', 'played', 'removed'] as const;

export const queueEntrySchema = z.object({
  id: idSchema,
  roomId: idSchema,
  recordingId: idSchema,
  /** Server-assigned. Clients only sort by it. */
  position: z.number(),
  /** `null` after the person who added it deletes their account. */
  addedBy: idSchema.nullable(),
  /** Set when the entry came from a playlist import. */
  batchId: idSchema.nullable(),
  status: z.enum(queueEntryStatuses),
  addedAt: timestampSchema,
});
export type QueueEntry = z.infer<typeof queueEntrySchema>;
export type QueueEntryStatus = QueueEntry['status'];

/** Post-demo, behind the playlist-import flag. At most 50 songs per import. */
export const playlistImportLimit = 50;

export const playlistImportStatuses = [
  'previewing',
  'importing',
  'done',
  'undone',
  'failed',
] as const;

const count = z.int().nonnegative();

export const playlistImportBatchSchema = z
  .object({
    id: idSchema,
    roomId: idSchema,
    provider: musicProviderSchema,
    sourceName: z.string(),
    itemCount: count,
    addedCount: count,
    skippedCount: count,
    status: z.enum(playlistImportStatuses),
  })
  .refine((batch) => batch.addedCount + batch.skippedCount <= batch.itemCount, {
    message: 'added + skipped exceeds the item count',
    path: ['addedCount'],
  });
export type PlaylistImportBatch = z.infer<typeof playlistImportBatchSchema>;
