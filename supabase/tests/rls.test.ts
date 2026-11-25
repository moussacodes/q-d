/**
 * Row level security. Clients only read; every write goes through an RPC.
 *
 * The RLS card fills in the read policies and the per-role tests (host,
 * member, outsider, anon). The checks here hold from the first migration on.
 */
import { createTestDb, type TestDb } from './harness/db';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => db.close());

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
];

describe('direct writes', () => {
  it.each(ROOM_TABLES)('signed-in users cannot delete or update %s', async (table) => {
    const user = await db.createUser();
    // RLS hides every row, so these touch nothing instead of failing.
    const deleted = await db.as(user).query(`delete from public.${table} returning 1`);
    const column = table === 'rooms' ? 'id' : 'room_id';
    const updated = await db
      .as(user)
      .query(`update public.${table} set ${column} = ${column} returning 1`);
    expect(deleted).toEqual([]);
    expect(updated).toEqual([]);
  });

  it('signed-in users cannot insert a room', async () => {
    const user = await db.createUser({ provider: 'spotify' });
    await expect(
      db.as(user).query(
        `insert into public.rooms (name, host_id, playback_provider, code, code_expires_at)
         values ('Mine', $1, 'spotify', 'ABCDEF', now() + interval '1 day')`,
        [user.id],
      ),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('anon cannot read idempotency keys', async () => {
    expect(await db.asAnon().query('select * from public.idempotency_keys')).toEqual([]);
  });

  it.todo('members read their room, its members, queue and playback state (RLS card)');
  it.todo('outsiders and anon read nothing of a room (RLS card)');
});
