/**
 * reset_demo_accounts: the operator-only reset before a rehearsal or the demo.
 * API_CONTRACTS.md § reset_demo_accounts, DEMO_RUNBOOK.md § Reset between
 * rehearsals.
 */
import { createTestDb, newKey, type TestDb, type TestUser } from './harness/db';
import { insertRecording } from './harness/queue';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`update private.feature_flags set enabled = true where flag = 'demo_reset'`);
});

afterAll(() => db.close());

type ResetResult = {
  applied: boolean;
  users: number;
  rooms_ended: number;
  invites_revoked: number;
  queue_entries_deleted: number;
  import_batches_deleted: number;
  memberships_deleted: number;
  idempotency_keys_deleted: number;
  join_attempts_deleted: number;
  memberships_elsewhere: number;
  profiles_incomplete: number;
  users_without_service: number;
};

const RESULT_KEYS = [
  'applied',
  'idempotency_keys_deleted',
  'import_batches_deleted',
  'invites_revoked',
  'join_attempts_deleted',
  'memberships_deleted',
  'memberships_elsewhere',
  'profiles_incomplete',
  'queue_entries_deleted',
  'rooms_ended',
  'users',
  'users_without_service',
];

const reset = (users: (TestUser | string)[], apply?: boolean) =>
  db.asServiceRole().rpc<ResetResult>('reset_demo_accounts', {
    user_ids: users.map((u) => (typeof u === 'string' ? u : u.id)),
    ...(apply === undefined ? {} : { apply }),
  });

type Room = { roomId: string; code: string };

async function createRoom(host: TestUser): Promise<Room> {
  const room = await db.as(host).rpc<{ room_id: string; code: string }>('create_room', {
    name: 'Friday',
    playback_provider: 'spotify',
    idempotency_key: newKey(),
  });
  return { roomId: room.room_id, code: room.code };
}

const join = (user: TestUser, code: string) =>
  db.as(user).rpc('join_room_by_code', { code, idempotency_key: newKey() });

const enqueue = async (user: TestUser, roomId: string) =>
  db.as(user).rpc('enqueue_recording', {
    room_id: roomId,
    recording_id: await insertRecording(db),
    idempotency_key: newKey(),
  });

const invite = (host: TestUser, roomId: string) =>
  db.as(host).rpc('create_room_invite', { room_id: roomId, idempotency_key: newKey() });

/** A wrong code in the code alphabet, so it counts as a failed attempt. */
const wrongGuess = (user: TestUser) =>
  join(user, 'ZZZZZZ').catch((e: unknown) => e as { code: string });

/** A room as it is mid-rehearsal: guest joined, songs queued, an invite out. */
async function busyRoom(host: TestUser, guest: TestUser) {
  const room = await createRoom(host);
  await join(guest, room.code);
  await enqueue(host, room.roomId);
  await enqueue(guest, room.roomId);
  await enqueue(guest, room.roomId);
  await invite(host, room.roomId);
  await db.query(
    `insert into public.playlist_import_batches (room_id, created_by, provider, source_name)
     values ($1, $2, 'spotify', 'Rehearsal mix')`,
    [room.roomId, guest.id],
  );
  return room;
}

/** Everything the reset might change, for one room. */
async function roomState(roomId: string) {
  const [row] = await db.query<{
    state: string;
    ended: boolean;
    code_expired: boolean;
    members: number;
    queue: number;
    batches: number;
    live_invites: number;
    playback: string | null;
  }>(
    `select r.state,
            r.ended_at is not null as ended,
            r.code_expires_at <= now() as code_expired,
            (select count(*)::int from public.room_members m where m.room_id = r.id) as members,
            (select count(*)::int from public.queue_entries e where e.room_id = r.id) as queue,
            (select count(*)::int from public.playlist_import_batches b where b.room_id = r.id)
              as batches,
            (select count(*)::int from public.room_invites i
              where i.room_id = r.id and i.revoked_at is null) as live_invites,
            (select p.status::text from public.playback_states p where p.room_id = r.id)
              as playback
       from public.rooms r where r.id = $1`,
    [roomId],
  );
  return row;
}

