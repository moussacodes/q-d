import type { MusicProvider } from '@/domain/music-provider';
import { formatRoomCode, isRoomCode, roomCodeFromInput } from '@/domain/room-code';
import { roomNameProblem } from '@/domain/room-name';
import type { RoomRules } from '@/domain/room-rules';
import type { RpcError, RpcResult } from '@/domain/rpc-error';
import { mockJoinErrorCodes, mockRooms } from '@/providers/mock/data';

/**
 * Mock mode's stand-in for the room RPCs in docs/API_CONTRACTS.md that change
 * who's in a room: `create_room` and `join_room_by_code`. Answers are
 * deterministic and come back at once; the Supabase cards replace this
 * class with real RPC calls of the same shape. It runs on this phone only,
 * so it's a preview of the server's answers, not the server's checks.
 */

/** Wrong codes in a row before joining by code is paused. Mock value; the real limits are open. */
export const MOCK_JOIN_ATTEMPTS = 5;
/** How long the pause lasts. */
export const MOCK_RETRY_AFTER_SECONDS = 30;

/** The sample room a mock `create_room` hands out; the room screen seeds from it. */
export const MOCK_HOSTED_CODE = mockRooms[0].code;

export type CreateRoomInput = {
  name: string;
  /** Null when no service is connected: the server answers `provider_required`. */
  playbackProvider: MusicProvider | null;
  rules: RoomRules;
  /** Always `aux`. `sync (beta)` is behind a flag that's off (`feature_disabled`). */
  mode?: 'aux';
  idempotencyKey: string;
};

/**
 * A key for one user intent (one tap), reused if that tap's call is retried
 * (API_CONTRACTS.md §1). It only has to be unique, not secret.
 */
export function newIdempotencyKey() {
  const hex = (length: number) =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

const fail = (error: RpcError) => ({ ok: false, error }) as const;

export class MockRoomServer {
  private failedAttempts = 0;
  private pausedUntil = 0;
  /** Successful answers by operation and key, with the arguments they answered. */
  private replies = new Map<string, { args: string; value: unknown }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** A stored answer for this key, `idempotency_conflict` for other arguments, or null. */
  private replay<T>(operation: string, key: string, args: unknown): RpcResult<T> | null {
    const stored = this.replies.get(`${operation}:${key}`);
    if (!stored) return null;
    if (stored.args !== JSON.stringify(args)) return fail({ code: 'idempotency_conflict' });
    return { ok: true, value: stored.value as T };
  }

  /** Only successful answers are kept, so a rejected call can be retried with the same key. */
  private remember<T>(operation: string, key: string, args: unknown, value: T): RpcResult<T> {
    this.replies.set(`${operation}:${key}`, { args: JSON.stringify(args), value });
    return { ok: true, value };
  }

  /** `create_room`: the caller hosts a new `aux` room with the rules chosen on Start a room. */
  async createRoom(input: CreateRoomInput): Promise<RpcResult<{ code: string }>> {
    const { idempotencyKey, ...args } = input;
    const replay = this.replay<{ code: string }>('create_room', idempotencyKey, args);
    if (replay) return replay;
    if (args.mode && args.mode !== 'aux') return fail({ code: 'feature_disabled' });
    if (roomNameProblem(args.name)) return fail({ code: 'invalid_input' });
    if (!args.playbackProvider) return fail({ code: 'provider_required' });
    return this.remember('create_room', idempotencyKey, args, { code: MOCK_HOSTED_CODE });
  }

  /**
   * `join_room_by_code`. The code is case-insensitive, and the QD- prefix and
   * spaces are optional. The attempt limit is checked before the code is
   * looked up, and a wrong code answers the same as an expired one.
   */
  async joinRoomByCode(input: {
    code: string;
    idempotencyKey: string;
  }): Promise<RpcResult<{ code: string }>> {
    const body = roomCodeFromInput(input.code);
    const replay = this.replay<{ code: string }>('join_room_by_code', input.idempotencyKey, body);
    if (replay) return replay;

    const now = this.now();
    if (now < this.pausedUntil) {
      return fail({
        code: 'rate_limited',
        retryAfterSeconds: Math.ceil((this.pausedUntil - now) / 1000),
      });
    }

    const code = formatRoomCode(body);
    const room = isRoomCode(body) ? mockRooms.find((r) => r.code === code) : undefined;
    if (room) {
      this.failedAttempts = 0;
      return this.remember('join_room_by_code', input.idempotencyKey, body, { code: room.code });
    }
    const preset = isRoomCode(body) ? mockJoinErrorCodes[code] : undefined;
    if (preset === 'room_full' || preset === 'room_ended') return fail({ code: preset });

    this.failedAttempts += 1;
    if (this.failedAttempts >= MOCK_JOIN_ATTEMPTS) {
      this.failedAttempts = 0;
      this.pausedUntil = now + MOCK_RETRY_AFTER_SECONDS * 1000;
    }
    return fail({ code: 'code_invalid' });
  }
}
