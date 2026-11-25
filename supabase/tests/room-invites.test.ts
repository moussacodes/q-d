/**
 * QR invitations: create_room_invite and join_room_by_invite.
 * API_CONTRACTS.md § create_room_invite, § join_room_by_invite and § 7.
 */
import { createTestDb, DbError, newKey, type TestDb, type TestUser } from './harness/db';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => db.close());

type Invite = { token: string; expires_at: string };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

async function newRoom() {
  const host = await db.createUser({ provider: 'spotify' });
  const room = await db.as(host).rpc<{ room_id: string; code: string }>('create_room', {
    name: 'Friday',
    playback_provider: 'spotify',
    idempotency_key: newKey(),
  });
  return { host, roomId: room.room_id, code: room.code };
}

const invite = (user: TestUser, roomId: string, key = newKey()) =>
  db.as(user).rpc<Invite>('create_room_invite', { room_id: roomId, idempotency_key: key });

const join = (user: TestUser, token: string | null, key = newKey()) =>
  db.as(user).rpc<{ room_id: string }>('join_room_by_invite', { token, idempotency_key: key });

const joinByCode = (user: TestUser, code: string) =>
  db.as(user).rpc<{ room_id: string }>('join_room_by_code', { code, idempotency_key: newKey() });

const invites = (roomId: string) =>
  db.query<{ id: string; token_hash: Buffer; revoked_at: string | null; expires_at: string }>(
    'select id, token_hash, revoked_at, expires_at from public.room_invites where room_id = $1 order by created_at, id',
    [roomId],
  );

const members = (roomId: string) =>
  db.query<{ user_id: string; role: string }>(
    'select user_id, role from public.room_members where room_id = $1 order by joined_at',
    [roomId],
  );

const failures = async (user: TestUser, kind: 'code' | 'invite') =>
  (
    await db.query<{ n: number }>(
      'select count(*)::int as n from private.join_attempts where user_id = $1 and kind = $2',
      [user.id, kind],
    )
  )[0].n;

/** A token-shaped string that no invite has. */
const unknownToken = async () =>
  (await db.query<{ t: string }>('select private.generate_invite_token() as t'))[0].t;

const addMember = (roomId: string, user: TestUser) =>
  db.query('insert into public.room_members (room_id, user_id) values ($1, $2)', [roomId, user.id]);

