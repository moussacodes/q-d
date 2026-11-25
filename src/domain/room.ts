import { z } from 'zod';

import { musicProviderSchema, playbackModeSchema } from './music-provider';
import { idSchema, timestampSchema } from './primitives';

/** Rooms and their members (docs/API_CONTRACTS.md §6). */

/** The six stored characters of a room code, uppercase. It's shown as `QD-${code}`. */
export const roomCodeSchema = z.string().regex(/^[A-Z0-9]{6}$/, 'Invalid room code');

export const roomStates = ['live', 'paused', 'ended'] as const;

export const roomSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  hostId: idSchema,
  /** `aux` unless the `sync` flag is on. */
  mode: playbackModeSchema,
  state: z.enum(roomStates),
  playbackProvider: musicProviderSchema,
  code: roomCodeSchema,
  codeExpiresAt: timestampSchema,
  createdAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
});
export type Room = z.infer<typeof roomSchema>;

export const roomRoles = ['host', 'member'] as const;
export const roomRoleSchema = z.enum(roomRoles);
export type RoomRole = z.infer<typeof roomRoleSchema>;

export const roomMemberSchema = z.object({
  roomId: idSchema,
  userId: idSchema,
  role: roomRoleSchema,
  displayName: z.string().min(1),
  color: z.string().min(1),
  joinedAt: timestampSchema,
});
export type RoomMember = z.infer<typeof roomMemberSchema>;
