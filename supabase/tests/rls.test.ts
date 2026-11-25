/**
 * Row level security, tested as the host, a member, an outsider and anon.
 * Clients only read, and only what their membership allows. Every write goes
 * through an RPC.
 */
import { createTestDb, type Session, type TestDb, type TestUser } from './harness/db';

let db: TestDb;
let host: TestUser;
let member: TestUser;
let outsider: TestUser;
let roomId: string;
let otherRoomId: string;

const ROOM_TABLES = [
  'rooms',
  'room_members',
  'room_rule_members',
  'room_invites',
  'queue_entries',
  'playback_states',
  'playback_slots',
  'playlist_import_batches',
  'track_match_overrides',
] as const;

const ALL_TABLES = [
  ...ROOM_TABLES,
  'profiles',
  'provider_connections',
  'recordings',
  'provider_tracks',
  'track_matches',
  'blocks',
  'reports',
  'analytics_events',
  'idempotency_keys',
] as const;

/** A room with one row in every room table. */
async function seedRoom(owner: TestUser, guests: TestUser[], code: string): Promise<string> {
  const [room] = await db.query<{ id: string }>(
    `insert into public.rooms (name, host_id, playback_provider, code, code_expires_at)
     values ('Friday', $1, 'spotify', $2, now() + interval '1 day') returning id`,
    [owner.id, code],
  );
  await db.query(
    `insert into public.room_members (room_id, user_id, role) values ($1, $2, 'host')`,
    [room.id, owner.id],
  );
  for (const guest of guests) {
    await db.query(`insert into public.room_members (room_id, user_id) values ($1, $2)`, [
      room.id,
      guest.id,
    ]);
    await db.query(
      `insert into public.room_rule_members (room_id, rule, user_id) values ($1, 'control', $2)`,
      [room.id, guest.id],
    );
  }
  const [recording] = await db.query<{ id: string }>(
    `insert into public.recordings (title, primary_artist, duration_ms) values ('Rain Down', 'A', 200000)
     returning id`,
  );
  await db.query(
    `insert into public.provider_tracks (provider, provider_track_id, title, duration_ms)
     values ('spotify', $1, 'Rain Down', 200000)`,
    [`sp-${code}`],
  );
  await db.query(
    `insert into public.track_matches (recording_id, provider, provider_track_id, confidence, method)
     values ($1, 'spotify', $2, 100, 'isrc')`,
    [recording.id, `sp-${code}`],
  );
  await db.query(
    `insert into public.track_match_overrides (room_id, recording_id, provider, provider_track_id, created_by)
     values ($1, $2, 'spotify', $3, $4)`,
    [room.id, recording.id, `sp-${code}`, owner.id],
  );
  const [batch] = await db.query<{ id: string }>(
    `insert into public.playlist_import_batches (room_id, created_by, provider, source_name, item_count)
     values ($1, $2, 'spotify', 'Road trip', 1) returning id`,
    [room.id, owner.id],
  );
  const [entry] = await db.query<{ id: string }>(
    `insert into public.queue_entries (room_id, recording_id, position, added_by, batch_id, status)
     values ($1, $2, 1, $3, $4, 'playing') returning id`,
    [room.id, recording.id, owner.id, batch.id],
  );
  await db.query(
    `insert into public.playback_states (room_id, entry_id, status, reported_by) values ($1, $2, 'playing', $3)`,
    [room.id, entry.id, owner.id],
  );
  await db.query(
    `insert into public.playback_slots (room_id, slot, user_id, provider) values ($1, 1, $2, 'spotify')`,
    [room.id, owner.id],
  );
  await db.query(
    `insert into public.room_invites (room_id, token_hash, created_by, expires_at)
     values ($1, sha256(convert_to($2, 'UTF8')), $3, now() + interval '1 day')`,
    [room.id, code, owner.id],
  );
  return room.id;
}

