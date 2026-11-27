/**
 * create_room: a signed-in host with a finished profile and a connected
 * service starts an aux room. API_CONTRACTS.md § create_room.
 */
import { createTestDb, newKey, type TestDb, type TestUser } from './harness/db';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => db.close());

type Created = { room_id: string; code: string; code_expires_at: string };

const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

const create = (user: TestUser, args: Record<string, unknown> = {}) =>
  db.as(user).rpc<Created>('create_room', {
    name: 'Friday',
    playback_provider: 'spotify',
    idempotency_key: newKey(),
    ...args,
  });

const roomCount = async (user: TestUser) =>
  (
    await db.query<{ n: number }>(
      'select count(*)::int as n from public.rooms where host_id = $1',
      [user.id],
    )
  )[0].n;

describe('create_room', () => {
  it('creates a live aux room with the default rules and the caller as host', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const result = await create(host);

    expect(Object.keys(result).sort()).toEqual(['code', 'code_expires_at', 'room_id']);
    expect(result.code).toMatch(CODE);

    const [room] = await db.query('select * from public.rooms where id = $1', [result.room_id]);
    expect(room).toMatchObject({
      name: 'Friday',
      host_id: host.id,
      mode: 'aux',
      state: 'live',
      playback_provider: 'spotify',
      code: result.code,
      add_songs: 'everyone',
      control: 'host',
      ended_at: null,
    });

    const members = await db.query(
      'select user_id, role from public.room_members where room_id = $1',
      [result.room_id],
    );
    expect(members).toEqual([{ user_id: host.id, role: 'host' }]);
    expect(
      await db.query('select * from public.room_rule_members where room_id = $1', [result.room_id]),
    ).toEqual([]);

    const [playback] = await db.query(
      'select status, entry_id, position_ms from public.playback_states where room_id = $1',
      [result.room_id],
    );
    expect(playback).toEqual({ status: 'stopped', entry_id: null, position_ms: 0 });
  });

  it('gives the code a 24-hour expiry', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const result = await create(host);
    const hours = (new Date(result.code_expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
  });

  it('lets the host read the new room straight away through RLS', async () => {
    const host = await db.createUser({ provider: 'apple_music' });
    const result = await create(host, { playback_provider: 'apple_music' });
    const rows = await db.as(host).query('select id, playback_provider from public.rooms');
    expect(rows).toEqual([{ id: result.room_id, playback_provider: 'apple_music' }]);
  });

  it('keeps the rules the host chose', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const result = await create(host, { add_songs: 'chosen', control: 'everyone' });
    const [room] = await db.query('select add_songs, control from public.rooms where id = $1', [
      result.room_id,
    ]);
    expect(room).toEqual({ add_songs: 'chosen', control: 'everyone' });
  });

  it('trims the name', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const result = await create(host, { name: '  Late Drive Home  ' });
    const [room] = await db.query('select name from public.rooms where id = $1', [result.room_id]);
    expect(room).toEqual({ name: 'Late Drive Home' });
  });

  it('trims tabs, newlines and Unicode spaces too, and keeps inner whitespace', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const result = await create(host, { name: '\t\u00a0Friday\u00a0night \u3000\n' });
    const [room] = await db.query('select name from public.rooms where id = $1', [result.room_id]);
    expect(room).toEqual({ name: 'Friday\u00a0night' });
  });

  it('counts the 40-character limit after trimming', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const result = await create(host, { name: `\n  ${'x'.repeat(40)}\t ` });
    const [room] = await db.query('select name from public.rooms where id = $1', [result.room_id]);
    expect(room).toEqual({ name: 'x'.repeat(40) });
  });

  it('sends no realtime broadcast: nobody listens to a room that did not exist', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const { room_id: roomId } = await create(host);
    expect(await db.broadcasts(roomId)).toEqual([]);
  });

  it('is a security definer with a pinned search_path', async () => {
    const [fn] = await db.query<{ definer: boolean; config: string[] }>(
      `select p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'create_room'`,
    );
    expect(fn.definer).toBe(true);
    expect(fn.config).toContain('search_path=""');
  });

  it('lets one host run several rooms, each with its own code', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const a = await create(host);
    const b = await create(host);
    expect(a.room_id).not.toBe(b.room_id);
    expect(a.code).not.toBe(b.code);
    expect(await roomCount(host)).toBe(2);
  });

  it('starts with one participant and room for 14 more (15 in all)', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const { room_id: roomId } = await create(host);
    for (let i = 0; i < 14; i += 1) {
      const guest = await db.createUser();
      await db.query('insert into public.room_members (room_id, user_id) values ($1, $2)', [
        roomId,
        guest.id,
      ]);
    }
    const late = await db.createUser();
    await expect(
      db.query('insert into public.room_members (room_id, user_id) values ($1, $2)', [
        roomId,
        late.id,
      ]),
    ).rejects.toMatchObject({ code: 'room_full' });
  });
});

