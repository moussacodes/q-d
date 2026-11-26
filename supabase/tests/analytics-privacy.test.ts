/**
 * Logs and analytics privacy check, database side (Forge card). Analytics is
 * off and opt-in (src/services/flags.ts `analyticsAllowed`), and nothing
 * emits events for the demo: `analytics_events` is a placeholder no client
 * or database function writes. These guards fail if that changes without a
 * review of what an event may hold.
 */
import { createTestDb, type TestDb, type TestUser } from './harness/db';

let db: TestDb;
let user: TestUser;

beforeAll(async () => {
  db = await createTestDb();
  user = await db.createUser({ provider: 'spotify' });
});

afterAll(() => db.close());

describe('analytics_events', () => {
  it('holds no user id, provider, song or room column', async () => {
    const rows = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'analytics_events' order by ordinal_position`,
    );
    expect(rows.map((row) => row.column_name)).toEqual([
      'id',
      'analytics_id',
      'name',
      'properties',
      'occurred_at',
    ]);
  });

  it('no database function or trigger writes it', async () => {
    const rows = await db.query<{ name: string }>(
      `select n.nspname || '.' || p.proname as name from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosrc ilike '%analytics_events%'`,
    );
    expect(rows).toEqual([]);
  });

  it('signed-in users cannot write or read it directly', async () => {
    await expect(
      db.as(user).query(
        `insert into public.analytics_events (analytics_id, name, properties)
           values (gen_random_uuid(), 'song.added', '{"title":"Rain Down"}')`,
      ),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(db.as(user).query('select * from public.analytics_events')).rejects.toMatchObject({
      sqlstate: '42501',
    });
  });

  it('is empty after the migrations: nothing is collected yet', async () => {
    const [row] = await db.query<{ n: number }>(
      'select count(*)::int as n from public.analytics_events',
    );
    expect(row.n).toBe(0);
  });
});