beforeAll(async () => {
  db = await createTestDb();
  host = await db.createUser({ provider: 'spotify' });
  member = await db.createUser();
  outsider = await db.createUser({ provider: 'apple_music' });
  roomId = await seedRoom(host, [member], 'RLSAAA');
  otherRoomId = await seedRoom(outsider, [], 'RLSBBB');
  await db.query(`insert into public.blocks (blocker_id, blocked_id) values ($1, $2)`, [
    outsider.id,
    host.id,
  ]);
  await db.query(
    `insert into public.reports (reporter_id, reported_user_id, reason) values ($1, $2, 'spam')`,
    [outsider.id, host.id],
  );
  await db.query(
    `insert into public.analytics_events (analytics_id, name) values (gen_random_uuid(), 'app.open')`,
  );
  await db.query(
    `insert into public.idempotency_keys (user_id, operation, idempotency_key, request_hash, result)
     values ($1, 'create_room', gen_random_uuid(), '\\x00', '{}')`,
    [host.id],
  );
});

afterAll(() => db.close());

const roomColumn = (table: string) => (table === 'rooms' ? 'id' : 'room_id');

const roomIdsSeen = async (session: Session, table: string) =>
  (
    await session.query<{ room_id: string }>(
      `select distinct ${roomColumn(table)}::text as room_id from public.${table}`,
    )
  ).map((row) => row.room_id);

describe('reading room tables', () => {
  it.each(ROOM_TABLES.filter((table) => table !== 'room_invites'))(
    'host and members read their own room in %s, and nothing else',
    async (table) => {
      expect(await roomIdsSeen(db.as(host), table)).toEqual([roomId]);
      expect(await roomIdsSeen(db.as(member), table)).toEqual([roomId]);
    },
  );

  it.each(ROOM_TABLES)('an outsider sees none of the room in %s', async (table) => {
    expect(await roomIdsSeen(db.as(outsider), table)).not.toContain(roomId);
  });

  it('only the host reads the invite row', async () => {
    expect(await roomIdsSeen(db.as(host), 'room_invites')).toEqual([roomId]);
    expect(await roomIdsSeen(db.as(member), 'room_invites')).toEqual([]);
  });

  it('a member reads every member of the room, and the chosen people', async () => {
    const members = await db
      .as(member)
      .query<{ user_id: string }>('select user_id from public.room_members order by role');
    expect(members.map((row) => row.user_id).sort()).toEqual([host.id, member.id].sort());
    const chosen = await db.as(member).query('select user_id, rule from public.room_rule_members');
    expect(chosen).toEqual([{ user_id: member.id, rule: 'control' }]);
  });

  it('leaving the room ends access', async () => {
    const leaver = await db.createUser();
    await db.query(`insert into public.room_members (room_id, user_id) values ($1, $2)`, [
      roomId,
      leaver.id,
    ]);
    expect(await roomIdsSeen(db.as(leaver), 'queue_entries')).toEqual([roomId]);
    await db.query('delete from public.room_members where room_id = $1 and user_id = $2', [
      roomId,
      leaver.id,
    ]);
    expect(await roomIdsSeen(db.as(leaver), 'queue_entries')).toEqual([]);
    expect(await roomIdsSeen(db.as(leaver), 'rooms')).toEqual([]);
  });
});

describe('anon', () => {
  it.each(ALL_TABLES)('cannot read %s', async (table) => {
    await expect(db.asAnon().query(`select * from public.${table}`)).rejects.toMatchObject({
      sqlstate: '42501',
    });
  });
});