const userCounts = async (user: TestUser) =>
  (
    await db.query<{ keys: number; attempts: number }>(
      `select (select count(*)::int from public.idempotency_keys where user_id = $1) as keys,
              (select count(*)::int from private.join_attempts where user_id = $1) as attempts`,
      [user.id],
    )
  )[0];

const endedBroadcasts = async (roomId: string) =>
  (await db.broadcasts(roomId)).filter((b) => b.event === 'room.ended');

/** The two demo accounts plus a bystander who uses the same project. */
async function cast() {
  const host = await db.createUser({ provider: 'spotify' });
  const guest = await db.createUser();
  const other = await db.createUser({ provider: ['apple_music', 'spotify'] });
  return { host, guest, other };
}

describe('reset_demo_accounts: dry run', () => {
  it('is the default and changes nothing, but reports what it would do', async () => {
    const { host, guest } = await cast();
    const room = await busyRoom(host, guest);
    await wrongGuess(guest);
    const before = await roomState(room.roomId);
    const broadcastsBefore = (await db.broadcasts(room.roomId)).length;

    const result = await reset([host, guest]);
    expect(Object.keys(result).sort()).toEqual(RESULT_KEYS);
    expect(result).toMatchObject({
      applied: false,
      users: 2,
      rooms_ended: 1,
      invites_revoked: 1,
      queue_entries_deleted: 3,
      import_batches_deleted: 1,
      memberships_deleted: 2,
      join_attempts_deleted: 1,
      memberships_elsewhere: 0,
      profiles_incomplete: 0,
      users_without_service: 1,
    });
    // create_room, join, three adds and the invite each stored a key.
    expect(result.idempotency_keys_deleted).toBe(6);

    expect(await roomState(room.roomId)).toEqual(before);
    expect((await db.broadcasts(room.roomId)).length).toBe(broadcastsBefore);
    expect(await userCounts(guest)).toEqual({ keys: 3, attempts: 1 });
  });

  it('apply = false is the same as the default', async () => {
    const { host, guest } = await cast();
    const room = await busyRoom(host, guest);
    const result = await reset([host, guest], false);
    expect(result.applied).toBe(false);
    expect((await roomState(room.roomId)).state).toBe('live');
  });
});