describe('create_room_invite', () => {
  it('gives the host a URL-safe token that works for 24 hours', async () => {
    const { host, roomId } = await newRoom();
    const result = await invite(host, roomId);
    expect(Object.keys(result).sort()).toEqual(['expires_at', 'token']);
    expect(result.token).toMatch(TOKEN);
    const hours = (new Date(result.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
  });

  it('stores only a SHA-256 hash of the token, anywhere', async () => {
    const { host, roomId } = await newRoom();
    const key = newKey();
    const { token } = await invite(host, roomId, key);
    const [row] = await db.query<{ matches: boolean }>(
      `select token_hash = sha256(convert_to($2, 'UTF8')) as matches
         from public.room_invites where room_id = $1`,
      [roomId, token],
    );
    expect(row.matches).toBe(true);
    // Nowhere in the database holds the token in plain text.
    const [{ found }] = await db.query<{ found: boolean }>(
      `select exists (select 1 from public.idempotency_keys where result::text like '%' || $1 || '%')
           or exists (select 1 from realtime.messages where payload::text like '%' || $1 || '%')
           as found`,
      [token],
    );
    expect(found).toBe(false);
    const [stored] = await db.query<{ result: Record<string, unknown> }>(
      `select result from public.idempotency_keys where idempotency_key = $1`,
      [key],
    );
    expect(Object.keys(stored.result).sort()).toEqual(['expires_at', 'invite_id']);
  });

  it('draws at least 128 bits: 32 random bytes, unique every time', async () => {
    const rows = await db.query<{ t: string; bytes: number }>(
      `select t, length(decode(translate(t, '-_', '+/') || '=', 'base64')) as bytes
         from (select private.generate_invite_token() as t from generate_series(1, 300)) s`,
    );
    for (const row of rows) {
      expect(row.t).toMatch(TOKEN);
      expect(row.bytes).toBe(32);
    }
    expect(new Set(rows.map((row) => row.t)).size).toBe(300);
  });

  it('never reuses the room code', async () => {
    const { host, roomId, code } = await newRoom();
    const { token } = await invite(host, roomId);
    expect(token).not.toContain(code);
    expect(token.toUpperCase()).not.toContain(code);
  });

  it('replaces the older invite, so only the newest token works', async () => {
    const { host, roomId } = await newRoom();
    const first = await invite(host, roomId);
    const second = await invite(host, roomId);
    expect(second.token).not.toBe(first.token);
    const rows = await invites(roomId);
    expect(rows).toHaveLength(2);
    expect(rows[0].revoked_at).not.toBeNull();
    expect(rows[1].revoked_at).toBeNull();
    await expect(join(await db.createUser(), first.token)).rejects.toMatchObject({
      code: 'invite_invalid',
    });
    await expect(join(await db.createUser(), second.token)).resolves.toEqual({ room_id: roomId });
  });

  it('lets only the host read the invite row, never the token', async () => {
    const { host, roomId } = await newRoom();
    const member = await db.createUser();
    await addMember(roomId, member);
    await invite(host, roomId);
    expect(await db.as(host).query('select room_id from public.room_invites')).toEqual([
      { room_id: roomId },
    ]);
    expect(await db.as(member).query('select room_id from public.room_invites')).toEqual([]);
  });
});

describe('create_room_invite errors', () => {
  it('needs a signed-in user', async () => {
    const { roomId } = await newRoom();
    await expect(
      db.asServiceRole().rpc('create_room_invite', { room_id: roomId, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ code: 'not_authenticated' });
  });

  it('is not callable by anon', async () => {
    const { roomId } = await newRoom();
    await expect(
      db.asAnon().rpc('create_room_invite', { room_id: roomId, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('is for the host only', async () => {
    const { roomId } = await newRoom();
    const member = await db.createUser();
    await addMember(roomId, member);
    await expect(invite(member, roomId)).rejects.toMatchObject({ code: 'not_host', hint: 'qd' });
    await expect(invite(await db.createUser(), roomId)).rejects.toMatchObject({
      code: 'not_member',
    });
    expect(await invites(roomId)).toEqual([]);
  });

  it('needs a room that exists and has not ended', async () => {
    const { host, roomId } = await newRoom();
    await expect(invite(host, '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      code: 'room_not_found',
    });
    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
      roomId,
    ]);
    await expect(invite(host, roomId)).rejects.toMatchObject({ code: 'room_ended' });
  });

  it('needs an idempotency key', async () => {
    const { host, roomId } = await newRoom();
    await expect(
      db.as(host).rpc('create_room_invite', { room_id: roomId, idempotency_key: null }),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'idempotency_key' } });
  });
});

describe('create_room_invite idempotency', () => {
  it('a replay re-issues the same invite: same row and expiry, a fresh token', async () => {
    const { host, roomId } = await newRoom();
    const key = newKey();
    const first = await invite(host, roomId, key);
    const again = await invite(host, roomId, key);
    expect(again.expires_at).toBe(first.expires_at);
    expect(again.token).toMatch(TOKEN);
    expect(again.token).not.toBe(first.token);
    const rows = await invites(roomId);
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).toBeNull();
    // The lost response's token stops working; the one the app got works.
    await expect(join(await db.createUser(), first.token)).rejects.toMatchObject({
      code: 'invite_invalid',
    });
    await expect(join(await db.createUser(), again.token)).resolves.toEqual({ room_id: roomId });
  });

  it('the same key for another room fails with idempotency_conflict', async () => {
    const a = await newRoom();
    const [{ id: otherRoom }] = await db.query<{ id: string }>(
      `insert into public.rooms (name, host_id, playback_provider, code, code_expires_at)
       values ('Other', $1, 'spotify', 'ZZZZZ2', now() + interval '1 day') returning id`,
      [a.host.id],
    );
    await db.query(
      `insert into public.room_members (room_id, user_id, role) values ($1, $2, 'host')`,
      [otherRoom, a.host.id],
    );
    const key = newKey();
    await invite(a.host, a.roomId, key);
    await expect(invite(a.host, otherRoom, key)).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
  });

  it('once that invite was replaced, the key counts as new', async () => {
    const { host, roomId } = await newRoom();
    const key = newKey();
    await invite(host, roomId, key);
    const newer = await invite(host, roomId);
    const retried = await invite(host, roomId, key);
    expect(await invites(roomId)).toHaveLength(3);
    await expect(join(await db.createUser(), newer.token)).rejects.toMatchObject({
      code: 'invite_invalid',
    });
    await expect(join(await db.createUser(), retried.token)).resolves.toEqual({ room_id: roomId });
  });

  it('once the room ended, a replay goes through the checks and fails', async () => {
    const { host, roomId } = await newRoom();
    const key = newKey();
    await invite(host, roomId, key);
    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
      roomId,
    ]);
    await expect(invite(host, roomId, key)).rejects.toMatchObject({ code: 'room_ended' });
  });

  it('keys belong to one user: another user with the same key is checked as new', async () => {
    const { host, roomId } = await newRoom();
    const member = await db.createUser();
    await addMember(roomId, member);
    const key = newKey();
    await invite(host, roomId, key);
    await expect(invite(member, roomId, key)).rejects.toMatchObject({ code: 'not_host' });
  });
});

describe('join_room_by_invite', () => {
  it('adds the caller as a member, without a music service, and tells the room', async () => {
    const { host, roomId } = await newRoom();
    const { token } = await invite(host, roomId);
    const guest = await db.createUser();
    const before = (await db.broadcasts(roomId)).length;
    await expect(join(guest, token)).resolves.toEqual({ room_id: roomId });
    expect(await members(roomId)).toEqual([
      { user_id: host.id, role: 'host' },
      { user_id: guest.id, role: 'member' },
    ]);
    const sent = await db.broadcasts(roomId);
    expect(sent).toHaveLength(before + 1);
    expect(sent[sent.length - 1].payload).toMatchObject({ v: 1, type: 'members.changed', roomId });
    expect(await db.as(guest).query('select id from public.rooms')).toEqual([{ id: roomId }]);
  });

  it('works for many people until the room is full', async () => {
    const { host, roomId } = await newRoom();
    const { token } = await invite(host, roomId);
    for (let i = 0; i < 14; i += 1) {
      await join(await db.createUser(), token);
    }
    const late = await db.createUser();
    await expect(join(late, token)).rejects.toMatchObject({ code: 'room_full', hint: 'qd' });
    expect(await members(roomId)).toHaveLength(15);
    expect(await failures(late, 'invite')).toBe(0);
  });

  it('succeeds without a change for someone already in the room', async () => {
    const { host, roomId } = await newRoom();
    const { token } = await invite(host, roomId);
    const guest = await db.createUser();
    await join(guest, token);
    const broadcasts = (await db.broadcasts(roomId)).length;
    await expect(join(guest, token)).resolves.toEqual({ room_id: roomId });
    await expect(join(host, token)).resolves.toEqual({ room_id: roomId });
    expect(await members(roomId)).toHaveLength(2);
    expect(await db.broadcasts(roomId)).toHaveLength(broadcasts);
  });
});

describe('join_room_by_invite errors', () => {
  it('needs a signed-in user', async () => {
    const { host, roomId } = await newRoom();
    const { token } = await invite(host, roomId);
    await expect(
      db.asServiceRole().rpc('join_room_by_invite', { token, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ code: 'not_authenticated' });
    await expect(
      db.asAnon().rpc('join_room_by_invite', { token, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('needs a finished profile', async () => {
    const { host, roomId } = await newRoom();
    const { token } = await invite(host, roomId);
    await expect(join(await db.createUser({ profile: false }), token)).rejects.toMatchObject({
      code: 'profile_incomplete',
    });
    expect(await members(roomId)).toHaveLength(1);
  });

  it('answers an unknown token with invite_invalid and counts it', async () => {
    const guest = await db.createUser();
    const error = await join(guest, await unknownToken()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: 'invite_invalid', hint: 'qd', sqlstate: 'P0001' });
    expect(await failures(guest, 'invite')).toBe(1);
  });

  it.each([
    ['the room code', 'code'],
    ['a short string', 'abc'],
    ['an empty string', ''],
    ['nothing at all', null],
    ['a token with padding', 'x'.repeat(42) + '='],
  ])('answers invite_invalid for %s, without counting it', async (_label, value) => {
    const { host, roomId, code } = await newRoom();
    await invite(host, roomId);
    const guest = await db.createUser();
    await expect(join(guest, value === 'code' ? code : value)).rejects.toMatchObject({
      code: 'invite_invalid',
    });
    expect(await failures(guest, 'invite')).toBe(0);
    expect(await members(roomId)).toHaveLength(1);
  });

  it('answers invite_invalid for an expired invite', async () => {
    const { host, roomId } = await newRoom();
    const { token } = await invite(host, roomId);
    await db.query(
      `update public.room_invites set created_at = now() - interval '2 days',
              expires_at = now() - interval '1 second' where room_id = $1`,
      [roomId],
    );
    const guest = await db.createUser();
    await expect(join(guest, token)).rejects.toMatchObject({ code: 'invite_invalid', hint: 'qd' });
    expect(await failures(guest, 'invite')).toBe(0);
  });

  describe('invite expiry boundary', () => {
    async function joinAtExpiry(token: string, roomId: string, offset: string) {
      const guest = await db.createUser();
      return db.pg
        .transaction(async (tx) => {
          await tx.query(
            `update public.room_invites set created_at = now() - interval '1 day',
                    expires_at = now() + $2::interval where room_id = $1 and revoked_at is null`,
            [roomId, offset],
          );
          await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [guest.id]);
          await tx.exec('set local role authenticated');
          const [row] = (
            await tx.query<{ result: unknown }>(
              'select public.join_room_by_invite(token => $1, idempotency_key => $2) as result',
              [token, newKey()],
            )
          ).rows;
          return row.result;
        })
        .catch((cause: unknown) => new DbError(cause));
    }

    it('works until the last moment', async () => {
      const { host, roomId } = await newRoom();
      const { token } = await invite(host, roomId);
      await expect(joinAtExpiry(token, roomId, '1 millisecond')).resolves.toEqual({
        room_id: roomId,
      });
    });

    it('stops at the expiry time itself', async () => {
      const { host, roomId } = await newRoom();
      const { token } = await invite(host, roomId);
      await expect(joinAtExpiry(token, roomId, '0 seconds')).resolves.toMatchObject({
        code: 'invite_invalid',
      });
    });
  });

  it('answers room_ended for a real token of a room that ended', async () => {
    const { host, roomId } = await newRoom();
    const { token } = await invite(host, roomId);
    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1;`, [
      roomId,
    ]);
    await db.query(`update public.room_invites set revoked_at = now() where room_id = $1`, [
      roomId,
    ]);
    const guest = await db.createUser();
    await expect(join(guest, token)).rejects.toMatchObject({ code: 'room_ended' });
    expect(await failures(guest, 'invite')).toBe(0);
  });
});

describe('join_room_by_invite attempt limits', () => {
  it('locks a user out after five unknown tokens, even for a real one', async () => {
    const { host, roomId } = await newRoom();
    const { token } = await invite(host, roomId);
    const guest = await db.createUser();
    for (let i = 0; i < 5; i += 1) {
      await expect(join(guest, await unknownToken())).rejects.toMatchObject({
        code: 'invite_invalid',
      });
    }
    const error = (await join(guest, token).catch((e: unknown) => e)) as DbError;
    expect(error).toMatchObject({ code: 'rate_limited' });
    expect(
      (error.details as { retry_after_seconds: number }).retry_after_seconds,
    ).toBeLessThanOrEqual(600);
    await db.query(
      `update private.join_attempts set attempted_at = attempted_at - interval '10 minutes'
        where user_id = $1`,
      [guest.id],
    );
    await expect(join(guest, token)).resolves.toEqual({ room_id: roomId });
  });

  it('counts invites and codes separately', async () => {
    const { host, roomId, code } = await newRoom();
    const { token } = await invite(host, roomId);
    const guest = await db.createUser();
    for (let i = 0; i < 5; i += 1) {
      await join(guest, await unknownToken()).catch(() => undefined);
    }
    await expect(join(guest, token)).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(joinByCode(guest, code)).resolves.toEqual({ room_id: roomId });
    expect(await failures(guest, 'code')).toBe(0);
  });
});

describe('join_room_by_invite idempotency', () => {
  it('a replay returns the stored result, even after the invite was replaced', async () => {
    const { host, roomId } = await newRoom();
    const { token } = await invite(host, roomId);
    const guest = await db.createUser();
    const key = newKey();
    await join(guest, token, key);
    await invite(host, roomId);
    await expect(join(guest, token, key)).resolves.toEqual({ room_id: roomId });
    // A new key goes through the checks: the replaced token is refused.
    await expect(join(guest, token)).rejects.toMatchObject({ code: 'invite_invalid' });
  });

  it('the same key with another token fails with idempotency_conflict', async () => {
    const a = await newRoom();
    const b = await newRoom();
    const tokenA = (await invite(a.host, a.roomId)).token;
    const tokenB = (await invite(b.host, b.roomId)).token;
    const guest = await db.createUser();
    const key = newKey();
    await join(guest, tokenA, key);
    await expect(join(guest, tokenB, key)).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(await members(b.roomId)).toHaveLength(1);
  });

  it('keeps no plain token in the idempotency table', async () => {
    const { host, roomId } = await newRoom();
    const { token } = await invite(host, roomId);
    const guest = await db.createUser();
    const key = newKey();
    await join(guest, token, key);
    const [row] = await db.query<{ result: unknown; has_token: boolean }>(
      `select result, position(convert_to($2, 'UTF8') in request_hash) > 0 as has_token
         from public.idempotency_keys where idempotency_key = $1`,
      [key, token],
    );
    expect(row).toEqual({ result: { room_id: roomId }, has_token: false });
  });
});
