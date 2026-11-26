/**
 * Saving the onboarding profile directly (Forge card "Save onboarding
 * profile to Supabase (live mode)"). The app updates its own `profiles` row
 * with PostgREST's `update … eq('id', me) select('id')`, which is the SQL
 * below. Row level security and the column grants must allow exactly
 * `display_name`, `color` and `adult_confirmed_at` on the caller's own row.
 */
import { randomUUID } from 'node:crypto';

import { createTestDb, type TestDb, type TestUser } from './harness/db';

let db: TestDb;
let me: TestUser;
let other: TestUser;

/** What services/profiles.ts sends for onboarding step 1. */
const SAVE = `update public.profiles
                 set display_name = $2, color = $3, adult_confirmed_at = $4
               where id = $1
           returning id`;

beforeAll(async () => {
  db = await createTestDb();
  me = await db.createUser({ profile: false });
  other = await db.createUser({ displayName: 'Other' });
});

afterAll(() => db.close());

const profileOf = async (user: TestUser) =>
  (
    await db.query<{ display_name: string | null; color: string | null; adult: boolean }>(
      `select display_name, color, adult_confirmed_at is not null as adult
         from public.profiles where id = $1`,
      [user.id],
    )
  )[0];

describe('saving onboarding step 1', () => {
  it('starts empty, so the profile is unfinished', async () => {
    expect(await profileOf(me)).toEqual({ display_name: null, color: null, adult: false });
  });

  it('writes the three fields on the caller’s own row and returns it', async () => {
    const rows = await db.as(me).query(SAVE, [me.id, 'Sam', '#8fb4f0', '2026-11-26T10:00:00Z']);
    expect(rows).toEqual([{ id: me.id }]);
    expect(await profileOf(me)).toEqual({ display_name: 'Sam', color: '#8fb4f0', adult: true });
  });

  it('reads back through the same RLS the app signs in with', async () => {
    const rows = await db
      .as(me)
      .query<{ display_name: string; color: string; adult_confirmed_at: string }>(
        'select display_name, color, adult_confirmed_at from public.profiles where id = $1',
        [me.id],
      );
    expect(rows).toEqual([expect.objectContaining({ display_name: 'Sam', color: '#8fb4f0' })]);
    expect(rows[0].adult_confirmed_at).not.toBeNull();
  });

  it('makes the profile count as finished for the RPCs', async () => {
    const fresh = await db.createUser({ profile: false, provider: 'spotify' });
    const start = () =>
      db.as(fresh).rpc('create_room', {
        name: 'Friday',
        playback_provider: 'spotify',
        idempotency_key: randomUUID(),
      });
    await expect(start()).rejects.toMatchObject({ code: 'profile_incomplete' });
    await db.as(fresh).query(SAVE, [fresh.id, 'Fresh', '#f2a27c', new Date().toISOString()]);
    await expect(start()).resolves.toMatchObject({ room_id: expect.any(String) });
  });

  it('a Settings change writes only the name, or only the color', async () => {
    await db
      .as(me)
      .query('update public.profiles set display_name = $2 where id = $1 returning id', [
        me.id,
        'Sammy',
      ]);
    await db
      .as(me)
      .query('update public.profiles set color = $2 where id = $1 returning id', [
        me.id,
        '#e8c547',
      ]);
    expect(await profileOf(me)).toEqual({ display_name: 'Sammy', color: '#e8c547', adult: true });
  });
});

describe('what the database refuses', () => {
  it('another person’s row: nothing matches, nothing changes', async () => {
    const rows = await db
      .as(me)
      .query(SAVE, [other.id, 'Hacked', '#000000', new Date().toISOString()]);
    expect(rows).toEqual([]);
    expect(await profileOf(other)).toEqual({
      display_name: 'Other',
      color: '#5B8DEF',
      adult: true,
    });
  });

  it('every row at once still touches only the caller’s', async () => {
    const rows = await db
      .as(me)
      .query<{ id: string }>(`update public.profiles set color = '#8fe0b8' returning id`);
    expect(rows.map((row) => row.id)).toEqual([me.id]);
    expect((await profileOf(other)).color).toBe('#5B8DEF');
  });

  it.each(['id', 'created_at', 'updated_at'])('any column but the three (%s)', async (column) => {
    const value = column === 'id' ? `'${randomUUID()}'` : 'now()';
    await expect(
      db.as(me).query(`update public.profiles set ${column} = ${value} where id = $1`, [me.id]),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('inserting or deleting a profile', async () => {
    await expect(
      db
        .as(me)
        .query(`insert into public.profiles (id, display_name) values ($1, 'Twin')`, [
          randomUUID(),
        ]),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(
      db.as(me).query('delete from public.profiles where id = $1', [me.id]),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it.each([
    ['a name over 30 characters', 'a'.repeat(31), '#8fb4f0'],
    ['an untrimmed name', ' Sam ', '#8fb4f0'],
    ['an empty name', '', '#8fb4f0'],
    ['a color that isn’t a hex color', 'Sam', 'red'],
    ['a short hex color', 'Sam', '#fff'],
  ])('%s (check constraint)', async (_label, name, color) => {
    await expect(
      db.as(me).query(SAVE, [me.id, name, color, new Date().toISOString()]),
    ).rejects.toMatchObject({ sqlstate: '23514' });
  });

  it('counts characters like the app: 30 emoji fit', async () => {
    const rows = await db
      .as(me)
      .query(SAVE, [me.id, '🎧'.repeat(30), '#8fb4f0', new Date().toISOString()]);
    expect(rows).toEqual([{ id: me.id }]);
    await db.as(me).query(SAVE, [me.id, 'Sam', '#8fb4f0', new Date().toISOString()]);
  });

  it('anon: no read and no write', async () => {
    await expect(
      db.asAnon().query('select display_name from public.profiles'),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(
      db.asAnon().query(SAVE, [me.id, 'Anon', '#8fb4f0', new Date().toISOString()]),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    expect((await profileOf(me)).display_name).toBe('Sam');
  });

  it('the grant is exactly the three onboarding columns', async () => {
    const rows = await db.query<{ column_name: string }>(
      `select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'profiles'
          and grantee = 'authenticated' and privilege_type = 'UPDATE'
        order by column_name`,
    );
    expect(rows.map((row) => row.column_name)).toEqual([
      'adult_confirmed_at',
      'color',
      'display_name',
    ]);
  });
});