describe('reset_demo_accounts: apply', () => {
  it('ends the live room like end_room: code expired and freed, playback stopped, invite revoked, one room.ended', async () => {
    const { host, guest } = await cast();
    const room = await busyRoom(host, guest);
    await db.query(`update public.playback_states set status = 'playing' where room_id = $1`, [
      room.roomId,
    ]);

    const result = await reset([host, guest], true);
    expect(result).toMatchObject({ applied: true, rooms_ended: 1, invites_revoked: 1 });

    expect(await roomState(room.roomId)).toEqual({
      state: 'ended',
      ended: true,
      code_expired: true,
      members: 0,
      queue: 0,
      batches: 0,
      live_invites: 0,
      playback: 'stopped',
    });
    const ended = await endedBroadcasts(room.roomId);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({
      private: true,
      payload: { v: 1, type: 'room.ended', roomId: room.roomId },
    });
    const [playback] = await db.query(
      'select reported_by from public.playback_states where room_id = $1',
      [room.roomId],
    );
    expect(playback).toEqual({ reported_by: host.id });

    // The code is free: it no longer joins, and a new room may draw it.
    const stranger = await db.createUser();
    await expect(join(stranger, room.code)).rejects.toMatchObject({ code: 'code_invalid' });
    await db.query(
      `insert into public.rooms (name, host_id, playback_provider, code, code_expires_at)
       values ('Next', $1, 'spotify', $2, now() + interval '1 day')`,
      [stranger.id, room.code],
    );
  });

  it('clears the listed users’ idempotency keys and failed join attempts', async () => {
    const { host, guest } = await cast();
    await busyRoom(host, guest);
    await wrongGuess(guest);
    await wrongGuess(guest);
    expect(await userCounts(guest)).toEqual({ keys: 3, attempts: 2 });

    const result = await reset([host, guest], true);
    expect(result.join_attempts_deleted).toBe(2);
    expect(await userCounts(host)).toEqual({ keys: 0, attempts: 0 });
    expect(await userCounts(guest)).toEqual({ keys: 0, attempts: 0 });
  });

  it('lifts a join lockout, so the guest can join the next room straight away', async () => {
    const { host, guest } = await cast();
    for (let i = 0; i < 5; i += 1) await wrongGuess(guest);
    const room = await createRoom(host);
    await expect(join(guest, room.code)).rejects.toMatchObject({ code: 'rate_limited' });

    await reset([host, guest], true);

    const next = await createRoom(host);
    await expect(join(guest, next.code)).resolves.toBeTruthy();
    expect((await roomState(next.roomId)).members).toBe(2);
  });

  it('a replayed key from before the reset is a new request afterwards', async () => {
    const { host } = await cast();
    const key = newKey();
    const args = { name: 'Friday', playback_provider: 'spotify', idempotency_key: key };
    const first = await db.as(host).rpc<{ room_id: string }>('create_room', args);
    await reset([host], true);
    const second = await db.as(host).rpc<{ room_id: string }>('create_room', args);
    expect(second.room_id).not.toBe(first.room_id);
  });

  it('clears the history of rooms that had already ended, without broadcasting again', async () => {
    const { host, guest } = await cast();
    const room = await busyRoom(host, guest);
    await db.as(host).rpc('end_room', { room_id: room.roomId, idempotency_key: newKey() });
    expect(await endedBroadcasts(room.roomId)).toHaveLength(1);

    const result = await reset([host, guest], true);
    expect(result).toMatchObject({
      rooms_ended: 0,
      invites_revoked: 0,
      queue_entries_deleted: 3,
      memberships_deleted: 2,
    });
    expect(await roomState(room.roomId)).toMatchObject({ state: 'ended', members: 0, queue: 0 });
    expect(await endedBroadcasts(room.roomId)).toHaveLength(1);
  });

  it('ends paused rooms too, and every room the host has', async () => {
    const { host, guest } = await cast();
    const a = await busyRoom(host, guest);
    const b = await createRoom(host);
    await db.query(`update public.rooms set state = 'paused' where id = $1`, [b.roomId]);

    const result = await reset([host], true);
    expect(result.rooms_ended).toBe(2);
    expect((await roomState(a.roomId)).state).toBe('ended');
    expect((await roomState(b.roomId)).state).toBe('ended');
  });

  it('deletes other people’s songs and memberships only inside the demo host’s rooms', async () => {
    const { host, guest, other } = await cast();
    const room = await busyRoom(host, guest);
    await join(other, room.code);
    await enqueue(other, room.roomId);

    const result = await reset([host, guest], true);
    expect(result).toMatchObject({ memberships_deleted: 3, queue_entries_deleted: 4 });
    // The bystander's own keys and account are untouched.
    expect((await userCounts(other)).keys).toBe(2);
  });

  it('leaves profiles and music services as they are', async () => {
    const { host, guest } = await cast();
    await busyRoom(host, guest);
    const read = () =>
      db.query(
        `select p.id, p.display_name, p.color, p.adult_confirmed_at,
                (select array_agg(c.provider::text order by c.provider)
                   from public.provider_connections c where c.user_id = p.id) as providers
           from public.profiles p where p.id = any($1::uuid[]) order by p.id`,
        [[host.id, guest.id]],
      );
    const before = await read();
    await reset([host, guest], true);
    expect(await read()).toEqual(before);
  });

  it('reports accounts that aren’t ready for the demo', async () => {
    const unfinished = await db.createUser({ profile: false });
    const result = await reset([unfinished]);
    expect(result).toMatchObject({ profiles_incomplete: 1, users_without_service: 1 });
  });
});