describe('direct writes', () => {
  const writes = (table: string) => {
    const column = roomColumn(table);
    return [
      `update public.${table} set ${column} = ${column}`,
      `delete from public.${table}`,
      `insert into public.${table} select * from public.${table} limit 1`,
    ];
  };

  it.each(ROOM_TABLES)('the host cannot insert, update or delete %s directly', async (table) => {
    for (const sql of writes(table)) {
      await expect(db.as(host).query(sql)).rejects.toMatchObject({ sqlstate: '42501' });
    }
  });

  it.each(ROOM_TABLES)('a member cannot insert, update or delete %s directly', async (table) => {
    for (const sql of writes(table)) {
      await expect(db.as(member).query(sql)).rejects.toMatchObject({ sqlstate: '42501' });
    }
  });

  it.each(ROOM_TABLES)('an outsider cannot insert, update or delete %s directly', async (table) => {
    for (const sql of writes(table)) {
      await expect(db.as(outsider).query(sql)).rejects.toMatchObject({ sqlstate: '42501' });
    }
  });

  it('nobody can reorder the queue, change playback or end the room by writing rows', async () => {
    for (const user of [host, member, outsider]) {
      const session = db.as(user);
      await expect(
        session.query(`update public.queue_entries set position = 99 where room_id = $1`, [roomId]),
      ).rejects.toMatchObject({ sqlstate: '42501' });
      await expect(
        session.query(`update public.playback_states set status = 'paused' where room_id = $1`, [
          roomId,
        ]),
      ).rejects.toMatchObject({ sqlstate: '42501' });
      await expect(
        session.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
          roomId,
        ]),
      ).rejects.toMatchObject({ sqlstate: '42501' });
    }
    const [row] = await db.query<{ status: string }>(
      'select status from public.playback_states where room_id = $1',
      [roomId],
    );
    expect(row.status).toBe('playing');
  });

  it.each([
    'recordings',
    'provider_tracks',
    'track_matches',
    'reports',
    'analytics_events',
    'idempotency_keys',
  ])('signed-in users cannot write %s directly', async (table) => {
    await expect(db.as(host).query(`delete from public.${table}`)).rejects.toMatchObject({
      sqlstate: '42501',
    });
  });
});

describe('permissions the RPCs enforce, with the default room rules', () => {
  const allowed = async (user: TestUser, rule: 'add_songs' | 'control') => {
    const [row] = await db.query<{ ok: boolean }>(
      `select private.is_allowed(r, $2, $3::public.room_rule) as ok from public.rooms r where r.id = $1`,
      [roomId, user.id, rule],
    );
    return row.ok;
  };

  beforeAll(async () => {
    // Defaults: everyone adds songs, only the host plays, skips, reorders and removes.
    await db.query(
      `update public.rooms set add_songs = 'everyone', control = 'host' where id = $1`,
      [roomId],
    );
  });

  it('members may add songs', async () => {
    expect(await allowed(host, 'add_songs')).toBe(true);
    expect(await allowed(member, 'add_songs')).toBe(true);
  });

  it('only the host may play, pause, seek, skip, remove and reorder', async () => {
    expect(await allowed(host, 'control')).toBe(true);
    // The member is on the chosen list, but the rule is "host", so it doesn't apply.
    expect(await allowed(member, 'control')).toBe(false);
  });

  it('outsiders may do nothing', async () => {
    expect(await allowed(outsider, 'add_songs')).toBe(false);
    expect(await allowed(outsider, 'control')).toBe(false);
  });
});

