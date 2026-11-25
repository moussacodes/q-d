/** The longest room name `create_room` accepts, after trimming (DECISIONS.md, create_room). */
export const MAX_ROOM_NAME_LENGTH = 40;

export type RoomNameProblem = 'blank' | 'too_long';

/** Why a room name can't be used, or null when it can. Names are trimmed first. */
export function roomNameProblem(name: string): RoomNameProblem | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'blank';
  if (trimmed.length > MAX_ROOM_NAME_LENGTH) return 'too_long';
  return null;
}
