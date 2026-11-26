/**
 * Recording real provider connections (Forge card "Record real provider
 * connections in provider_connections"). The app writes its own rows with
 * the statements below (services/providerConnections.ts, as PostgREST runs
 * them), and `create_room` trusts them. Row level security must keep each
 * person to their own rows, and no column may hold a credential.
 */
import { randomUUID } from 'node:crypto';

import { createTestDb, type TestDb, type TestUser } from './harness/db';

let db: TestDb;
let me: TestUser;
let other: TestUser;

/** recordProviderConnection: the insert, then the update when the row exists. */
const INSERT = `insert into public.provider_connections (user_id, provider, last_verified_at)
                values ($1, $2, $3)`;
const INSERT_WITH_STOREFRONT = `insert into public.provider_connections
                                  (user_id, provider, last_verified_at, storefront)
                                values ($1, $2, $3, $4)`;
const UPDATE = `update public.provider_connections set last_verified_at = $3
                 where user_id = $1 and provider = $2 returning provider`;
/** removeProviderConnection. */
const DELETE = `delete from public.provider_connections where user_id = $1 and provider = $2`;

beforeAll(async () => {
  db = await createTestDb();
  me = await db.createUser();
  other = await db.createUser({ provider: 'spotify' });
});

afterAll(() => db.close());

const rowsOf = async (user: TestUser) =>
  db.query<{ provider: string; connected: boolean; checked: boolean; storefront: string | null }>(
    `select provider, connected_at is not null as connected,
            last_verified_at is not null as checked, storefront
       from public.provider_connections where user_id = $1 order by provider`,
    [user.id],
  );

const startRoom = (user: TestUser, provider = 'spotify') =>
  db.as(user).rpc('create_room', {
    name: 'Friday',
    playback_provider: provider,
    idempotency_key: randomUUID(),
  });

describe('recording a real connection', () => {
  it('without a row, create_room says provider_required', async () => {
    await expect(startRoom(me)).rejects.toMatchObject({
      code: 'provider_required',
      details: { provider: 'spotify' },
    });
  });

  it('the insert writes the caller’s row; the database sets connected_at', async () => {
    await db.as(me).query(INSERT, [me.id, 'spotify', new Date().toISOString()]);
    expect(await rowsOf(me)).toEqual([
      { provider: 'spotify', connected: true, checked: true, storefront: null },
    ]);
  });

  it('with the row, create_room starts a room through that service', async () => {
    await expect(startRoom(me)).resolves.toMatchObject({ room_id: expect.any(String) });
  });

  it('a second insert hits the primary key (23505), and the update refreshes the row', async () => {
    await expect(
      db.as(me).query(INSERT, [me.id, 'spotify', new Date().toISOString()]),
    ).rejects.toMatchObject({ sqlstate: '23505' });
    const updated = await db.as(me).query(UPDATE, [me.id, 'spotify', '2026-11-26T10:00:00Z']);
    expect(updated).toEqual([{ provider: 'spotify' }]);
  });

  it('a storefront is stored when it’s a two-letter market, refused otherwise', async () => {
    await db
      .as(me)
      .query(INSERT_WITH_STOREFRONT, [me.id, 'apple_music', new Date().toISOString(), 'us']);
    expect((await rowsOf(me)).find((row) => row.provider === 'apple_music')).toMatchObject({
      storefront: 'us',
    });
    await db.as(me).query(DELETE, [me.id, 'apple_music']);
    await expect(
      db
        .as(me)
        .query(INSERT_WITH_STOREFRONT, [me.id, 'apple_music', new Date().toISOString(), 'USA']),
    ).rejects.toMatchObject({ sqlstate: '23514' });
  });

  it('only Apple Music and Spotify can be recorded', async () => {
    await expect(
      db.as(me).query(INSERT, [me.id, 'tidal', new Date().toISOString()]),
    ).rejects.toMatchObject({ sqlstate: '22P02' });
  });
});

describe('what the database refuses', () => {
  it('a row for someone else', async () => {
    await expect(
      db.as(me).query(INSERT, [other.id, 'apple_music', new Date().toISOString()]),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('updating or deleting someone else’s row matches nothing', async () => {
    expect(await db.as(me).query(UPDATE, [other.id, 'spotify', new Date().toISOString()])).toEqual(
      [],
    );
    expect(await db.as(me).query(`${DELETE} returning provider`, [other.id, 'spotify'])).toEqual(
      [],
    );
    expect(await rowsOf(other)).toEqual([
      { provider: 'spotify', connected: true, checked: false, storefront: null },
    ]);
  });

  it('reading someone else’s rows shows nothing', async () => {
    const seen = await db
      .as(me)
      .query<{ user_id: string }>('select user_id from public.provider_connections');
    expect(new Set(seen.map((row) => row.user_id))).toEqual(new Set([me.id]));
  });

  it.each([
    ['connected_at', 'now()'],
    ['user_id', '$3'],
    ['provider', `'apple_music'`],
  ])('changing %s', async (column, value) => {
    const params: unknown[] = [me.id, 'spotify'];
    if (value === '$3') params.push(other.id);
    await expect(
      db.as(me).query(
        `update public.provider_connections set ${column} = ${value}
            where user_id = $1 and provider = $2`,
        params,
      ),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('inserting connected_at yourself', async () => {
    const fresh = await db.createUser();
    await expect(
      db.as(fresh).query(
        `insert into public.provider_connections (user_id, provider, connected_at)
           values ($1, 'spotify', now() - interval '1 year')`,
        [fresh.id],
      ),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('anon: no read and no write', async () => {
    await expect(
      db.asAnon().query('select * from public.provider_connections'),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(
      db.asAnon().query(INSERT, [me.id, 'apple_music', new Date().toISOString()]),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(db.asAnon().query(DELETE, [me.id, 'spotify'])).rejects.toMatchObject({
      sqlstate: '42501',
    });
  });
});

describe('no credentials', () => {
  it('the table has metadata columns only', async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'provider_connections'
        order by ordinal_position`,
    );
    expect(columns.map((row) => row.column_name)).toEqual([
      'user_id',
      'provider',
      'connected_at',
      'last_verified_at',
      'storefront',
    ]);
  });

  it('no column is named like a token, secret, password or credential', async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'provider_connections'`,
    );
    expect(
      columns
        .map((row) => row.column_name)
        .filter((name) => /token|secret|password|credential|refresh|access|key|code/i.test(name)),
    ).toEqual([]);
  });

  it('the client grants are exactly the ones the app uses', async () => {
    const grants = await db.query<{ privilege_type: string; column_name: string }>(
      `select privilege_type, column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'provider_connections'
          and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
        order by privilege_type, column_name`,
    );
    expect(grants.map((row) => `${row.privilege_type} ${row.column_name}`)).toEqual([
      'INSERT last_verified_at',
      'INSERT provider',
      'INSERT storefront',
      'INSERT user_id',
      'UPDATE last_verified_at',
      'UPDATE storefront',
    ]);
  });
});

describe('disconnecting', () => {
  it('deletes the caller’s row, and create_room needs a service again', async () => {
    await db.as(me).query(DELETE, [me.id, 'spotify']);
    expect(await rowsOf(me)).toEqual([]);
    await expect(startRoom(me)).rejects.toMatchObject({ code: 'provider_required' });
  });

  it('deleting a row that isn’t there is not an error', async () => {
    await expect(db.as(me).query(DELETE, [me.id, 'spotify'])).resolves.toEqual([]);
  });
});
