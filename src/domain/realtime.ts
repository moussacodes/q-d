import { z } from 'zod';

import { idSchema, timestampSchema } from './primitives';
import { roomRoleSchema } from './room';

/**
 * Realtime payloads (docs/API_CONTRACTS.md §4). Events are hints to refetch,
 * not data: they carry IDs and a version, never names, emails or song details.
 *
 * Every payload is untrusted. The parsers below never throw. A payload that
 * isn't a valid, known event comes back as `{ ok: false }`, and the caller
 * ignores it and refetches, because Postgres is the source of truth.
 */

/** The envelope version this client understands. A breaking change bumps it. */
export const realtimeVersion = 1;

/** The private channel for one room. */
export function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}

export const roomEventTypes = [
  /** add, batch add, reorder, remove, advance */
  'queue.changed',
  /** report_playback_state, advance_queue */
  'playback.changed',
  /** join, leave, removal */
  'members.changed',
  'room.ended',
] as const;
export type RoomEventType = (typeof roomEventTypes)[number];

export const roomEventSchema = z.object({
  v: z.literal(realtimeVersion),
  type: z.enum(roomEventTypes),
  roomId: idSchema,
  /** Server time. */
  at: timestampSchema,
});
export type RoomEvent = z.infer<typeof roomEventSchema>;

export const roomPresenceSchema = z.object({
  v: z.literal(realtimeVersion),
  userId: idSchema,
  role: roomRoleSchema,
});
export type RoomPresence = z.infer<typeof roomPresenceSchema>;

/**
 * Why a payload was ignored:
 * - `unsupported_version`: a newer (or unknown) envelope `v`;
 * - `unknown_type`: an event type this client doesn't know yet;
 * - `wrong_room`: a valid event for a different room than the channel's;
 * - `invalid`: anything else that doesn't match the schema.
 */
export type RealtimeRejection = 'unsupported_version' | 'unknown_type' | 'wrong_room' | 'invalid';

/**
 * Where a payload failed, by field path and Zod issue code only. It never
 * holds the payload's values, so it's safe to log.
 */
export type RealtimeIssue = { path: string; code: string };

export type RealtimeParseResult<T> =
  { ok: true; value: T } | { ok: false; reason: RealtimeRejection; issues: RealtimeIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reject(reason: RealtimeRejection, issues: RealtimeIssue[] = []) {
  return { ok: false as const, reason, issues };
}

/** Checks the envelope version before anything else, so a newer envelope is never misread. */
function checkVersion(payload: unknown) {
  if (!isRecord(payload)) return reject('invalid', [{ path: '', code: 'not_an_object' }]);
  const { v } = payload;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return reject('invalid', [{ path: 'v', code: 'invalid_version' }]);
  }
  if (v !== realtimeVersion) return reject('unsupported_version');
  return null;
}

function issuesOf(error: z.ZodError): RealtimeIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }));
}

/**
 * Parses a broadcast on a room channel. Pass the channel's room id as
 * `expectedRoomId` to reject events that name a different room.
 */
export function parseRoomEvent(
  payload: unknown,
  expectedRoomId?: string,
): RealtimeParseResult<RoomEvent> {
  const versionProblem = checkVersion(payload);
  if (versionProblem) return versionProblem;
  const { type } = payload as Record<string, unknown>;
  if (typeof type === 'string' && !(roomEventTypes as readonly string[]).includes(type)) {
    return reject('unknown_type');
  }
  const parsed = roomEventSchema.safeParse(payload);
  if (!parsed.success) return reject('invalid', issuesOf(parsed.error));
  if (expectedRoomId !== undefined && parsed.data.roomId !== expectedRoomId) {
    return reject('wrong_room');
  }
  return { ok: true, value: parsed.data };
}

/** Parses one presence entry on a room channel. */
export function parseRoomPresence(payload: unknown): RealtimeParseResult<RoomPresence> {
  const versionProblem = checkVersion(payload);
  if (versionProblem) return versionProblem;
  const parsed = roomPresenceSchema.safeParse(payload);
  if (!parsed.success) return reject('invalid', issuesOf(parsed.error));
  return { ok: true, value: parsed.data };
}
