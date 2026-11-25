/**
 * Initial Supabase migrations: the schema applies cleanly to a fresh database
 * and its constraints, enums, defaults and indexes behave.
 */
import { randomUUID } from 'node:crypto';

import { createTestDb, migrationFiles, type TestDb, type TestUser } from './harness/db';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => db.close());

const PUBLIC_TABLES = [
  'analytics_events',
  'blocks',
  'idempotency_keys',
  'playback_slots',
  'playback_states',
  'playlist_import_batches',
  'profiles',
  'provider_connections',
  'provider_tracks',
  'queue_entries',
  'recordings',
  'reports',
  'room_invites',
  'room_members',
  'room_rule_members',
  'rooms',
  'track_match_overrides',
  'track_matches',
];

/** Inserts a room directly (as the superuser), bypassing the RPCs. */
async function insertRoom(host: TestUser, overrides: Record<string, unknown> = {}) {
  const values = {
    name: 'Friday',
    host_id: host.id,
    playback_provider: 'spotify',
    code: randomCode(),
    code_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
  const keys = Object.keys(values);
  const [room] = await db.query<{ id: string; code: string }>(
    `insert into public.rooms (${keys.join(', ')})
     values (${keys.map((_, i) => `$${i + 1}`).join(', ')})
     returning *`,
    Object.values(values),
  );
  await db.query(
    `insert into public.room_members (room_id, user_id, role) values ($1, $2, 'host')`,
    [room.id, host.id],
  );
  return room;
}

let codeCounter = 0;
function randomCode(): string {
  codeCounter += 1;
  return `T${codeCounter.toString(36).toUpperCase().padStart(5, '0')}`;
}

async function insertRecording(overrides: Record<string, unknown> = {}) {
  const values = {
    title: 'Rain Down',
    primary_artist: 'Artist',
    duration_ms: 200_000,
    ...overrides,
  };
  const keys = Object.keys(values);
  const [row] = await db.query<{ id: string }>(
    `insert into public.recordings (${keys.join(', ')})
     values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(values),
  );
  return row.id;
}

const rejectsWith = (promise: Promise<unknown>, sqlstate: string) =>
  expect(promise).rejects.toMatchObject({ sqlstate });

describe('migrations', () => {
  it('are named <timestamp>_<name>.sql, unique and in order', () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    const stamps = files.map((file) => file.slice(0, 14));
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it('apply cleanly to a second fresh database', async () => {
    const other = await createTestDb();
    await other.close();
  });

  it('create every planned table', async () => {
    const rows = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(PUBLIC_TABLES);
  });

  it('switch on row level security for every public table', async () => {
    const rows = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });
});

describe('enums', () => {
  const values = async (type: string) =>
    (
      await db.query<{ v: string }>(`select unnest(enum_range(null::public.${type}))::text as v`)
    ).map((row) => row.v);

  it('model aux and sync modes', async () => {
    expect(await values('playback_mode')).toEqual(['aux', 'sync']);
  });

  it('allow only Apple Music and Spotify', async () => {
    expect(await values('music_provider')).toEqual(['apple_music', 'spotify']);
  });

  it('match the domain types', async () => {
    expect(await values('room_state')).toEqual(['live', 'paused', 'ended']);
    expect(await values('room_audience')).toEqual(['everyone', 'chosen', 'host']);
    expect(await values('queue_entry_status')).toEqual(['queued', 'playing', 'played', 'removed']);
    expect(await values('playback_status')).toEqual(['playing', 'paused', 'stopped', 'autoplay']);
    expect(await values('match_method')).toEqual(['isrc', 'score', 'override']);
    expect(await values('match_warning')).toEqual(['low_confidence', 'explicit_conflict']);
    expect(await values('slot_readiness')).toEqual(['ready', 'catching_up', 'sitting_out']);
    expect(await values('import_batch_status')).toEqual([
      'previewing',
      'importing',
      'done',
      'undone',
      'failed',
    ]);
  });

  it('reject unknown providers', async () => {
    const user = await db.createUser();
    await rejectsWith(
      db.query(
        `insert into public.provider_connections (user_id, provider) values ($1, 'youtube_music')`,
        [user.id],
      ),
      '22P02',
    );
  });
});

describe('credentials', () => {
  it('provider_connections holds metadata only', async () => {
    const rows = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'provider_connections' order by ordinal_position`,
    );
    expect(rows.map((row) => row.column_name)).toEqual([
      'user_id',
      'provider',
      'connected_at',
      'last_verified_at',
      'storefront',
    ]);
  });

  it('no public column can hold a raw token or secret', async () => {
    const rows = await db.query<{ col: string }>(
      `select table_name || '.' || column_name as col from information_schema.columns
        where table_schema = 'public'
          and column_name ~ '(token|secret|password|credential|refresh|access)'`,
    );
    // Invites keep only a hash of their token.
    expect(rows.map((row) => row.col)).toEqual(['room_invites.token_hash']);
  });
});