describe('create_room errors', () => {
  it('needs a signed-in user', async () => {
    await expect(
      db.asServiceRole().rpc('create_room', {
        name: 'Friday',
        playback_provider: 'spotify',
        idempotency_key: newKey(),
      }),
    ).rejects.toMatchObject({ code: 'not_authenticated' });
  });

  it('is not callable by anon', async () => {
    await expect(
      db.asAnon().rpc('create_room', {
        name: 'Friday',
        playback_provider: 'spotify',
        idempotency_key: newKey(),
      }),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('needs a finished profile', async () => {
    const host = await db.createUser({ profile: false, provider: 'spotify' });
    await expect(create(host)).rejects.toMatchObject({ code: 'profile_incomplete' });
    expect(await roomCount(host)).toBe(0);
  });

  it('needs a connected music service to host', async () => {
    const host = await db.createUser();
    await expect(create(host)).rejects.toMatchObject({
      code: 'provider_required',
      details: { provider: 'spotify' },
    });
  });

  it('needs the service the room plays through, not just any service', async () => {
    const host = await db.createUser({ provider: 'apple_music' });
    await expect(create(host, { playback_provider: 'spotify' })).rejects.toMatchObject({
      code: 'provider_required',
    });
    await expect(create(host, { playback_provider: 'apple_music' })).resolves.toMatchObject({
      code: expect.stringMatching(CODE),
    });
  });

  it('rejects sync while the sync flag is off', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    await expect(create(host, { mode: 'sync' })).rejects.toMatchObject({
      code: 'feature_disabled',
      details: { flag: 'sync' },
    });
    expect(await roomCount(host)).toBe(0);
  });

  it('rejects providers other than Apple Music and Spotify', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    await expect(create(host, { playback_provider: 'youtube_music' })).rejects.toMatchObject({
      sqlstate: '22P02',
    });
  });

  it.each([
    ['a blank name', { name: '   ' }, 'name'],
    ['an empty name', { name: '' }, 'name'],
    ['a missing name', { name: null }, 'name'],
    ['a name over 40 characters', { name: 'x'.repeat(41) }, 'name'],
    ['a name of tabs and newlines', { name: '\t\n\r ' }, 'name'],
    ['a name of no-break spaces', { name: '\u00a0\u00a0' }, 'name'],
    ['a name of ideographic spaces and a BOM', { name: '\u3000\ufeff' }, 'name'],
    ['a name over 40 characters after trimming', { name: ` ${'x'.repeat(41)} ` }, 'name'],

    ['a missing service', { playback_provider: null }, 'playback_provider'],
    ['a missing add-songs rule', { add_songs: null }, 'add_songs'],
    ['a missing control rule', { control: null }, 'control'],
    ['a missing mode', { mode: null }, 'mode'],
    ['a missing idempotency key', { idempotency_key: null }, 'idempotency_key'],
  ])('rejects %s', async (_label, args, field) => {
    const host = await db.createUser({ provider: 'spotify' });
    await expect(create(host, args)).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field },
    });
    expect(await roomCount(host)).toBe(0);
  });

  it('rejects a mode that is neither aux nor sync before doing anything', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    await expect(create(host, { mode: 'party' })).rejects.toMatchObject({ sqlstate: '22P02' });
    expect(await roomCount(host)).toBe(0);
  });

  it('checks the profile before the mode, so sync never hints at a flag to an unfinished profile', async () => {
    const host = await db.createUser({ provider: 'spotify', profile: false });
    await expect(create(host, { mode: 'sync' })).rejects.toMatchObject({
      code: 'profile_incomplete',
    });
  });

  it('accepts a 40-character name', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    await expect(create(host, { name: 'x'.repeat(40) })).resolves.toMatchObject({
      room_id: expect.any(String),
    });
  });
});

