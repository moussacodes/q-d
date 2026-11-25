/** Room codes are QD- and six letters or digits, like QD-7K4F9X (plan.md §2). */
export const ROOM_CODE_LENGTH = 6;

/**
 * The six characters after QD- from what someone typed or pasted. Uppercases,
 * drops spaces and dashes, and removes a pasted "QD-" prefix. A code that
 * itself starts with QD is kept.
 */
export function roomCodeFromInput(text: string) {
  const chars = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = chars.length > ROOM_CODE_LENGTH && chars.startsWith('QD') ? chars.slice(2) : chars;
  return body.slice(0, ROOM_CODE_LENGTH);
}
