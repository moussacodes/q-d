import { useEffect, useState } from 'react';

import { mockRooms, type MockRoom } from '@/providers/mock/data';

/**
 * Mock mode's stand-in for `join_room_by_code` (API_CONTRACTS.md §3), so Join
 * shows every answer the real RPC can give. Deterministic: the sample rooms'
 * codes find their rooms, a few made-up codes give each error, and anything
 * else is `code_invalid` (wrong and expired codes look the same, so codes
 * can't be probed). `network` stands for not reaching the server at all.
 */

export type JoinError = 'code_invalid' | 'room_full' | 'room_ended' | 'rate_limited' | 'network';

export type LookupResult = { ok: true; room: MockRoom } | { ok: false; error: JoinError };

export const CODE_LENGTH = 6;

/** Made-up codes that give each error in mock mode. Listed in /dev. */
export const mockErrorCodes: Readonly<Record<Exclude<JoinError, 'code_invalid'>, string>> = {
  room_full: 'FULL15',
  room_ended: 'ENDED1',
  rate_limited: 'LIMIT1',
  network: 'OFFLN1',
};

/** "qd-7k4f 9x" → "7K4F9X": case-insensitive, prefix and spaces optional. */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/^\s*QD-?/, '')
    .replace(/[^A-Z0-9]/g, '');
}

export const roomCodes = {
  /** Looks up a room by its six characters. Never throws. */
  async lookup(code: string): Promise<LookupResult> {
    const normalized = normalizeCode(code);
    const error = (Object.keys(mockErrorCodes) as (keyof typeof mockErrorCodes)[]).find(
      (key) => mockErrorCodes[key] === normalized,
    );
    if (error) return { ok: false, error };
    const room = mockRooms.find((r) => r.code === `QD-${normalized}`);
    return room ? { ok: true, room } : { ok: false, error: 'code_invalid' };
  },
};

export type CodeLookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; room: MockRoom }
  | { status: 'error'; error: JoinError };

/**
 * Looks the code up once it's complete. An answer for an older code or try is
 * dropped, and a lookup that fails unexpectedly counts as `network`.
 */
export function useRoomCodeLookup(code: string): { lookup: CodeLookup; retry: () => void } {
  const complete = normalizeCode(code).length === CODE_LENGTH;
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; lookup: CodeLookup } | null>(null);
  const key = `${attempt}:${code}`;

  useEffect(() => {
    if (!complete) return;
    let current = true;
    roomCodes
      .lookup(code)
      .catch((): LookupResult => ({ ok: false, error: 'network' }))
      .then((result) => {
        if (!current) return;
        setAnswer({
          key: `${attempt}:${code}`,
          lookup: result.ok
            ? { status: 'found', room: result.room }
            : { status: 'error', error: result.error },
        });
      });
    return () => {
      current = false;
    };
  }, [code, complete, attempt]);

  const retry = () => setAttempt((n) => n + 1);
  if (!complete) return { lookup: { status: 'idle' }, retry };
  return { lookup: answer?.key === key ? answer.lookup : { status: 'loading' }, retry };
}

/** What Join says for each error. */
export const joinErrorCopy: Readonly<Record<JoinError, { title: string; body: string }>> = {
  code_invalid: {
    title: 'That code doesn’t work',
    body: 'It may be mistyped, or the room’s code has expired. Check it with the host.',
  },
  room_full: {
    title: 'This room is full',
    body: 'Rooms hold up to 15 people. Ask the host to let you know when there’s space.',
  },
  room_ended: {
    title: 'This room has ended',
    body: 'The host ended it, so there’s nothing to join. Ask them for a new code.',
  },
  rate_limited: {
    title: 'Too many tries',
    body: 'Wait a minute, then try the code again.',
  },
  network: {
    title: 'Can’t reach q’d',
    body: 'Check your connection, then try again.',
  },
};