describe('profiles', () => {
  it('are created empty for every new auth user', async () => {
    const user = await db.createUser({ profile: false });
    const [profile] = await db.query('select * from public.profiles where id = $1', [user.id]);
    expect(profile).toMatchObject({ display_name: null, color: null, adult_confirmed_at: null });
  });

  it('reject blank, padded or long names and bad colors', async () => {
    const user = await db.createUser({ profile: false });
    const set = (column: string, value: string) =>
      db.query(`update public.profiles set ${column} = $2 where id = $1`, [user.id, value]);
    await rejectsWith(set('display_name', ''), '23514');
    await rejectsWith(set('display_name', ' Maya'), '23514');
    await rejectsWith(set('display_name', 'x'.repeat(31)), '23514');
    await rejectsWith(set('color', 'red'), '23514');
    await set('display_name', 'x'.repeat(30));
    await set('color', '#a1B2c3');
  });

  it('stamp updated_at on change', async () => {
    const user = await db.createUser();
    await db.query(
      `update public.profiles set updated_at = now() - interval '1 day' where id = $1`,
      [user.id],
    );
    await db.query(`update public.profiles set display_name = 'Renamed' where id = $1`, [user.id]);
    const [row] = await db.query<{ fresh: boolean }>(
      `select updated_at > now() - interval '1 minute' as fresh from public.profiles where id = $1`,
      [user.id],
    );
    expect(row.fresh).toBe(true);
  });

  it('cascade from the auth user to profile, connections and memberships', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const guest = await db.createUser({ provider: 'apple_music' });
    const room = await insertRoom(host);
    await db.query(`insert into public.room_members (room_id, user_id) values ($1, $2)`, [
      room.id,
      guest.id,
    ]);
    await db.query('delete from auth.users where id = $1', [guest.id]);
    const counts = await db.query<{ n: number }>(
      `select (select count(*) from public.profiles where id = $1)
            + (select count(*) from public.provider_connections where user_id = $1)
            + (select count(*) from public.room_members where user_id = $1) as n`,
      [guest.id],
    );
    expect(Number(counts[0].n)).toBe(0);
  });
});

describe('rooms', () => {
  it('default to aux, everyone adds songs, only the host controls', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const room = await insertRoom(host);
    const [row] = await db.query('select * from public.rooms where id = $1', [room.id]);
    expect(row).toMatchObject({
      mode: 'aux',
      state: 'live',
      add_songs: 'everyone',
      control: 'host',
    });
  });

  it('require six uppercase characters for the code', async () => {
    const host = await db.createUser();
    await rejectsWith(insertRoom(host, { code: 'abc123' }), '23514');
    await rejectsWith(insertRoom(host, { code: 'ABC12' }), '23514');
    await rejectsWith(insertRoom(host, { code: 'ABC1234' }), '23514');
  });

  it('keep a code unique among rooms that have not ended', async () => {
    const host = await db.createUser();
    const room = await insertRoom(host, { code: 'DUPE23' });
    await rejectsWith(insertRoom(host, { code: 'DUPE23' }), '23505');
    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
      room.id,
    ]);
    await insertRoom(host, { code: 'DUPE23' });
  });

  it('keep ended_at in step with the ended state', async () => {
    const host = await db.createUser();
    const room = await insertRoom(host);
    await rejectsWith(
      db.query(`update public.rooms set state = 'ended' where id = $1`, [room.id]),
      '23514',
    );
    await rejectsWith(
      db.query(`update public.rooms set ended_at = now() where id = $1`, [room.id]),
      '23514',
    );
  });

  it('reject blank or long names', async () => {
    const host = await db.createUser();
    await rejectsWith(insertRoom(host, { name: '' }), '23514');
    await rejectsWith(insertRoom(host, { name: 'x'.repeat(41) }), '23514');
    await rejectsWith(insertRoom(host, { name: 'Padded ' }), '23514');
  });
});