describe('create_room idempotency', () => {
  it('a retry with the same key returns the same room and creates nothing new', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const key = newKey();
    const first = await create(host, { idempotency_key: key });
    const second = await create(host, { idempotency_key: key });
    const third = await create(host, { idempotency_key: key });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(await roomCount(host)).toBe(1);
  });

  it('the same key with different arguments fails with idempotency_conflict', async () => {
    const host = await db.createUser({ provider: ['spotify', 'apple_music'] });
    const key = newKey();
    await create(host, { idempotency_key: key });
    await expect(create(host, { idempotency_key: key, name: 'Saturday' })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    await expect(
      create(host, { idempotency_key: key, playback_provider: 'apple_music' }),
    ).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    await expect(create(host, { idempotency_key: key, add_songs: 'host' })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(await roomCount(host)).toBe(1);
  });

  it('a rejected call can be retried with the same key once the cause is fixed', async () => {
    const host = await db.createUser();
    const key = newKey();
    await expect(create(host, { idempotency_key: key })).rejects.toMatchObject({
      code: 'provider_required',
    });
    await db.query(
      `insert into public.provider_connections (user_id, provider) values ($1, 'spotify')`,
      [host.id],
    );
    const result = await create(host, { idempotency_key: key });
    expect(result.code).toMatch(CODE);
    expect(await roomCount(host)).toBe(1);
  });

  it('replays even after the profile or connection changed', async () => {
    const host = await db.createUser({ provider: 'spotify' });
    const key = newKey();
    const first = await create(host, { idempotency_key: key });
    await db.query('delete from public.provider_connections where user_id = $1', [host.id]);
    await expect(create(host, { idempotency_key: key })).resolves.toEqual(first);
  });

  it('two users may use the same key independently', async () => {
    const a = await db.createUser({ provider: 'spotify' });
    const b = await db.createUser({ provider: 'spotify' });
    const key = newKey();
    const roomA = await create(a, { idempotency_key: key });
    const roomB = await create(b, { idempotency_key: key });
    expect(roomA.room_id).not.toBe(roomB.room_id);
  });
});

describe('room codes', () => {
  it('use only unambiguous characters', async () => {
    const rows = await db.query<{ code: string }>(
      'select private.generate_room_code() as code from generate_series(1, 500)',
    );
    const codes = rows.map((row) => row.code);
    for (const code of codes) expect(code).toMatch(CODE);
    expect(codes.join('')).not.toMatch(/[01IO]/);
    expect(new Set(codes).size).toBeGreaterThan(495);
  });

  describe('with a code generator that collides', () => {
    let original: string;

    beforeAll(async () => {
      [{ def: original }] = await db.query<{ def: string }>(
        `select pg_get_functiondef('private.generate_room_code()'::regprocedure) as def`,
      );
      await db.exec(`
        -- A sequence, because create_room rolls back each failed attempt.
        create sequence private.test_draws;
      `);
    });

    afterAll(async () => {
      await db.exec(original);
    });

    const useGenerator = (body: string) =>
      db.exec(`
        create or replace function private.generate_room_code() returns text
        language plpgsql volatile set search_path = '' as $$
        declare draw integer;
        begin
          draw := nextval('private.test_draws');
          ${body}
        end;
        $$;
      `);

    it('retries until it finds a free code', async () => {
      const host = await db.createUser({ provider: 'spotify' });
      await useGenerator(`return 'TAKEN2';`);
      const first = await create(host);
      expect(first.code).toBe('TAKEN2');
      // The next two draws collide with TAKEN2, the third is free.
      await db.query('alter sequence private.test_draws restart');
      await useGenerator(`if draw <= 2 then return 'TAKEN2'; end if; return 'FREE23';`);
      const second = await create(host);
      expect(second.code).toBe('FREE23');
    });

    it('reuses the code of a room that has ended', async () => {
      const host = await db.createUser({ provider: 'spotify' });
      await useGenerator(`return 'REUSE2';`);
      const first = await create(host);
      await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
        first.room_id,
      ]);
      const second = await create(host);
      expect(second.code).toBe('REUSE2');
    });

    it('draws exactly ten codes before giving up, and the key stays free', async () => {
      const host = await db.createUser({ provider: 'spotify' });
      await useGenerator(`return 'STUCK3';`);
      await create(host);
      await db.query('alter sequence private.test_draws restart');
      const key = newKey();
      await expect(create(host, { idempotency_key: key })).rejects.toMatchObject({
        code: 'could not generate a unique room code',
      });
      const [{ draws }] = await db.query<{ draws: number }>(
        'select last_value::int as draws from private.test_draws',
      );
      expect(draws).toBe(10);
      expect(
        await db.query('select 1 from public.idempotency_keys where idempotency_key = $1', [key]),
      ).toEqual([]);
      // Once codes are free again, the same key succeeds.
      await useGenerator(`return 'FREE34';`);
      await expect(create(host, { idempotency_key: key })).resolves.toMatchObject({
        code: 'FREE34',
      });
    });

    it('gives up after ten collisions without creating anything', async () => {
      const host = await db.createUser({ provider: 'spotify' });
      await useGenerator(`return 'STUCK2';`);
      await create(host);
      await expect(create(host)).rejects.toMatchObject({
        code: 'could not generate a unique room code',
      });
      expect(await roomCount(host)).toBe(1);
    });
  });
});