describe('reset_demo_accounts: only the listed users', () => {
  it('never touches a room the listed users don’t host, even one they’re in', async () => {
    const { host, guest, other } = await cast();
    const demoRoom = await busyRoom(host, guest);
    const otherRoom = await busyRoom(other, guest);
    await wrongGuess(other);
    const otherBefore = await roomState(otherRoom.roomId);
    const otherCounts = await userCounts(other);
    const otherBroadcasts = (await db.broadcasts(otherRoom.roomId)).length;

    const result = await reset([host, guest], true);
    // Only the guest's membership of the other room is reported.
    expect(result.memberships_elsewhere).toBe(1);

    expect((await roomState(demoRoom.roomId)).state).toBe('ended');
    expect(await roomState(otherRoom.roomId)).toEqual(otherBefore);
    expect(otherBefore).toMatchObject({ state: 'live', members: 2, queue: 3, live_invites: 1 });
    expect(await userCounts(other)).toEqual(otherCounts);
    expect((await db.broadcasts(otherRoom.roomId)).length).toBe(otherBroadcasts);
    // The other room still works for its members, the demo guest included.
    await expect(enqueue(guest, otherRoom.roomId)).resolves.toBeTruthy();
  });

  it('a host who isn’t listed keeps everything although their guest is listed', async () => {
    const { host, guest } = await cast();
    const room = await busyRoom(host, guest);
    const before = await roomState(room.roomId);
    const result = await reset([guest], true);
    expect(result).toMatchObject({
      rooms_ended: 0,
      memberships_deleted: 0,
      memberships_elsewhere: 1,
    });
    expect(await roomState(room.roomId)).toEqual(before);
    expect((await userCounts(host)).keys).toBeGreaterThan(0);
  });
});

describe('reset_demo_accounts: idempotent', () => {
  it('a second run finds nothing to do and sends nothing', async () => {
    const { host, guest } = await cast();
    const room = await busyRoom(host, guest);
    await wrongGuess(guest);
    await reset([host, guest], true);
    const after = await roomState(room.roomId);
    const broadcasts = (await db.broadcasts(room.roomId)).length;

    const again = await reset([host, guest], true);
    expect(again).toMatchObject({
      applied: true,
      users: 2,
      rooms_ended: 0,
      invites_revoked: 0,
      queue_entries_deleted: 0,
      import_batches_deleted: 0,
      memberships_deleted: 0,
      idempotency_keys_deleted: 0,
      join_attempts_deleted: 0,
    });
    expect(await roomState(room.roomId)).toEqual(after);
    expect((await db.broadcasts(room.roomId)).length).toBe(broadcasts);
    // And a dry run afterwards agrees.
    expect(await reset([host, guest])).toMatchObject({ rooms_ended: 0, memberships_deleted: 0 });
  });

  it('a repeated id counts once', async () => {
    const { host } = await cast();
    await createRoom(host);
    const result = await reset([host, host, host.id.toUpperCase()]);
    expect(result).toMatchObject({ users: 1, rooms_ended: 1 });
  });
});

