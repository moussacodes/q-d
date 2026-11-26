import { z } from 'zod';

import { musicProviderSchema, type MusicProvider } from '@/domain/music-provider';
import { idSchema } from '@/domain/primitives';
import type { TrackMatch } from '@/domain/recording';
import type { Audience } from '@/domain/room-rules';

import { zodIssueFields } from './logFields';
import { log } from './logger';
import { callRpc, type RpcCallResult, type RpcClientLike } from './rpc';

/**
 * Live rooms (docs/API_CONTRACTS.md §3). Writes are the built RPCs, each with
 * the caller's idempotency key; reads are plain selects that row level
 * security limits to the rooms you're in. Results come back camelCase, and
 * every row is parsed before the app sees it: a row that doesn't parse is
 * dropped and logged by field path, never shown half-read.
 *
 * Not built on the server yet, so not here: `update_room_rules`,
 * `leave_room`, `advance_queue`, `report_playback_state`,
 * `request_playback`, `switch_playback_provider` and
 * `override_track_match`. The app keeps those mock-only or disabled in live
 * rooms (DECISIONS.md, "Live room screens").
 */

const roomsLog = log.child('rooms');

// RPC results ------------------------------------------------------------------

const timestamp = z.string().min(1);

const createRoomResult = z
  .object({ room_id: idSchema, code: z.string().min(1), code_expires_at: timestamp })
  .transform((r) => ({ roomId: r.room_id, code: r.code, codeExpiresAt: r.code_expires_at }));

const joinResult = z.object({ room_id: idSchema }).transform((r) => ({ roomId: r.room_id }));

const inviteResult = z
  .object({ token: z.string().min(1), expires_at: timestamp })
  .transform((r) => ({ token: r.token, expiresAt: r.expires_at }));

const endResult = z
  .object({ room_id: idSchema, ended_at: timestamp })
  .transform((r) => ({ roomId: r.room_id, endedAt: r.ended_at }));

const enqueueResult = z
  .object({
    entry_id: idSchema,
    position: z.number().int().min(0),
    queue_length: z.number().int().min(0),
  })
  .transform((r) => ({ entryId: r.entry_id, position: r.position, queueLength: r.queue_length }));

const removeResult = z
  .object({ entry_id: idSchema, queue_length: z.number().int().min(0) })
  .transform((r) => ({ entryId: r.entry_id, queueLength: r.queue_length }));

export type EnqueueAnswer = z.infer<typeof enqueueResult>;

/** The RPCs, with the arguments `supabase.rpc` passes by name (API_CONTRACTS.md §3). */
export const roomRpc = {
  createRoom: (
    client: RpcClientLike,
    input: {
      name: string;
      playbackProvider: MusicProvider;
      addSongs: Audience;
      control: Audience;
      idempotencyKey: string;
    },
  ) =>
    callRpc(
      client,
      'create_room',
      {
        name: input.name,
        playback_provider: input.playbackProvider,
        add_songs: input.addSongs,
        control: input.control,
        mode: 'aux',
        idempotency_key: input.idempotencyKey,
      },
      createRoomResult,
    ),

  joinRoomByCode: (client: RpcClientLike, input: { code: string; idempotencyKey: string }) =>
    callRpc(
      client,
      'join_room_by_code',
      { code: input.code, idempotency_key: input.idempotencyKey },
      joinResult,
    ),

  createRoomInvite: (client: RpcClientLike, input: { roomId: string; idempotencyKey: string }) =>
    callRpc(
      client,
      'create_room_invite',
      { room_id: input.roomId, idempotency_key: input.idempotencyKey },
      inviteResult,
    ),

  joinRoomByInvite: (client: RpcClientLike, input: { token: string; idempotencyKey: string }) =>
    callRpc(
      client,
      'join_room_by_invite',
      { token: input.token, idempotency_key: input.idempotencyKey },
      joinResult,
    ),

  endRoom: (client: RpcClientLike, input: { roomId: string; idempotencyKey: string }) =>
    callRpc(
      client,
      'end_room',
      { room_id: input.roomId, idempotency_key: input.idempotencyKey },
      endResult,
    ),

  enqueueRecording: (
    client: RpcClientLike,
    input: {
      roomId: string;
      recordingId: string;
      allowDuplicate: boolean;
      idempotencyKey: string;
    },
  ): Promise<RpcCallResult<EnqueueAnswer>> =>
    callRpc(
      client,
      'enqueue_recording',
      {
        room_id: input.roomId,
        recording_id: input.recordingId,
        allow_duplicate: input.allowDuplicate,
        idempotency_key: input.idempotencyKey,
      },
      enqueueResult,
    ),

  reorderQueue: (
    client: RpcClientLike,
    input: {
      roomId: string;
      entryId: string;
      afterEntryId: string | null;
      idempotencyKey: string;
    },
  ) =>
    callRpc(
      client,
      'reorder_queue',
      {
        room_id: input.roomId,
        entry_id: input.entryId,
        after_entry_id: input.afterEntryId,
        idempotency_key: input.idempotencyKey,
      },
      enqueueResult,
    ),

  removeQueueEntry: (
    client: RpcClientLike,
    input: { roomId: string; entryId: string; idempotencyKey: string },
  ) =>
    callRpc(
      client,
      'remove_queue_entry',
      { room_id: input.roomId, entry_id: input.entryId, idempotency_key: input.idempotencyKey },
      removeResult,
    ),
};