describe('profiles', () => {
  it('members see each other; outsiders see only themselves', async () => {
    const seen = async (user: TestUser) =>
      (await db.as(user).query<{ id: string }>('select id from public.profiles'))
        .map((row) => row.id)
        .sort();
    expect(await seen(member)).toEqual([host.id, member.id].sort());
    expect(await seen(outsider)).toEqual([outsider.id]);
  });

  it('a user edits their own onboarding fields only', async () => {
    const rows = await db
      .as(member)
      .query(
        `update public.profiles set display_name = 'Maya' where id = $1 returning display_name`,
        [member.id],
      );
    expect(rows).toEqual([{ display_name: 'Maya' }]);
    const others = await db
      .as(member)
      .query(`update public.profiles set display_name = 'Hacked' where id = $1 returning id`, [
        host.id,
      ]);
    expect(others).toEqual([]);
    await expect(
      db
        .as(member)
        .query(`update public.profiles set created_at = now() where id = $1`, [member.id]),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(
      db.as(member).query(`delete from public.profiles where id = $1`, [member.id]),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });
});

describe('provider connections', () => {
  it('are private to their owner', async () => {
    const own = await db
      .as(host)
      .query<{ user_id: string }>('select user_id from public.provider_connections');
    expect(own.map((row) => row.user_id)).toEqual([host.id]);
    expect(await db.as(member).query('select * from public.provider_connections')).toEqual([]);
  });

  it('a user connects and disconnects their own services only', async () => {
    await db
      .as(member)
      .query(`insert into public.provider_connections (user_id, provider) values ($1, 'spotify')`, [
        member.id,
      ]);
    await expect(
      db
        .as(member)
        .query(
          `insert into public.provider_connections (user_id, provider) values ($1, 'apple_music')`,
          [host.id],
        ),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    const removedOther = await db
      .as(member)
      .query('delete from public.provider_connections where user_id = $1 returning 1', [host.id]);
    expect(removedOther).toEqual([]);
    const removedOwn = await db
      .as(member)
      .query('delete from public.provider_connections where user_id = $1 returning 1', [member.id]);
    expect(removedOwn).toHaveLength(1);
  });
});

describe('catalog', () => {
  it('signed-in users read recordings and matches', async () => {
    const rows = await db.as(outsider).query('select id from public.recordings');
    expect(rows.length).toBeGreaterThan(0);
    expect(
      (await db.as(member).query('select * from public.track_matches')).length,
    ).toBeGreaterThan(0);
  });
});

describe('moderation and system tables', () => {
  it('blocks and reports are visible to their author only', async () => {
    expect(await db.as(outsider).query('select * from public.blocks')).toHaveLength(1);
    expect(await db.as(host).query('select * from public.blocks')).toEqual([]);
    expect(await db.as(outsider).query('select * from public.reports')).toHaveLength(1);
    expect(await db.as(host).query('select * from public.reports')).toEqual([]);
  });

  it('a user blocks and unblocks for themselves only', async () => {
    await db
      .as(member)
      .query('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [
        member.id,
        outsider.id,
      ]);
    await expect(
      db
        .as(member)
        .query('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [
          host.id,
          outsider.id,
        ]),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    const removed = await db.as(member).query('delete from public.blocks returning blocker_id');
    expect(removed).toEqual([{ blocker_id: member.id }]);
  });

  it.each(['idempotency_keys', 'analytics_events'])(
    '%s is never readable by clients',
    async (table) => {
      await expect(db.as(host).query(`select * from public.${table}`)).rejects.toMatchObject({
        sqlstate: '42501',
      });
    },
  );
});

describe('Realtime Authorization', () => {
  const listen = (user: TestUser, topic: string) => db.as(user, { 'realtime.topic': topic });

  beforeAll(async () => {
    await db.query(`select private.broadcast_room_event($1, 'queue.changed')`, [roomId]);
  });

  it('members receive the room channel', async () => {
    const rows = await listen(member, `room:${roomId}`).query<{ event: string }>(
      'select event from realtime.messages',
    );
    expect(rows.map((row) => row.event)).toContain('queue.changed');
  });

  it('outsiders and malformed topics receive nothing', async () => {
    expect(
      await listen(outsider, `room:${roomId}`).query('select * from realtime.messages'),
    ).toEqual([]);
    expect(
      await listen(member, 'room:not-a-uuid').query('select * from realtime.messages'),
    ).toEqual([]);
    expect(
      await listen(member, `room:${otherRoomId}`).query('select * from realtime.messages'),
    ).toEqual([]);
  });

  it('members may track presence but never send broadcasts', async () => {
    const send = (user: TestUser, extension: string) =>
      listen(user, `room:${roomId}`).query(
        `insert into realtime.messages (topic, extension, event, payload, private)
         values ($1, $2, 'sync', '{}', true)`,
        [`room:${roomId}`, extension],
      );
    await send(member, 'presence');
    await expect(send(member, 'broadcast')).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(send(outsider, 'presence')).rejects.toMatchObject({ sqlstate: '42501' });
  });
});

describe('guards for future migrations', () => {
  it('anon holds no privilege on any public table', async () => {
    const rows = await db.query<{ t: string }>(
      `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and (has_table_privilege('anon', c.oid, 'select')
               or has_table_privilege('anon', c.oid, 'insert')
               or has_table_privilege('anon', c.oid, 'update')
               or has_table_privilege('anon', c.oid, 'delete'))`,
    );
    expect(rows).toEqual([]);
  });

  it('signed-in users write only their profile, connections and blocks', async () => {
    const rows = await db.query<{ t: string }>(
      `select distinct c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and (has_table_privilege('authenticated', c.oid, 'insert')
               or has_table_privilege('authenticated', c.oid, 'delete')
               or has_any_column_privilege('authenticated', c.oid, 'update')
               or has_any_column_privilege('authenticated', c.oid, 'insert'))
        order by 1`,
    );
    expect(rows.map((row) => row.t)).toEqual(['blocks', 'profiles', 'provider_connections']);
  });
});