describe('room_members', () => {
  it('allow one host per room', async () => {
    const host = await db.createUser();
    const other = await db.createUser();
    const room = await insertRoom(host);
    await rejectsWith(
      db.query(`insert into public.room_members (room_id, user_id, role) values ($1, $2, 'host')`, [
        room.id,
        other.id,
      ]),
      '23505',
    );
  });

  it('cap a room at 15 participants, the host included', async () => {
    const host = await db.createUser();
    const room = await insertRoom(host);
    for (let i = 0; i < 14; i += 1) {
      const member = await db.createUser();
      await db.query(`insert into public.room_members (room_id, user_id) values ($1, $2)`, [
        room.id,
        member.id,
      ]);
    }
    const [{ n }] = await db.query<{ n: number }>(
      'select count(*)::int as n from public.room_members where room_id = $1',
      [room.id],
    );
    expect(n).toBe(15);
    const sixteenth = await db.createUser();
    await expect(
      db.query(`insert into public.room_members (room_id, user_id) values ($1, $2)`, [
        room.id,
        sixteenth.id,
      ]),
    ).rejects.toMatchObject({ code: 'room_full', sqlstate: 'P0001' });
  });

  it('chosen people must be members and leave the list when they leave', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const outsider = await db.createUser();
    const room = await insertRoom(host);
    await db.query(`insert into public.room_members (room_id, user_id) values ($1, $2)`, [
      room.id,
      guest.id,
    ]);
    await db.query(
      `insert into public.room_rule_members (room_id, rule, user_id) values ($1, 'control', $2)`,
      [room.id, guest.id],
    );
    await rejectsWith(
      db.query(
        `insert into public.room_rule_members (room_id, rule, user_id) values ($1, 'control', $2)`,
        [room.id, outsider.id],
      ),
      '23503',
    );
    await db.query('delete from public.room_members where room_id = $1 and user_id = $2', [
      room.id,
      guest.id,
    ]);
    const rows = await db.query('select * from public.room_rule_members where room_id = $1', [
      room.id,
    ]);
    expect(rows).toEqual([]);
  });
});

describe('room_invites', () => {
  const hash = (byte: string) => Buffer.alloc(32, byte);

  it('keep one live invite per room and only 32-byte hashes', async () => {
    const host = await db.createUser();
    const room = await insertRoom(host);
    const insert = (tokenHash: Buffer) =>
      db.query(
        `insert into public.room_invites (room_id, token_hash, created_by, expires_at)
         values ($1, $2, $3, now() + interval '1 day') returning id`,
        [room.id, tokenHash, host.id],
      );
    const [first] = await insert(hash('a'));
    await rejectsWith(insert(hash('b')), '23505');
    await db.query('update public.room_invites set revoked_at = now() where id = $1', [
      (first as { id: string }).id,
    ]);
    await insert(hash('b'));
    await rejectsWith(insert(Buffer.alloc(16, 'c')), '23514');
  });
});

describe('catalog and matching', () => {
  it('validate ISRCs and durations', async () => {
    await insertRecording({ isrc: 'USRC17607839' });
    await rejectsWith(insertRecording({ isrc: 'not-an-isrc' }), '23514');
    await rejectsWith(insertRecording({ duration_ms: 0 }), '23514');
  });

  it('link matches to known provider tracks, or to nothing', async () => {
    const recordingId = await insertRecording();
    await db.query(
      `insert into public.provider_tracks (provider, provider_track_id, title, duration_ms)
       values ('spotify', 'sp-1', 'Rain Down', 200000)`,
    );
    await db.query(
      `insert into public.track_matches (recording_id, provider, provider_track_id, confidence, method)
       values ($1, 'spotify', 'sp-1', 95, 'score')`,
      [recordingId],
    );
    await db.query(
      `insert into public.track_matches (recording_id, provider, provider_track_id, confidence, method)
       values ($1, 'apple_music', null, 0, 'score')`,
      [recordingId],
    );
    const other = await insertRecording();
    await rejectsWith(
      db.query(
        `insert into public.track_matches (recording_id, provider, provider_track_id, confidence, method)
         values ($1, 'spotify', 'missing', 95, 'score')`,
        [other],
      ),
      '23503',
    );
    await rejectsWith(
      db.query(
        `insert into public.track_matches (recording_id, provider, provider_track_id, confidence, method)
         values ($1, 'apple_music', null, 101, 'score')`,
        [other],
      ),
      '23514',
    );
  });
});