// Reads ------------------------------------------------------------------------

/** The parts of supabase-js's query builder the reads use. Thenable, like supabase-js. */
export interface SelectBuilder<Row = Record<string, unknown>> extends PromiseLike<{
  data: Row[] | null;
  error: { code?: string; message?: string } | null;
}> {
  eq(column: string, value: unknown): SelectBuilder<Row>;
  in(column: string, values: readonly unknown[]): SelectBuilder<Row>;
  order(column: string, options?: { ascending?: boolean }): SelectBuilder<Row>;
  limit(count: number): SelectBuilder<Row>;
}

export interface ReadClientLike {
  from(table: string): { select(columns: string): SelectBuilder };
}

/** A read failed: the screen shows it can't load, and TanStack Query retries. */
export class RoomReadError extends Error {
  constructor(
    readonly table: string,
    readonly code: string | undefined,
  ) {
    super(`Couldn't read ${table}`);
    this.name = 'RoomReadError';
  }
}

async function selectRows<T>(
  query: PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }>,
  table: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new RoomReadError(table, error.code);
  const rows: T[] = [];
  for (const raw of data ?? []) {
    const parsed = schema.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
    else
      roomsLog.warn('Dropped a row that did not parse', {
        table,
        issues: zodIssueFields(parsed.error),
      });
  }
  return rows;
}

const audienceSchema = z.enum(['everyone', 'chosen', 'host']);

const roomRowSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    host_id: idSchema.nullable(),
    state: z.enum(['live', 'ended']),
    playback_provider: musicProviderSchema,
    code: z.string().min(1),
    add_songs: audienceSchema,
    control: audienceSchema,
    created_at: timestamp,
    ended_at: timestamp.nullable(),
  })
  .transform((r) => ({
    id: r.id,
    name: r.name,
    hostId: r.host_id,
    ended: r.state === 'ended',
    playsThrough: r.playback_provider,
    code: r.code,
    addSongs: r.add_songs,
    control: r.control,
    createdAt: r.created_at,
  }));
export type RoomRow = z.infer<typeof roomRowSchema>;

const ROOM_COLUMNS =
  'id, name, host_id, state, playback_provider, code, add_songs, control, created_at, ended_at';

const memberRowSchema = z
  .object({ room_id: idSchema, user_id: idSchema, role: z.enum(['host', 'member']) })
  .transform((r) => ({ roomId: r.room_id, userId: r.user_id, role: r.role }));

const profileRowSchema = z
  .object({ id: idSchema, display_name: z.string().nullable(), color: z.string().nullable() })
  .transform((r) => ({ id: r.id, name: r.display_name, color: r.color }));

const ruleMemberRowSchema = z
  .object({ rule: z.enum(['add_songs', 'control']), user_id: idSchema })
  .transform((r) => ({ rule: r.rule, userId: r.user_id }));

export type Member = {
  userId: string;
  role: 'host' | 'member';
  /** Null until the person finished onboarding. */
  name: string | null;
  color: string | null;
};

export type RoomDetail = RoomRow & {
  /** The people the host chose for each rule (`room_rule_members`). */
  chosen: { addSongs: string[]; control: string[] };
};

const queueRowSchema = z
  .object({
    id: idSchema,
    recording_id: idSchema,
    position: z.coerce.number().int().min(0),
    added_by: idSchema.nullable(),
    status: z.enum(['queued', 'playing']),
  })
  .transform((r) => ({
    entryId: r.id,
    recordingId: r.recording_id,
    position: r.position,
    addedBy: r.added_by,
    status: r.status,
  }));

const recordingRowSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1),
    primary_artist: z.string().min(1),
    artists: z.array(z.string()).nullable(),
    album: z.string().nullable(),
    duration_ms: z.number().int().positive(),
    explicit: z.boolean(),
  })
  .transform((r) => ({
    id: r.id,
    title: r.title,
    artists: r.artists && r.artists.length ? r.artists : [r.primary_artist],
    album: r.album,
    durationMs: r.duration_ms,
    explicit: r.explicit,
  }));
export type RecordingRow = z.infer<typeof recordingRowSchema>;

const matchRowSchema = z
  .object({
    recording_id: idSchema,
    provider: musicProviderSchema,
    provider_track_id: z.string().min(1).nullable(),
    confidence: z.number().min(0).max(100),
    method: z.enum(['isrc', 'score', 'override']),
    warning: z.enum(['low_confidence', 'explicit_conflict']).nullable(),
  })
  .transform((r): TrackMatch => ({
    recordingId: r.recording_id,
    provider: r.provider,
    providerTrackId: r.provider_track_id,
    confidence: r.confidence,
    method: r.method,
    warning: r.warning,
  }));

