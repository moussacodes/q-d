import { useCallback, useRef, useState } from 'react';

import { formatRoomCode, isRoomCode, roomCodeFromInput } from '@/domain/room-code';
import { mockRooms } from '@/providers/mock/data';

/**
 * Mock mode's stand-in for `join_room_by_code` (API_CONTRACTS.md §3), so Join
 * shows every answer the real RPC can give. Like the RPC, it checks the code
 * and joins in one call: there's no read-only lookup before Join. It uses the
 * contract's error names, and its made-up codes use only the room-code
 * alphabet (`src/domain/room-code.ts`), like the join-on-Home mock on
 * `feat/create-join-screens` (`src/features/room/mockServer.ts`), so the two
 * agree when the stacks merge.
 *
 * - A sample room's code joins that room.
 * - `QD-FULL22` is full, `QD-ENDED2` has ended, and `QD-STALE2` stands for an
 *   expired code, which answers exactly like a wrong one (`code_invalid`).
 * - After `MOCK_JOIN_ATTEMPTS` wrong codes in a row, joining pauses for
 *   `MOCK_RETRY_AFTER_SECONDS` (`rate_limited`), checked before the code.
 *   Both numbers are mock values; the real limits are still open.
 * - `QD-NETDWN` is mock-only: the call throws, as if the phone never reached
 *   the server. `network` is that client-side state, not a server code.
 */

/** `join_room_by_code`'s errors (API_CONTRACTS.md §3), the same shape as `RpcError`. */
export type JoinRpcError =
  | {
      code:
        'code_invalid' | 'room_full' | 'room_ended' | 'profile_incomplete' | 'not_authenticated';
    }
  /** Says when to try again (`retry_after_seconds`). */
  | { code: 'rate_limited'; retryAfterSeconds: number };

/** What Join can show: a server error, or `network` when the call never got an answer. */
export type JoinError = JoinRpcError | { code: 'network' };

export type JoinResult = { ok: true; value: { code: string } } | { ok: false; error: JoinRpcError };

/** Wrong codes in a row before joining by code is paused. Mock value. */
export const MOCK_JOIN_ATTEMPTS = 5;
/** How long the pause lasts. Mock value. */
export const MOCK_RETRY_AFTER_SECONDS = 30;

/** Made-up codes for the states a sample room can't show. Listed in /dev. */
export const mockJoinCodes = {
  room_full: 'QD-FULL22',
  room_ended: 'QD-ENDED2',
  /** An expired code: answers `code_invalid`, like a wrong one. */
  expired: 'QD-STALE2',
  /** Mock only: the call fails before reaching the server. */
  network: 'QD-NETDWN',
} as const;

/** A key for one tap, reused only if that tap's call is retried. It only has to be unique. */
export function newIdempotencyKey() {
  const hex = (length: number) =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

export function createMockJoin(now: () => number = Date.now) {
  let failedAttempts = 0;
  let pausedUntil = 0;
  const wrong = (): JoinResult => {
    failedAttempts += 1;
    if (failedAttempts >= MOCK_JOIN_ATTEMPTS) {
      failedAttempts = 0;
      pausedUntil = now() + MOCK_RETRY_AFTER_SECONDS * 1000;
    }
    return { ok: false, error: { code: 'code_invalid' } };
  };

  return {
    /**
     * `join_room_by_code`. The code is case-insensitive, and the QD- prefix
     * and spaces are optional. Rejects (as a failed fetch would) only for the
     * mock offline code.
     */
    async joinRoomByCode(input: { code: string; idempotencyKey: string }): Promise<JoinResult> {
      const body = roomCodeFromInput(input.code);
      const code = formatRoomCode(body);
      if (code === mockJoinCodes.network) throw new Error('Network request failed (mock)');

      const t = now();
      if (t < pausedUntil) {
        return {
          ok: false,
          error: { code: 'rate_limited', retryAfterSeconds: Math.ceil((pausedUntil - t) / 1000) },
        };
      }
      if (!isRoomCode(body)) return wrong();
      const room = mockRooms.find((r) => r.code === code);
      if (room) {
        failedAttempts = 0;
        return { ok: true, value: { code: room.code } };
      }
      if (code === mockJoinCodes.room_full) return { ok: false, error: { code: 'room_full' } };
      if (code === mockJoinCodes.room_ended) return { ok: false, error: { code: 'room_ended' } };
      return wrong();
    },

    /** Forgets wrong tries and any pause. For tests. */
    reset() {
      failedAttempts = 0;
      pausedUntil = 0;
    },
  };
}

/** The one mock server Join talks to, so wrong tries add up across visits. */
export const mockJoin = createMockJoin();

export type JoinState =
  { status: 'idle' } | { status: 'pending' } | { status: 'failed'; error: JoinError };

/**
 * Joins a room by code: one call per tap, each with its own idempotency key.
 * While a call is out, further taps send nothing. A call that throws counts
 * as `network`. Returns the room's code on success, otherwise null.
 */
export function useJoinByCode() {
  const [state, setState] = useState<JoinState>({ status: 'idle' });
  const pending = useRef(false);

  const join = useCallback(async (code: string): Promise<string | null> => {
    if (pending.current) return null;
    pending.current = true;
    setState({ status: 'pending' });
    try {
      const result = await mockJoin.joinRoomByCode({ code, idempotencyKey: newIdempotencyKey() });
      if (result.ok) {
        setState({ status: 'idle' });
        return result.value.code;
      }
      setState({ status: 'failed', error: result.error });
    } catch {
      setState({ status: 'failed', error: { code: 'network' } });
    } finally {
      pending.current = false;
    }
    return null;
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);
  return { state, join, reset };
}

const seconds = (n: number) => (n === 1 ? '1 second' : `${n} seconds`);

/**
 * What Join says for each error. A wrong code and an expired one get the same
 * words, because the server can't tell them apart either.
 */
export function joinErrorCopy(error: JoinError): { title: string; body: string } {
  switch (error.code) {
    case 'code_invalid':
      return {
        title: 'That code doesn’t work',
        body: 'It may be mistyped, or the room’s code has expired. Check it with the host.',
      };
    case 'room_full':
      return {
        title: 'This room is full',
        body: 'Rooms hold up to 15 people. Ask the host to let you know when there’s space.',
      };
    case 'room_ended':
      return {
        title: 'This room has ended',
        body: 'The host ended it, so there’s nothing to join. Ask them for a new code.',
      };
    case 'rate_limited':
      return {
        title: 'Too many tries',
        body: `Wait ${seconds(error.retryAfterSeconds)}, then try the code again.`,
      };
    case 'profile_incomplete':
      return { title: 'Finish your profile', body: 'Add your name before joining a room.' };
    case 'not_authenticated':
      return { title: 'Sign in again', body: 'Sign in again to join a room.' };
    case 'network':
      return { title: 'Can’t reach q’d', body: 'Check your connection, then try again.' };
  }
}

/** Errors a retry can fix without a new code. */
export function canRetryJoin(error: JoinError) {
  return error.code === 'network' || error.code === 'rate_limited';
}

/** Under the code when it holds characters no code uses. Same words as join-on-Home. */
export const lookalikeMessage = 'Room codes don’t use 0, O, 1 or I. Check the code with the host.';
