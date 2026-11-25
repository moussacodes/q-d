import { ROOM_CODE_ALPHABET, isRoomCode, roomCodeFromInput } from '@/domain/room-code';
import { mockRooms } from '@/providers/mock/data';

import {
  MOCK_JOIN_ATTEMPTS,
  MOCK_RETRY_AFTER_SECONDS,
  canRetryJoin,
  createMockJoin,
  joinErrorCopy,
  mockJoinCodes,
  newIdempotencyKey,
  type JoinError,
} from './roomCodes';

const clocked = () => {
  let now = 1_000_000;
  const server = createMockJoin(() => now);
  const join = (code: string) =>
    server.joinRoomByCode({ code, idempotencyKey: newIdempotencyKey() });
  return { server, join, tick: (ms: number) => (now += ms) };
};

describe('mock join_room_by_code', () => {
  it('joins every sample room by its code, with or without the prefix, in any case', async () => {
    const { join } = clocked();
    for (const room of mockRooms) {
      expect(await join(room.code)).toEqual({ ok: true, value: { code: room.code } });
      expect(await join(room.code.slice(3).toLowerCase())).toEqual({
        ok: true,
        value: { code: room.code },
      });
    }
  });

  it('answers with the contract’s error names', async () => {
    const { join } = clocked();
    expect(await join(mockJoinCodes.room_full)).toEqual({
      ok: false,
      error: { code: 'room_full' },
    });
    expect(await join(mockJoinCodes.room_ended)).toEqual({
      ok: false,
      error: { code: 'room_ended' },
    });
  });

  it('answers a wrong code and an expired one the same way, so codes can’t be probed', async () => {
    const { join } = clocked();
    expect(await join('ZZZZZZ')).toEqual({ ok: false, error: { code: 'code_invalid' } });
    expect(await join(mockJoinCodes.expired)).toEqual({
      ok: false,
      error: { code: 'code_invalid' },
    });
    expect(await join('7K4F9Y')).toEqual({ ok: false, error: { code: 'code_invalid' } });
  });

  it('throws for the mock offline code, as a failed fetch would', async () => {
    const { join } = clocked();
    await expect(join(mockJoinCodes.network)).rejects.toThrow('(mock)');
  });

  it(`pauses after ${MOCK_JOIN_ATTEMPTS} wrong codes in a row, checked before the code`, async () => {
    const { join, tick } = clocked();
    for (let i = 0; i < MOCK_JOIN_ATTEMPTS; i += 1) {
      expect(await join('ZZZZZZ')).toMatchObject({ ok: false, error: { code: 'code_invalid' } });
    }
    expect(await join('7K4F9X')).toEqual({
      ok: false,
      error: { code: 'rate_limited', retryAfterSeconds: MOCK_RETRY_AFTER_SECONDS },
    });
    tick(12_500);
    expect(await join('7K4F9X')).toEqual({
      ok: false,
      error: { code: 'rate_limited', retryAfterSeconds: 18 },
    });
    tick(17_500);
    expect(await join('7K4F9X')).toMatchObject({ ok: true });
  });

  it('starts counting again after a successful join', async () => {
    const { join } = clocked();
    for (let i = 0; i < MOCK_JOIN_ATTEMPTS - 1; i += 1) await join('ZZZZZZ');
    expect(await join('7K4F9X')).toMatchObject({ ok: true });
    expect(await join('ZZZZZZ')).toMatchObject({ error: { code: 'code_invalid' } });
  });

  it('counts a code with look-alike characters as wrong', async () => {
    const { join } = clocked();
    expect(await join('FULL15')).toEqual({ ok: false, error: { code: 'code_invalid' } });
  });

  it('forgets the pause on reset', async () => {
    const { server, join } = clocked();
    for (let i = 0; i < MOCK_JOIN_ATTEMPTS; i += 1) await join('ZZZZZZ');
    server.reset();
    expect(await join('7K4F9X')).toMatchObject({ ok: true });
  });
});

describe('mock codes', () => {
  const made = Object.values(mockJoinCodes);

  it('use only the room-code alphabet, so they’re codes join-on-Home accepts', () => {
    for (const code of made) {
      expect(isRoomCode(roomCodeFromInput(code))).toBe(true);
      expect([...roomCodeFromInput(code)].every((c) => ROOM_CODE_ALPHABET.includes(c))).toBe(true);
    }
  });

  it('match the join-on-Home mock’s full, ended and expired codes', () => {
    expect(mockJoinCodes).toMatchObject({
      room_full: 'QD-FULL22',
      room_ended: 'QD-ENDED2',
      expired: 'QD-STALE2',
    });
  });

  it('stay apart from the sample rooms and from each other', () => {
    const sample = new Set(mockRooms.map((room) => room.code));
    made.forEach((code) => expect(sample.has(code)).toBe(false));
    expect(new Set(made).size).toBe(made.length);
  });
});

describe('joinErrorCopy', () => {
  const errors: JoinError[] = [
    { code: 'code_invalid' },
    { code: 'room_full' },
    { code: 'room_ended' },
    { code: 'rate_limited', retryAfterSeconds: 30 },
    { code: 'profile_incomplete' },
    { code: 'not_authenticated' },
    { code: 'network' },
  ];

  it('has words for every error, naming q’d with the curly apostrophe', () => {
    for (const error of errors) {
      const copy = joinErrorCopy(error);
      expect(copy.title).not.toHaveLength(0);
      expect(copy.body).not.toHaveLength(0);
      expect(`${copy.title} ${copy.body}`).not.toContain("'");
    }
    expect(joinErrorCopy({ code: 'network' }).title).toBe('Can’t reach q’d');
  });

  it('says how long to wait from retry_after_seconds', () => {
    expect(joinErrorCopy({ code: 'rate_limited', retryAfterSeconds: 18 }).body).toBe(
      'Wait 18 seconds, then try the code again.',
    );
    expect(joinErrorCopy({ code: 'rate_limited', retryAfterSeconds: 1 }).body).toBe(
      'Wait 1 second, then try the code again.',
    );
  });

  it('offers Try again only when the same code can work later', () => {
    expect(errors.filter(canRetryJoin).map((e) => e.code)).toEqual(['rate_limited', 'network']);
  });
});

describe('newIdempotencyKey', () => {
  it('is a fresh UUID-shaped key each time', () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newIdempotencyKey()).not.toBe(a);
  });
});
