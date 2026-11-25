import {
  ROOM_CODE_ALPHABET,
  formatRoomCode,
  isRoomCode,
  lookalikesIn,
  roomCodeFromInput,
  spokenRoomCode,
} from './room-code';
import { MAX_ROOM_NAME_LENGTH, roomNameProblem } from './room-name';

describe('roomCodeFromInput', () => {
  it('uppercases what was typed', () => {
    expect(roomCodeFromInput('9m2xr4')).toBe('9M2XR4');
  });

  it('removes a pasted QD- prefix', () => {
    expect(roomCodeFromInput('QD-9M2XR4')).toBe('9M2XR4');
    expect(roomCodeFromInput('qd 9m2 xr4')).toBe('9M2XR4');
    expect(roomCodeFromInput('  qd-9m2xr4 \n')).toBe('9M2XR4');
  });

  it('keeps a code that starts with QD', () => {
    expect(roomCodeFromInput('QD12AB')).toBe('QD12AB');
    expect(roomCodeFromInput('QD-QD23AB')).toBe('QD23AB');
  });

  it('stops at six characters', () => {
    expect(roomCodeFromInput('9M2XR4ZZ')).toBe('9M2XR4');
  });

  it('drops punctuation', () => {
    expect(roomCodeFromInput('9M·2X—R4!')).toBe('9M2XR4');
    expect(roomCodeFromInput('')).toBe('');
  });

  it('keeps look-alike characters so they can be pointed out', () => {
    expect(roomCodeFromInput('0o1i')).toBe('0O1I');
  });
});

describe('the room-code alphabet', () => {
  it('matches the database alphabet character for character', () => {
    // supabase/migrations/…_create_room.sql on feat/create-room-rpc draws codes
    // from this exact string. Change both together.
    expect(ROOM_CODE_ALPHABET).toBe('23456789ABCDEFGHJKLMNPQRSTUVWXYZ');
  });

  it('has 32 characters and no look-alikes', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    for (const char of ['0', 'O', '1', 'I']) {
      expect(ROOM_CODE_ALPHABET).not.toContain(char);
    }
  });

  it('finds each look-alike once', () => {
    expect(lookalikesIn('9M2XR4')).toEqual([]);
    expect(lookalikesIn('O0O1II')).toEqual(['O', '0', '1', 'I']);
    expect(lookalikesIn('7k4f9o')).toEqual(['O']);
  });

  it('accepts only six alphabet characters', () => {
    expect(isRoomCode('9M2XR4')).toBe(true);
    expect(isRoomCode('9M2XR')).toBe(false);
    expect(isRoomCode('9M2XR0')).toBe(false);
    expect(isRoomCode('ABCDEFG')).toBe(false);
  });
});

describe('showing a code', () => {
  it('adds the QD- prefix', () => {
    expect(formatRoomCode('7K4F9X')).toBe('QD-7K4F9X');
  });

  it('spells it out for screen readers', () => {
    expect(spokenRoomCode('QD-7K4F9X')).toBe('Q D, 7 K 4 F 9 X');
  });
});

describe('roomNameProblem', () => {
  it('trims before checking', () => {
    expect(roomNameProblem('  Friday Fade  ')).toBeNull();
    expect(roomNameProblem('   ')).toBe('blank');
    expect(roomNameProblem('')).toBe('blank');
  });

  it('allows 1 to 40 characters', () => {
    expect(roomNameProblem('a')).toBeNull();
    expect(roomNameProblem('a'.repeat(MAX_ROOM_NAME_LENGTH))).toBeNull();
    expect(roomNameProblem(` ${'a'.repeat(MAX_ROOM_NAME_LENGTH)} `)).toBeNull();
    expect(roomNameProblem('a'.repeat(MAX_ROOM_NAME_LENGTH + 1))).toBe('too_long');
  });
});
