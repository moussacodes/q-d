import type { RoomEventType } from '@/domain/realtime';

/**
 * TanStack Query keys for a room's server state (docs/ARCHITECTURE.md §4.12).
 * Everything about one room lives under `['room', roomId]`, so a refetch of
 * the whole room is one prefix. Keys hold ids, never names or codes in free
 * text, and the query client never logs them.
 */
export const roomKeys = {
  /** Every room query. */
  all: ['room'] as const,
  /** Everything about one room. */
  room: (roomId: string) => ['room', roomId] as const,
  /** The room row: name, host, state, rules, the service it plays through. */
  detail: (roomId: string) => ['room', roomId, 'detail'] as const,
  /** Who's in the room, with their profiles. */
  members: (roomId: string) => ['room', roomId, 'members'] as const,
  /** The queue: the playing entry and the waiting ones, in order. */
  queue: (roomId: string) => ['room', roomId, 'queue'] as const,
  /** The room's playback state row. */
  playback: (roomId: string) => ['room', roomId, 'playback'] as const,
  /** Which room a code opens, for `/room/QD-…` links. */
  byCode: (code: string) => ['room-code', code] as const,
  /** The rooms you're in, for Home. */
  mine: ['rooms', 'mine'] as const,
};

export type RoomQueryKey = ReturnType<(typeof roomKeys)['detail']>;

/**
 * Which queries a broadcast makes stale (API_CONTRACTS.md §4). Events are
 * hints, never data, so the client refetches what they name:
 *
 * - `queue.changed`: the queue. Adding to an empty room starts the song, so
 *   playback too.
 * - `playback.changed`: playback, and the queue (advancing moves the playing
 *   entry).
 * - `members.changed`: members, and the room row (the rules' chosen people).
 * - `room.ended`: the whole room, and your room list.
 */
export function invalidationsFor(
  type: RoomEventType,
  roomId: string,
): readonly (readonly string[])[] {
  switch (type) {
    case 'queue.changed':
      return [roomKeys.queue(roomId), roomKeys.playback(roomId)];
    case 'playback.changed':
      return [roomKeys.playback(roomId), roomKeys.queue(roomId)];
    case 'members.changed':
      return [roomKeys.members(roomId), roomKeys.detail(roomId)];
    case 'room.ended':
      return [roomKeys.room(roomId), roomKeys.mine];
  }
}