describe('queue_entries', () => {
  it('allow one playing entry per room and keep entries when the adder leaves', async () => {
    const host = await db.createUser();
    const guest = await db.createUser();
    const room = await insertRoom(host);
    const recordingId = await insertRecording();
    const add = (status: string, position: number, by: string) =>
      db.query<{ id: string }>(
        `insert into public.queue_entries (room_id, recording_id, position, added_by, status)
         values ($1, $2, $3, $4, $5) returning id`,
        [room.id, recordingId, position, by, status],
      );
    await add('playing', 1, host.id);
    await rejectsWith(add('playing', 2, host.id), '23505');
    const [entry] = await add('queued', 2, guest.id);
    await db.query('delete from auth.users where id = $1', [guest.id]);
    const [row] = await db.query(
      'select added_by, status, batch_id from public.queue_entries where id = $1',
      [entry.id],
    );
    expect(row).toEqual({ added_by: null, status: 'queued', batch_id: null });
  });

  it('are batch-ready, with one running import per room', async () => {
    const host = await db.createUser();
    const room = await insertRoom(host);
    const recordingId = await insertRecording();
    const batch = (status: string) =>
      db.query<{ id: string }>(
        `insert into public.playlist_import_batches (room_id, created_by, provider, source_name, item_count, status)
         values ($1, $2, 'spotify', 'Road trip', 3, $3) returning id`,
        [room.id, host.id, status],
      );
    const [running] = await batch('importing');
    await rejectsWith(batch('importing'), '23505');
    await batch('done');
    await db.query(
      `insert into public.queue_entries (room_id, recording_id, position, added_by, batch_id)
       values ($1, $2, 10, $3, $4)`,
      [room.id, recordingId, host.id, running.id],
    );
    await rejectsWith(
      db.query(
        `insert into public.playlist_import_batches (room_id, provider, source_name, item_count)
         values ($1, 'spotify', 'Too many', 51)`,
        [room.id],
      ),
      '23514',
    );
  });
});

describe('playback', () => {
  it('slots run 1 to 15 and belong to members', async () => {
    const host = await db.createUser();
    const outsider = await db.createUser();
    const room = await insertRoom(host);
    const claim = (slot: number, user: string) =>
      db.query(
        `insert into public.playback_slots (room_id, slot, user_id, provider) values ($1, $2, $3, 'spotify')`,
        [room.id, slot, user],
      );
    await rejectsWith(claim(0, host.id), '23514');
    await rejectsWith(claim(16, host.id), '23514');
    await rejectsWith(claim(2, outsider.id), '23503');
    await claim(1, host.id);
    await rejectsWith(claim(2, host.id), '23505');
  });

  it('playback state defaults to stopped at zero', async () => {
    const host = await db.createUser();
    const room = await insertRoom(host);
    await db.query('insert into public.playback_states (room_id) values ($1)', [room.id]);
    const [row] = await db.query(
      'select status, position_ms, entry_id from public.playback_states where room_id = $1',
      [room.id],
    );
    expect(row).toEqual({ status: 'stopped', position_ms: 0, entry_id: null });
    await rejectsWith(
      db.query('update public.playback_states set position_ms = -1 where room_id = $1', [room.id]),
      '23514',
    );
  });
});

describe('moderation and analytics placeholders', () => {
  it('blocks reject blocking yourself', async () => {
    const user = await db.createUser();
    await rejectsWith(
      db.query('insert into public.blocks (blocker_id, blocked_id) values ($1, $1)', [user.id]),
      '23514',
    );
  });

  it('reports default to open', async () => {
    const user = await db.createUser();
    const [row] = await db.query<{ status: string }>(
      `insert into public.reports (reporter_id, reason) values ($1, 'spam') returning status`,
      [user.id],
    );
    expect(row.status).toBe('open');
  });

  it('analytics events take simple names and object properties', async () => {
    const id = randomUUID();
    await db.query(
      `insert into public.analytics_events (analytics_id, name) values ($1, 'room.created')`,
      [id],
    );
    await rejectsWith(
      db.query(
        `insert into public.analytics_events (analytics_id, name) values ($1, 'Room Created')`,
        [id],
      ),
      '23514',
    );
    await rejectsWith(
      db.query(
        `insert into public.analytics_events (analytics_id, name, properties) values ($1, 'a', '[]')`,
        [id],
      ),
      '23514',
    );
  });
});

describe('idempotency_keys', () => {
  it('are unique per user, operation and key, and expire after 24 hours', async () => {
    const user = await db.createUser();
    const key = randomUUID();
    const insert = () =>
      db.query(
        `insert into public.idempotency_keys (user_id, operation, idempotency_key, request_hash, result)
         values ($1, 'create_room', $2, '\\x00', '{}') returning expires_at - created_at as ttl`,
        [user.id, key],
      );
    const [row] = await insert();
    expect(row).toMatchObject({ ttl: expect.anything() });
    const [{ hours }] = await db.query<{ hours: number }>(
      `select extract(epoch from expires_at - created_at)::int / 3600 as hours
         from public.idempotency_keys where idempotency_key = $1`,
      [key],
    );
    expect(hours).toBe(24);
    await rejectsWith(insert(), '23505');
  });
});

describe('row level security', () => {
  it('hides a room from people who are not in it', async () => {
    const host = await db.createUser();
    const outsider = await db.createUser();
    const room = await insertRoom(host);
    const seen = await db
      .as(outsider)
      .query('select id from public.rooms where id = $1', [room.id]);
    expect(seen).toEqual([]);
  });
});
