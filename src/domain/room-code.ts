/** Room codes are QD- and six characters, like QD-7K4F9X (plan.md §2). */
export const ROOM_CODE_LENGTH = 6;

/** What people see in front of the six characters. */
export const ROOM_CODE_PREFIX = 'QD-';

/**
 * The characters a room code can use: no `0`, `O`, `1` or `I`, so a code read
 * aloud or typed from a screen can't be misread (DECISIONS.md, 2026-11-24 ·
 * create_room). The database draws codes from the same set.
 */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * The six characters after QD- from what someone typed or pasted. Uppercases,
 * drops spaces and dashes, and removes a pasted "QD-" prefix. A code that
 * itself starts with QD is kept. Look-alike characters stay in, so
 * `lookalikesIn` can say what's wrong instead of silently changing the code.
 */
export function roomCodeFromInput(text: string) {
  const chars = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = chars.length > ROOM_CODE_LENGTH && chars.startsWith('QD') ? chars.slice(2) : chars;
  return body.slice(0, ROOM_CODE_LENGTH);
}

/** The characters in `code` that no room code uses (`0`, `O`, `1`, `I`), each once. */
export function lookalikesIn(code: string): string[] {
  return [...new Set(code.toUpperCase())].filter((char) => !ROOM_CODE_ALPHABET.includes(char));
}

/** Six characters from the room-code alphabet, without the prefix. */
export function isRoomCode(code: string) {
  return code.length === ROOM_CODE_LENGTH && lookalikesIn(code).length === 0;
}

/** `7K4F9X` → `QD-7K4F9X`, the way codes are shown. */
export function formatRoomCode(code: string) {
  return `${ROOM_CODE_PREFIX}${code}`;
}

/**
 * A room code for screen readers: one character at a time, so VoiceOver
 * reads `QD-7K4F9X` as "Q D, 7 K 4 F 9 X" instead of trying a word.
 */
export function spokenRoomCode(display: string) {
  const code = roomCodeFromInput(display);
  return `Q D, ${code.split('').join(' ')}`;
}
