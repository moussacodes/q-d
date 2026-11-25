/**
 * RPC contracts: the error convention, the idempotency machinery, the shared
 * checks and the broadcast helper, exercised through small test RPCs written
 * exactly like a real one (security definer, checks in the contract's order).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestDb, newKey, type TestDb, type TestUser } from './harness/db';

let db: TestDb;

// A test-only RPC in the real pattern: sign-in, idempotency replay, checks,
// effect, store. Its effect is a row per call, so replays are countable.
const TEST_RPCS = `
  create table public.test_effects (
    id bigint generated always as identity primary key,
    user_id uuid not null,
    amount integer not null
  );

  create function public.test_add(amount integer, idempotency_key uuid) returns jsonb
  language plpgsql security definer
  set search_path = ''
  as $$
  declare
    request jsonb := jsonb_build_object('amount', amount);
    stored jsonb;
    new_id bigint;
  begin
    perform private.require_user();
    stored := private.idempotency_replay('test_add', idempotency_key, request);
    if stored is not null then
      return stored;
    end if;
    if amount < 0 then
      perform private.raise_error('invalid_input', jsonb_build_object('field', 'amount'));
    end if;
    insert into public.test_effects (user_id, amount) values (auth.uid(), amount) returning id into new_id;
    return private.idempotency_store('test_add', idempotency_key, request,
      jsonb_build_object('effect_id', new_id, 'amount', amount));
  end;
  $$;

  create function public.test_room_action(room_id uuid, rule public.room_rule, host_only boolean)
  returns text
  language plpgsql security definer
  set search_path = ''
  as $$
  declare
    uid uuid := private.require_user();
    room public.rooms := private.lock_room(room_id);
  begin
    if host_only then
      perform private.require_host(room.id, uid);
    else
      perform private.require_allowed(room, uid, rule);
    end if;
    perform private.broadcast_room_event(room.id, 'queue.changed');
    return 'ok';
  end;
  $$;

  create function public.test_raise(code text, details jsonb) returns void
  language plpgsql security definer
  set search_path = ''
  as $$
  begin
    perform private.raise_error(code, details);
  end;
  $$;
`;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(TEST_RPCS);
});

afterAll(() => db.close());

async function insertRoom(host: TestUser, overrides: Record<string, string> = {}) {
  const [room] = await db.query<{ id: string }>(
    `insert into public.rooms (name, host_id, playback_provider, code, code_expires_at, add_songs, control)
     values ('Friday', $1, 'spotify', upper(substr(md5(random()::text), 1, 6)), now() + interval '1 day',
             coalesce($2, 'everyone')::public.room_audience, coalesce($3, 'host')::public.room_audience)
     returning id`,
    [host.id, overrides.add_songs ?? null, overrides.control ?? null],
  );
  await db.query(
    `insert into public.room_members (room_id, user_id, role) values ($1, $2, 'host')`,
    [room.id, host.id],
  );
  return room;
}

const addMember = (roomId: string, user: TestUser) =>
  db.query(`insert into public.room_members (room_id, user_id) values ($1, $2)`, [roomId, user.id]);

const effectCount = async (user: TestUser) =>
  (
    await db.query<{ n: number }>(
      'select count(*)::int as n from public.test_effects where user_id = $1',
      [user.id],
    )
  )[0].n;

describe('error codes', () => {
  it('match the table in docs/API_CONTRACTS.md §2', async () => {
    const doc = readFileSync(join(__dirname, '..', '..', 'docs', 'API_CONTRACTS.md'), 'utf8');
    const section = doc.slice(doc.indexOf('## 2. Error codes'), doc.indexOf('## 3. RPC functions'));
    const documented = [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]);
    const [{ codes }] = await db.query<{ codes: string[] }>(
      'select private.error_codes() as codes',
    );
    expect([...codes].sort()).toEqual([...documented].sort());
  });

  it('raise P0001 with the code as message, details as JSON and the qd hint', async () => {
    const user = await db.createUser();
    const err = await db
      .as(user)
      .rpc('test_raise', { code: 'rate_limited', details: { retry_after_seconds: 30 } })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'rate_limited',
      sqlstate: 'P0001',
      hint: 'qd',
      details: { retry_after_seconds: 30 },
    });
  });

  it('refuse codes that are not in the contract', async () => {
    const user = await db.createUser();
    await expect(
      db.as(user).rpc('test_raise', { code: 'oops', details: null }),
    ).rejects.toMatchObject({
      code: expect.stringContaining('unknown q’d error code'),
    });
  });
});

describe('idempotency', () => {
  it('requires sign-in', async () => {
    await expect(
      db.asAnon().rpc('test_add', { amount: 1, idempotency_key: newKey() }),
    ).rejects.toMatchObject({
      code: 'not_authenticated',
    });
  });

  it('requires a key', async () => {
    const user = await db.createUser();
    await expect(
      db.as(user).rpc('test_add', { amount: 1, idempotency_key: null }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'idempotency_key' },
    });
  });

  it('a replay returns the stored result without repeating the effect', async () => {
    const user = await db.createUser();
    const key = newKey();
    const first = await db.as(user).rpc('test_add', { amount: 5, idempotency_key: key });
    const second = await db.as(user).rpc('test_add', { amount: 5, idempotency_key: key });
    const third = await db.as(user).rpc('test_add', { amount: 5, idempotency_key: key });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(await effectCount(user)).toBe(1);
  });

  it('the same key with different arguments fails with idempotency_conflict', async () => {
    const user = await db.createUser();
    const key = newKey();
    await db.as(user).rpc('test_add', { amount: 5, idempotency_key: key });
    await expect(
      db.as(user).rpc('test_add', { amount: 6, idempotency_key: key }),
    ).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(await effectCount(user)).toBe(1);
  });

  it('new keys repeat the effect', async () => {
    const user = await db.createUser();
    await db.as(user).rpc('test_add', { amount: 1, idempotency_key: newKey() });
    await db.as(user).rpc('test_add', { amount: 1, idempotency_key: newKey() });
    expect(await effectCount(user)).toBe(2);
  });

  it('keys belong to one user', async () => {
    const alice = await db.createUser();
    const bob = await db.createUser();
    const key = newKey();
    await db.as(alice).rpc('test_add', { amount: 1, idempotency_key: key });
    // Bob's call with the same key and different arguments is his own, not a conflict.
    await db.as(bob).rpc('test_add', { amount: 2, idempotency_key: key });
    expect(await effectCount(alice)).toBe(1);
    expect(await effectCount(bob)).toBe(1);
  });

  it('only successes are stored, so a rejected call can be retried with the same key', async () => {
    const user = await db.createUser();
    const key = newKey();
    await expect(
      db.as(user).rpc('test_add', { amount: -1, idempotency_key: key }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
    const [{ n }] = await db.query<{ n: number }>(
      'select count(*)::int as n from public.idempotency_keys where idempotency_key = $1',
      [key],
    );
    expect(n).toBe(0);
    // Different arguments are fine too: nothing was stored for the failed call.
    await db.as(user).rpc('test_add', { amount: 3, idempotency_key: key });
    expect(await effectCount(user)).toBe(1);
  });

  it('an expired key runs again as new', async () => {
    const user = await db.createUser();
    const key = newKey();
    await db.as(user).rpc('test_add', { amount: 1, idempotency_key: key });
    await db.query(
      `update public.idempotency_keys set expires_at = now() - interval '1 second' where idempotency_key = $1`,
      [key],
    );
    await db.as(user).rpc('test_add', { amount: 1, idempotency_key: key });
    expect(await effectCount(user)).toBe(2);
  });

  it('expired keys can be purged', async () => {
    const user = await db.createUser();
    const key = newKey();
    await db.as(user).rpc('test_add', { amount: 1, idempotency_key: key });
    await db.query(
      `update public.idempotency_keys set expires_at = now() - interval '1 second' where idempotency_key = $1`,
      [key],
    );
    const [{ purged }] = await db.query<{ purged: number }>(
      'select private.purge_expired_idempotency_keys() as purged',
    );
    expect(purged).toBeGreaterThanOrEqual(1);
  });
});

describe('room checks', () => {
  it('run in the contract order: room, then membership, then role', async () => {
    const host = await db.createUser();
    const member = await db.createUser();
    const outsider = await db.createUser();
    const room = await insertRoom(host);
    await addMember(room.id, member);
    const act = (user: TestUser, roomId: string, hostOnly = true) =>
      db
        .as(user)
        .rpc('test_room_action', { room_id: roomId, rule: 'control', host_only: hostOnly });

    await expect(act(host, '00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      code: 'room_not_found',
    });
    await expect(act(outsider, room.id)).rejects.toMatchObject({ code: 'not_member' });
    await expect(act(member, room.id)).rejects.toMatchObject({ code: 'not_host' });
    await expect(act(host, room.id)).resolves.toBe('ok');

    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
      room.id,
    ]);
    await expect(act(host, room.id)).rejects.toMatchObject({ code: 'room_ended' });
  });

  it('follow the room rules: everyone, chosen people, host only', async () => {
    const host = await db.createUser();
    const chosen = await db.createUser();
    const other = await db.createUser();
    const room = await insertRoom(host, { add_songs: 'everyone', control: 'chosen' });
    await addMember(room.id, chosen);
    await addMember(room.id, other);
    await db.query(
      `insert into public.room_rule_members (room_id, rule, user_id) values ($1, 'control', $2)`,
      [room.id, chosen.id],
    );
    const act = (user: TestUser, rule: 'add_songs' | 'control') =>
      db.as(user).rpc('test_room_action', { room_id: room.id, rule, host_only: false });

    await expect(act(other, 'add_songs')).resolves.toBe('ok');
    await expect(act(chosen, 'control')).resolves.toBe('ok');
    await expect(act(other, 'control')).rejects.toMatchObject({ code: 'not_allowed' });
    await expect(act(host, 'control')).resolves.toBe('ok');

    await db.query(
      `update public.rooms set add_songs = 'host', control = 'everyone' where id = $1`,
      [room.id],
    );
    await expect(act(other, 'add_songs')).rejects.toMatchObject({ code: 'not_allowed' });
    await expect(act(other, 'control')).resolves.toBe('ok');
    await expect(act(host, 'add_songs')).resolves.toBe('ok');
  });

  it('broadcast a versioned refetch hint on the room channel, with ids only', async () => {
    const host = await db.createUser();
    const room = await insertRoom(host);
    await db
      .as(host)
      .rpc('test_room_action', { room_id: room.id, rule: 'control', host_only: true });
    const [message] = await db.broadcasts(room.id);
    expect(message).toMatchObject({
      event: 'queue.changed',
      private: true,
      payload: { v: 1, type: 'queue.changed', roomId: room.id },
    });
    expect(Object.keys(message.payload).sort()).toEqual(['at', 'roomId', 'type', 'v']);
    expect(message.payload.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });
});

describe('sync (beta) slot placeholders', () => {
  it.each(['claim_playback_slot', 'release_playback_slot'])(
    '%s fails with feature_disabled',
    async (name) => {
      const host = await db.createUser({ provider: 'spotify' });
      const room = await insertRoom(host);
      await expect(
        db.as(host).rpc(name, { room_id: room.id, idempotency_key: newKey() }),
      ).rejects.toMatchObject({
        code: 'feature_disabled',
        details: { flag: 'sync' },
      });
      await expect(
        db.asAnon().rpc(name, { room_id: room.id, idempotency_key: newKey() }),
      ).rejects.toMatchObject({
        sqlstate: '42501',
      });
    },
  );
});

describe('privileges', () => {
  it('API roles cannot use the private schema', async () => {
    const user = await db.createUser();
    await expect(db.as(user).query('select private.error_codes()')).rejects.toMatchObject({
      sqlstate: '42501',
    });
    await expect(db.asAnon().query('select private.error_codes()')).rejects.toMatchObject({
      sqlstate: '42501',
    });
  });

  it('every q’d function pins its search_path and anon cannot run it', async () => {
    const rows = await db.query<{ fn: string; pinned: boolean; anon: boolean }>(
      `select n.nspname || '.' || p.proname as fn,
              coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false) as pinned,
              has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and p.prorettype <> 'trigger'::regtype
          and p.proname not like 'test\\_%'`,
    );
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((row) => !row.pinned).map((row) => row.fn)).toEqual([]);
    expect(rows.filter((row) => row.anon).map((row) => row.fn)).toEqual([]);
  });
});