export type QueueEntry = {
  entryId: string;
  position: number;
  status: 'queued' | 'playing';
  addedBy: string | null;
  recording: RecordingRow;
  /** Stored track matches by service. A missing service isn't matched yet. */
  matches: Partial<Record<MusicProvider, TrackMatch>>;
};

export type QueueSnapshot = { nowPlaying: QueueEntry | null; queue: QueueEntry[] };

export const roomReads = {
  /**
   * The room a code opens, among the rooms you're in (RLS). A code is
   * unique among live rooms; an ended room can share it, so the newest wins.
   */
  async roomByCode(client: ReadClientLike, code: string): Promise<RoomRow | null> {
    const rows = await selectRows(
      client.from('rooms').select(ROOM_COLUMNS).eq('code', code).order('created_at', {
        ascending: false,
      }),
      'rooms',
      roomRowSchema,
    );
    return rows.find((row) => !row.ended) ?? rows[0] ?? null;
  },

  async detail(client: ReadClientLike, roomId: string): Promise<RoomDetail | null> {
    const [rooms, chosen] = await Promise.all([
      selectRows(
        client.from('rooms').select(ROOM_COLUMNS).eq('id', roomId),
        'rooms',
        roomRowSchema,
      ),
      selectRows(
        client.from('room_rule_members').select('rule, user_id').eq('room_id', roomId),
        'room_rule_members',
        ruleMemberRowSchema,
      ),
    ]);
    const room = rooms[0];
    if (!room) return null;
    return {
      ...room,
      chosen: {
        addSongs: chosen.filter((c) => c.rule === 'add_songs').map((c) => c.userId),
        control: chosen.filter((c) => c.rule === 'control').map((c) => c.userId),
      },
    };
  },

  async members(client: ReadClientLike, roomId: string): Promise<Member[]> {
    const members = await selectRows(
      client.from('room_members').select('room_id, user_id, role').eq('room_id', roomId),
      'room_members',
      memberRowSchema,
    );
    if (!members.length) return [];
    const profiles = await selectRows(
      client
        .from('profiles')
        .select('id, display_name, color')
        .in(
          'id',
          members.map((m) => m.userId),
        ),
      'profiles',
      profileRowSchema,
    );
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return members
      .map((m) => ({
        userId: m.userId,
        role: m.role,
        name: byId.get(m.userId)?.name ?? null,
        color: byId.get(m.userId)?.color ?? null,
      }))
      .sort((a, b) => (a.role === b.role ? 0 : a.role === 'host' ? -1 : 1));
  },

  async queue(client: ReadClientLike, roomId: string): Promise<QueueSnapshot> {
    const entries = await selectRows(
      client
        .from('queue_entries')
        .select('id, recording_id, position, added_by, status')
        .eq('room_id', roomId)
        .in('status', ['queued', 'playing'])
        .order('position', { ascending: true }),
      'queue_entries',
      queueRowSchema,
    );
    if (!entries.length) return { nowPlaying: null, queue: [] };
    const ids = [...new Set(entries.map((e) => e.recordingId))];
    const [recordings, matches] = await Promise.all([
      selectRows(
        client
          .from('recordings')
          .select('id, title, primary_artist, artists, album, duration_ms, explicit')
          .in('id', ids),
        'recordings',
        recordingRowSchema,
      ),
      selectRows(
        client
          .from('track_matches')
          .select('recording_id, provider, provider_track_id, confidence, method, warning')
          .in('recording_id', ids),
        'track_matches',
        matchRowSchema,
      ),
    ]);
    const recordingById = new Map(recordings.map((r) => [r.id, r]));
    const full: QueueEntry[] = [];
    for (const entry of entries) {
      const recording = recordingById.get(entry.recordingId);
      // An entry whose song can't be read isn't shown half-empty.
      if (!recording) continue;
      const entryMatches: QueueEntry['matches'] = {};
      for (const match of matches) {
        if (match.recordingId === entry.recordingId) entryMatches[match.provider] = match;
      }
      full.push({
        entryId: entry.entryId,
        position: entry.position,
        status: entry.status,
        addedBy: entry.addedBy,
        recording,
        matches: entryMatches,
      });
    }
    return {
      nowPlaying: full.find((e) => e.status === 'playing') ?? null,
      queue: full.filter((e) => e.status === 'queued').sort((a, b) => a.position - b.position),
    };
  },

  /** The live rooms you're in, newest first, for Home. */
  async mine(client: ReadClientLike, userId: string): Promise<RoomRow[]> {
    const memberships = await selectRows(
      client.from('room_members').select('room_id, user_id, role').eq('user_id', userId),
      'room_members',
      memberRowSchema,
    );
    if (!memberships.length) return [];
    const rooms = await selectRows(
      client
        .from('rooms')
        .select(ROOM_COLUMNS)
        .in(
          'id',
          memberships.map((m) => m.roomId),
        )
        .eq('state', 'live')
        .order('created_at', { ascending: false }),
      'rooms',
      roomRowSchema,
    );
    return rooms.filter((room) => !room.ended);
  },
};
