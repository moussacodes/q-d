import type { MusicProvider } from '@/domain/music-provider';
import { MOCK_INVITE_PREFIX } from '@/domain/invite';
import { formatRoomCode, isRoomCode, roomCodeFromInput } from '@/domain/room-code';
import { roomNameProblem } from '@/domain/room-name';
import type { RoomRules } from '@/domain/room-rules';
import type { RpcError, RpcResult } from '@/domain/rpc-error';
import { mockJoinErrorCodes, mockRooms } from '@/providers/mock/data';

/**
 * Mock mode's stand-in for the room RPCs in docs/API_CONTRACTS.md that change
 * who's in a room: `create_room`, `join_room_by_code`, `create_room_invite`
 * and `join_room_by_invite`. Answers are
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

/** How long a mock invite works. The real length is open, like the code's. */
export const MOCK_INVITE_HOURS = 24;

/** What `create_room_invite` answers. Only the host ever holds the token; the server keeps a hash. */
export type RoomInvite = { token: string; expiresAt: string };

/**
 * A deterministic, clearly labeled mock token: `mock-` and 32 hex characters
 * (the length of a 128-bit token). It's made from the room and a counter, so
 * unlike a real token it isn't secret. Real tokens come from the server's
 * random generator.
 */
export function mockInviteToken(roomCode: string, version: number) {
  const fnv1a = (text: string) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  const parts = [0, 1, 2, 3].map((part) => fnv1a(`qd-mock-invite:${roomCode}:${version}:${part}`));
  return `${MOCK_INVITE_PREFIX}${parts.join('')}`;
}

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
  /** Each room's current invite. Older tokens aren't kept, so they stop working. */
  private invites = new Map<string, RoomInvite & { version: number }>();

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

    const paused = this.pausedFor();
    if (paused) return paused;

    const code = formatRoomCode(body);
    const room = isRoomCode(body) ? mockRooms.find((r) => r.code === code) : undefined;
    if (room) {
      this.failedAttempts = 0;
      return this.remember('join_room_by_code', input.idempotencyKey, body, { code: room.code });
    }
    const preset = isRoomCode(body) ? mockJoinErrorCodes[code] : undefined;
    if (preset === 'room_full' || preset === 'room_ended') return fail({ code: preset });
    return this.wrongAttempt({ code: 'code_invalid' });
  }

  /**
   * `create_room_invite`: only the host makes one. Each call makes a new
   * token and the older one stops working. `asHost` stands in for the
   * server's own check of who's calling.
   */
  async createRoomInvite(input: {
    roomCode: string;
    asHost: boolean;
    idempotencyKey: string;
  }): Promise<RpcResult<RoomInvite>> {
    const { idempotencyKey, ...args } = input;
    const replay = this.replay<RoomInvite>('create_room_invite', idempotencyKey, args);
    if (replay) return replay;
    if (!args.asHost) return fail({ code: 'not_host' });
    const version = (this.invites.get(args.roomCode)?.version ?? 0) + 1;
    const invite = {
      token: mockInviteToken(args.roomCode, version),
      expiresAt: new Date(this.now() + MOCK_INVITE_HOURS * 3_600_000).toISOString(),
    };
    this.invites.set(args.roomCode, { ...invite, version });
    return this.remember('create_room_invite', idempotencyKey, args, invite);
  }

  /**
   * `join_room_by_invite`: the room whose current token this is. A wrong,
   * expired or replaced token answers `invite_invalid`, and counts toward the
   * same attempt limit as wrong codes.
   */
  async joinRoomByInvite(input: {
    token: string;
    idempotencyKey: string;
  }): Promise<RpcResult<{ code: string }>> {
    const replay = this.replay<{ code: string }>(
      'join_room_by_invite',
      input.idempotencyKey,
      input.token,
    );
    if (replay) return replay;
    const paused = this.pausedFor();
    if (paused) return paused;

    const now = this.now();
    for (const [roomCode, invite] of this.invites) {
      if (invite.token === input.token && Date.parse(invite.expiresAt) > now) {
        this.failedAttempts = 0;
        return this.remember('join_room_by_invite', input.idempotencyKey, input.token, {
          code: roomCode,
        });
      }
    }
    return this.wrongAttempt({ code: 'invite_invalid' });
  }

  /** `rate_limited` while joining is paused, otherwise null. */
  private pausedFor(): { ok: false; error: RpcError } | null {
    const now = this.now();
    if (now >= this.pausedUntil) return null;
    return fail({
      code: 'rate_limited',
      retryAfterSeconds: Math.ceil((this.pausedUntil - now) / 1000),
    });
  }

  /** Counts a wrong code or token; enough in a row pause joining. */
  private wrongAttempt(error: RpcError) {
    this.failedAttempts += 1;
    if (this.failedAttempts >= MOCK_JOIN_ATTEMPTS) {
      this.failedAttempts = 0;
      this.pausedUntil = this.now() + MOCK_RETRY_AFTER_SECONDS * 1000;
    }
    return fail(error);
  }
}