describe('reset_demo_accounts: refusals', () => {
  it('refuses an empty list', async () => {
    await expect(reset([], true)).rejects.toMatchObject({
      code: 'invalid_input',
      hint: 'qd',
      details: { field: 'user_ids', reason: 'empty' },
    });
  });

  it('refuses a missing list', async () => {
    await expect(
      db.asServiceRole().rpc('reset_demo_accounts', { user_ids: null, apply: true }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'user_ids', reason: 'empty' },
    });
  });

  it('refuses a list with a null in it', async () => {
    const { host } = await cast();
    const room = await createRoom(host);
    await expect(
      db
        .asServiceRole()
        .query(`select public.reset_demo_accounts(array[$1::uuid, null], true)`, [host.id]),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'user_ids', reason: 'null_id' },
    });
    expect((await roomState(room.roomId)).state).toBe('live');
  });

  it('refuses a missing apply', async () => {
    const { host } = await cast();
    await expect(
      db.asServiceRole().rpc('reset_demo_accounts', { user_ids: [host.id], apply: null }),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'apply' } });
  });

  it('refuses ids that aren’t accounts, without touching the real ones in the list', async () => {
    const { host } = await cast();
    const room = await createRoom(host);
    await expect(reset([host, newKey(), newKey()], true)).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'user_ids', reason: 'unknown_user', count: 2 },
    });
    expect((await roomState(room.roomId)).state).toBe('live');
  });

  it('refuses more than ten accounts', async () => {
    const users: TestUser[] = [];
    for (let i = 0; i < 11; i += 1) users.push(await db.createUser({ provider: 'spotify' }));
    const room = await createRoom(users[0]);
    await expect(reset(users, true)).rejects.toMatchObject({
      code: 'limit_exceeded',
      details: { field: 'user_ids', limit: 10 },
    });
    expect((await roomState(room.roomId)).state).toBe('live');
    await expect(reset(users.slice(0, 10))).resolves.toMatchObject({ users: 10 });
  });

  it('refuses to run while the demo_reset flag is off (every project but the demo one)', async () => {
    const { host } = await cast();
    const room = await createRoom(host);
    await db.query(`update private.feature_flags set enabled = false where flag = 'demo_reset'`);
    try {
      await expect(reset([host], true)).rejects.toMatchObject({
        code: 'feature_disabled',
        details: { flag: 'demo_reset' },
      });
      await expect(reset([host])).rejects.toMatchObject({ code: 'feature_disabled' });
    } finally {
      await db.query(`update private.feature_flags set enabled = true where flag = 'demo_reset'`);
    }
    expect((await roomState(room.roomId)).state).toBe('live');
  });

  it('ships with the flag off', async () => {
    const fresh = await createTestDb();
    try {
      const rows = await fresh.query(
        `select enabled from private.feature_flags where flag = 'demo_reset'`,
      );
      expect(rows).toEqual([{ enabled: false }]);
    } finally {
      await fresh.close();
    }
  });
});

describe('reset_demo_accounts: who may run it', () => {
  it('anon and signed-in users cannot execute it', async () => {
    const { host } = await cast();
    const room = await createRoom(host);
    const args = { user_ids: [host.id], apply: true };
    await expect(db.asAnon().rpc('reset_demo_accounts', args)).rejects.toMatchObject({
      sqlstate: '42501',
    });
    await expect(db.as(host).rpc('reset_demo_accounts', args)).rejects.toMatchObject({
      sqlstate: '42501',
    });
    expect((await roomState(room.roomId)).state).toBe('live');
  });

  it('only service_role holds execute; it’s security definer with a pinned search_path', async () => {
    const [fn] = await db.query(
      `select p.prosecdef as definer, array_to_string(p.proconfig, ',') as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service_role,
              (select bool_or(acl.grantee = 0)
                 from aclexplode(p.proacl) acl) as public
         from pg_proc p
        where p.oid = 'public.reset_demo_accounts(uuid[], boolean)'::regprocedure`,
    );
    expect(fn).toEqual({
      definer: true,
      config: 'search_path=""',
      anon: false,
      authenticated: false,
      service_role: true,
      public: false,
    });
  });

  it('the shared helpers are not callable by any API role', async () => {
    const rows = await db.query<{ fn: string; anon: boolean; auth: boolean; service: boolean }>(
      `select p.proname as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname in ('close_room', 'demo_reset_user_limit')
        order by p.proname`,
    );
    expect(rows).toEqual([
      { fn: 'close_room', anon: false, auth: false, service: false },
      { fn: 'demo_reset_user_limit', anon: false, auth: false, service: false },
    ]);
  });

  it('refuses a call that carries a signed-in user even if execute were granted by mistake', async () => {
    const { host } = await cast();
    const room = await createRoom(host);
    await db.query(
      'grant execute on function public.reset_demo_accounts(uuid[], boolean) to authenticated',
    );
    try {
      await expect(
        db.as(host).rpc('reset_demo_accounts', { user_ids: [host.id], apply: true }),
      ).rejects.toMatchObject({ code: 'not_allowed', hint: 'qd' });
    } finally {
      await db.query(
        'revoke execute on function public.reset_demo_accounts(uuid[], boolean) from authenticated',
      );
    }
    expect((await roomState(room.roomId)).state).toBe('live');
  });
});

describe('end_room through the shared helper', () => {
  it('still ends the room the same way, and close_room refuses a room that already ended', async () => {
    const { host, guest } = await cast();
    const room = await busyRoom(host, guest);
    await db.as(host).rpc('end_room', { room_id: room.roomId, idempotency_key: newKey() });
    expect(await roomState(room.roomId)).toMatchObject({
      state: 'ended',
      code_expired: true,
      live_invites: 0,
      playback: 'stopped',
      // end_room keeps history; only the reset clears it.
      members: 2,
      queue: 3,
    });
    await expect(
      db.query('select private.close_room($1, $2)', [room.roomId, host.id]),
    ).rejects.toThrow(/already ended/);
  });

  it('keeps security definer, the pinned search_path and its grants after the replace', async () => {
    const [fn] = await db.query(
      `select p.prosecdef as definer, array_to_string(p.proconfig, ',') as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              (select bool_or(acl.grantee = 0) from aclexplode(p.proacl) acl) as public
         from pg_proc p
        where p.oid = 'public.end_room(uuid, uuid)'::regprocedure`,
    );
    expect(fn).toEqual({
      definer: true,
      config: 'search_path=""',
      anon: false,
      authenticated: true,
      public: false,
    });
  });

  it('close_room is a plain helper: not security definer, search_path pinned', async () => {
    const [fn] = await db.query(
      `select p.prosecdef as definer, array_to_string(p.proconfig, ',') as config
         from pg_proc p where p.oid = 'private.close_room(uuid, uuid)'::regprocedure`,
    );
    expect(fn).toEqual({ definer: false, config: 'search_path=""' });
  });

  it('a replay after the room ended returns the first result and broadcasts once', async () => {
    const { host } = await cast();
    const room = await createRoom(host);
    const key = newKey();
    const args = { room_id: room.roomId, idempotency_key: key };
    const first = await db.as(host).rpc('end_room', args);
    expect(await db.as(host).rpc('end_room', args)).toEqual(first);
    expect(await endedBroadcasts(room.roomId)).toHaveLength(1);
    await expect(
      db.as(host).rpc('end_room', { room_id: room.roomId, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ code: 'room_ended' });
  });
});

describe('reset_demo_accounts: nothing else changes', () => {
  /** Tables the reset may write to. Every other table must come out identical. */
  const WRITABLE = new Set([
    'public.rooms',
    'public.playback_states',
    'public.room_invites',
    'public.queue_entries',
    'public.playlist_import_batches',
    'public.room_members',
    'public.room_rule_members',
    'public.playback_slots',
    'public.idempotency_keys',
    'private.join_attempts',
    'realtime.messages',
  ]);

  /** One fingerprint per table: its rows as text, sorted. */
  async function fingerprints() {
    const tables = await db.query<{ name: string }>(
      `select n.nspname || '.' || c.relname as name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p') and n.nspname in ('public', 'private', 'auth', 'realtime')
        order by 1`,
    );
    const out: Record<string, string> = {};
    for (const { name } of tables) {
      const [row] = await db.query<{ fp: string }>(
        `select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as fp from ${name} t`,
      );
      out[name] = row.fp;
    }
    return out;
  }

  /** Every row of these rooms and users, as text. */
  const slice = (roomIds: string[], userIds: string[]) =>
    db.query(
      `select 'room' as t, r::text as row from public.rooms r where r.id = any($1::uuid[])
       union all select 'member', m::text from public.room_members m
        where m.room_id = any($1::uuid[]) or m.user_id = any($2::uuid[])
       union all select 'rule', x::text from public.room_rule_members x
        where x.room_id = any($1::uuid[]) or x.user_id = any($2::uuid[])
       union all select 'slot', s::text from public.playback_slots s
        where s.room_id = any($1::uuid[]) or s.user_id = any($2::uuid[])
       union all select 'queue', e::text from public.queue_entries e
        where e.room_id = any($1::uuid[])
       union all select 'batch', b::text from public.playlist_import_batches b
        where b.room_id = any($1::uuid[])
       union all select 'invite', i::text from public.room_invites i
        where i.room_id = any($1::uuid[])
       union all select 'playback', p::text from public.playback_states p
        where p.room_id = any($1::uuid[])
       union all select 'key', k::text from public.idempotency_keys k
        where k.user_id = any($2::uuid[])
       union all select 'attempt', a::text from private.join_attempts a
        where a.user_id = any($2::uuid[])
       order by 1, 2`,
      [roomIds, userIds],
    );

  it('writes only its tables, and nothing of a bystander’s room or account', async () => {
    const { host, guest, other } = await cast();
    const demoRoom = await busyRoom(host, guest);
    const otherRoom = await busyRoom(other, guest);
    const otherOnly = await createRoom(other);
    // A chosen-people rule and a (beta) slot in both shared rooms, so the
    // membership cascades run on each side.
    for (const r of [
      { roomId: demoRoom.roomId, owner: host },
      { roomId: otherRoom.roomId, owner: other },
    ]) {
      await db.query(
        `insert into public.room_rule_members (room_id, rule, user_id) values ($1, 'control', $2)`,
        [r.roomId, guest.id],
      );
      await db.query(
        `insert into public.playback_slots (room_id, slot, user_id, provider)
         values ($1, 1, $2, 'spotify')`,
        [r.roomId, r.owner.id],
      );
    }
    await db.query(
      `update public.playback_states p set entry_id = e.id, status = 'playing'
         from public.queue_entries e
        where p.room_id = $1 and e.room_id = $1 and e.status = 'playing'`,
      [demoRoom.roomId],
    );
    await wrongGuess(other);
    const before = await fingerprints();
    const bystander = await slice([otherRoom.roomId, otherOnly.roomId], [other.id]);

    await reset([host, guest], true);

    const after = await fingerprints();
    const changed = Object.keys(after).filter((name) => after[name] !== before[name]);
    expect(changed.filter((name) => !WRITABLE.has(name))).toEqual([]);
    expect(await slice([otherRoom.roomId, otherOnly.roomId], [other.id])).toEqual(bystander);

    const [demo] = await db.query(
      `select (select count(*)::int from public.room_rule_members where room_id = $1) as rules,
              (select count(*)::int from public.playback_slots where room_id = $1) as slots,
              (select entry_id from public.playback_states where room_id = $1) as entry`,
      [demoRoom.roomId],
    );
    expect(demo).toEqual({ rules: 0, slots: 0, entry: null });
  });

  it('a dry run writes nothing anywhere, broadcasts included', async () => {
    const { host, guest } = await cast();
    await busyRoom(host, guest);
    await wrongGuess(guest);
    const before = await fingerprints();
    await reset([host, guest]);
    expect(await fingerprints()).toEqual(before);
  });

  it('a refused call writes nothing anywhere', async () => {
    const { host } = await cast();
    await createRoom(host);
    const before = await fingerprints();
    await expect(reset([host, newKey()], true)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await fingerprints()).toEqual(before);
  });

  it('a demo host who is a guest in someone else’s room keeps that membership', async () => {
    const { host, other } = await cast();
    const otherRoom = await createRoom(other);
    await join(host, otherRoom.code);
    const result = await reset([host], true);
    expect(result.memberships_elsewhere).toBe(1);
    expect(await roomState(otherRoom.roomId)).toMatchObject({ state: 'live', members: 2 });
  });

  it('memberships in ended rooms other people host are not reported', async () => {
    const { host, guest, other } = await cast();
    const otherRoom = await createRoom(other);
    await join(guest, otherRoom.code);
    await db.as(other).rpc('end_room', { room_id: otherRoom.roomId, idempotency_key: newKey() });
    expect((await reset([host, guest])).memberships_elsewhere).toBe(0);
  });

  it('a bystander’s key used in the demo room is kept, so its replay still answers', async () => {
    const { host, guest, other } = await cast();
    const room = await busyRoom(host, guest);
    const args = { code: room.code, idempotency_key: newKey() };
    const first = await db.as(other).rpc('join_room_by_code', args);
    await reset([host, guest], true);
    expect(await db.as(other).rpc('join_room_by_code', args)).toEqual(first);
  });
});
