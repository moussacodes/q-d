/**
 * join_room_by_code: a signed-in user joins a live room with its six-character
 * code. API_CONTRACTS.md § join_room_by_code and § 7.
 */
import { createTestDb, DbError, newKey, type TestDb, type TestUser } from './harness/db';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => db.close());

type Joined = { room_id: string };

/** A room created through create_room, so it has a real code and expiry. */
async function newRoom(host?: TestUser) {
  const owner = host ?? (await db.createUser({ provider: 'spotify' }));
  const room = await db.as(owner).rpc<{ room_id: string; code: string }>('create_room', {
    name: 'Friday',
    playback_provider: 'spotify',
    idempotency_key: newKey(),
  });
  return { host: owner, roomId: room.room_id, code: room.code };
}

/** A room inserted directly, with a code the test picks. */
async function insertRoom(code: string, overrides: { expiresIn?: string } = {}) {
  const host = await db.createUser({ provider: 'spotify' });
  const [room] = await db.query<{ id: string }>(
    `insert into public.rooms (name, host_id, playback_provider, code, code_expires_at)
     values ('Friday', $1, 'spotify', $2, now() + $3::interval) returning id`,
    [host.id, code, overrides.expiresIn ?? '1 hour'],
  );
  await db.query(
    `insert into public.room_members (room_id, user_id, role) values ($1, $2, 'host')`,
    [room.id, host.id],
  );
  return { host, roomId: room.id, code };
}

const join = (
  user: TestUser,
  code: string | null,
  options: { key?: string; ip?: string; headers?: Record<string, string> } = {},
) => {
  const headers = options.headers ?? (options.ip ? { 'x-forwarded-for': options.ip } : undefined);
  return db
    .as(user, headers ? { 'request.headers': JSON.stringify(headers) } : undefined)
    .rpc<Joined>('join_room_by_code', { code, idempotency_key: options.key ?? newKey() });
};

const members = (roomId: string) =>
  db.query<{ user_id: string; role: string }>(
    'select user_id, role from public.room_members where room_id = $1 order by joined_at',
    [roomId],
  );

const failures = async (user: TestUser) =>
  (
    await db.query<{ n: number }>(
      `select count(*)::int as n from private.join_attempts where user_id = $1 and kind = 'code'`,
      [user.id],
    )
  )[0].n;

/** A code from the alphabet that no room uses. */
let unusedCounter = 0;
async function unusedCode(): Promise<string> {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    unusedCounter += 1;
    let n = unusedCounter;
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      code += alphabet[n % 32];
      n = Math.floor(n / 32);
    }
    const [{ taken }] = await db.query<{ taken: boolean }>(
      'select exists (select 1 from public.rooms where code = $1) as taken',
      [code],
    );
    if (!taken) return code;
  }
}

/** Ages every failed attempt of this user by `interval`. */
const ageFailures = (user: TestUser, interval: string) =>
  db.query(
    `update private.join_attempts set attempted_at = attempted_at - $2::interval where user_id = $1`,
    [user.id, interval],
  );

describe('join_room_by_code', () => {
  it('adds the caller as a member and returns the room', async () => {
    const { host, roomId, code } = await newRoom();
    const guest = await db.createUser();
    await expect(join(guest, code)).resolves.toEqual({ room_id: roomId });
    expect(await members(roomId)).toEqual([
      { user_id: host.id, role: 'host' },
      { user_id: guest.id, role: 'member' },
    ]);
  });

  it('lets the new member read the room straight away through RLS', async () => {
    const { roomId, code } = await newRoom();
    const guest = await db.createUser();
    expect(await db.as(guest).query('select id from public.rooms')).toEqual([]);
    await join(guest, code);
    expect(await db.as(guest).query('select id from public.rooms')).toEqual([{ id: roomId }]);
  });

  it('does not need a music service', async () => {
    const { code, roomId } = await newRoom();
    const guest = await db.createUser();
    const [{ n }] = await db.query<{ n: number }>(
      'select count(*)::int as n from public.provider_connections where user_id = $1',
      [guest.id],
    );
    expect(n).toBe(0);
    await expect(join(guest, code)).resolves.toEqual({ room_id: roomId });
  });

  it('tells the room to refetch its members, with ids only', async () => {
    const { roomId, code } = await newRoom();
    const before = (await db.broadcasts(roomId)).length;
    await join(await db.createUser(), code);
    const sent = await db.broadcasts(roomId);
    expect(sent).toHaveLength(before + 1);
    const last = sent[sent.length - 1];
    expect(last.event).toBe('members.changed');
    expect(last.private).toBe(true);
    expect(Object.keys(last.payload).sort()).toEqual(['at', 'roomId', 'type', 'v']);
    expect(last.payload).toMatchObject({ v: 1, type: 'members.changed', roomId });
  });

  it.each([
    ['lower case', (code: string) => code.toLowerCase()],
    ['the QD- prefix', (code: string) => `QD-${code}`],
    [
      'a lower-case prefix and spaces',
      (code: string) => ` qd ${code.slice(0, 3)} ${code.slice(3)} `,
    ],
    ['dashes inside', (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`],
    ['the prefix without a dash', (code: string) => `qd${code.toLowerCase()}`],
  ])('accepts %s', async (_label, typed) => {
    const { roomId, code } = await newRoom();
    await expect(join(await db.createUser(), typed(code))).resolves.toEqual({ room_id: roomId });
  });

  it('keeps a code that itself starts with QD', async () => {
    const { roomId } = await insertRoom('QD7K4F');
    await expect(join(await db.createUser(), 'qd7k4f')).resolves.toEqual({ room_id: roomId });
    await expect(join(await db.createUser(), 'QD-QD7K4F')).resolves.toEqual({ room_id: roomId });
  });

  it('succeeds without a change for someone already in the room', async () => {
    const { host, roomId, code } = await newRoom();
    const guest = await db.createUser();
    await join(guest, code);
    const broadcasts = (await db.broadcasts(roomId)).length;
    await expect(join(guest, code)).resolves.toEqual({ room_id: roomId });
    await expect(join(host, code)).resolves.toEqual({ room_id: roomId });
    expect(await members(roomId)).toEqual([
      { user_id: host.id, role: 'host' },
      { user_id: guest.id, role: 'member' },
    ]);
    expect(await db.broadcasts(roomId)).toHaveLength(broadcasts);
  });

  it('fills a room to 15 and then answers room_full', async () => {
    const { roomId, code } = await newRoom();
    for (let i = 0; i < 14; i += 1) {
      await join(await db.createUser(), code);
    }
    expect(await members(roomId)).toHaveLength(15);
    const late = await db.createUser();
    await expect(join(late, code)).rejects.toMatchObject({
      code: 'room_full',
      hint: 'qd',
      sqlstate: 'P0001',
    });
    expect(await members(roomId)).toHaveLength(15);
    // A full room isn't a wrong guess.
    expect(await failures(late)).toBe(0);
  });

  it('lets only one of two people take the last place', async () => {
    const { roomId, code } = await newRoom();
    for (let i = 0; i < 13; i += 1) {
      await join(await db.createUser(), code);
    }
    const [a, b] = [await db.createUser(), await db.createUser()];
    const results = await Promise.allSettled([join(a, code), join(b, code)]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((result) => result.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: 'room_full' });
    expect(await members(roomId)).toHaveLength(15);
  });
});

describe('join_room_by_code errors', () => {
  it('needs a signed-in user', async () => {
    const { code } = await newRoom();
    await expect(
      db.asServiceRole().rpc('join_room_by_code', { code, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ code: 'not_authenticated' });
  });

  it('is not callable by anon', async () => {
    const { code } = await newRoom();
    await expect(
      db.asAnon().rpc('join_room_by_code', { code, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('needs a finished profile', async () => {
    const { roomId, code } = await newRoom();
    const guest = await db.createUser({ profile: false });
    await expect(join(guest, code)).rejects.toMatchObject({ code: 'profile_incomplete' });
    expect(await members(roomId)).toHaveLength(1);
  });

  it('needs an idempotency key', async () => {
    const { code } = await newRoom();
    await expect(
      db.as(await db.createUser()).rpc('join_room_by_code', { code, idempotency_key: null }),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'idempotency_key' } });
  });

  it('answers a wrong code with code_invalid, as a q’d error', async () => {
    const guest = await db.createUser();
    const error = await join(guest, await unusedCode()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: 'code_invalid', hint: 'qd', sqlstate: 'P0001' });
    expect(await failures(guest)).toBe(1);
  });

  it('answers an expired code exactly like a wrong one', async () => {
    const { roomId, code } = await insertRoom(await unusedCode(), { expiresIn: '-1 second' });
    const guest = await db.createUser();
    const expired = await join(guest, code).catch((e: unknown) => e);
    const wrong = await join(guest, await unusedCode()).catch((e: unknown) => e);
    expect(expired).toMatchObject({ code: 'code_invalid', hint: 'qd' });
    expect(expired).toEqual(wrong);
    expect(await members(roomId)).toHaveLength(1);
    expect(await failures(guest)).toBe(2);
  });

  it('treats the code of an ended room as wrong, because ending a room frees it', async () => {
    const { roomId, code } = await newRoom();
    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
      roomId,
    ]);
    const guest = await db.createUser();
    await expect(join(guest, code)).rejects.toMatchObject({ code: 'code_invalid' });
    expect(await members(roomId)).toHaveLength(1);
  });

  it('answers room_ended when the room ends between the lookup and the join', async () => {
    // The lookup only finds live rooms; private.join_room locks the room and
    // re-checks, which is what a concurrent end_room leaves behind.
    const { roomId } = await newRoom();
    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
      roomId,
    ]);
    const guest = await db.createUser();
    await expect(
      db.query('select private.join_room($1, $2)', [roomId, guest.id]),
    ).rejects.toMatchObject({ code: 'room_ended' });
  });

  it.each([
    ['too short', '7K4F9'],
    ['too long', '7K4F9XX'],
    ['a zero', '7K4F90'],
    ['the letter O', '7K4F9O'],
    ['a one', '7K4F91'],
    ['the letter I', '7K4F9I'],
    ['punctuation', '7K4F9!'],
    ['an empty string', ''],
    ['nothing at all', null],
  ])('answers code_invalid for %s, without counting an attempt', async (_label, typed) => {
    const guest = await db.createUser();
    await expect(join(guest, typed)).rejects.toMatchObject({ code: 'code_invalid', hint: 'qd' });
    expect(await failures(guest)).toBe(0);
  });

  describe('code expiry boundary', () => {
    /** Sets the room's expiry relative to the transaction time, then joins in it. */
    async function joinAtExpiry(code: string, roomId: string, offset: string) {
      const guest = await db.createUser();
      return db.pg.transaction(async (tx) => {
        await tx.query(
          `update public.rooms set code_expires_at = now() + $2::interval where id = $1`,
          [roomId, offset],
        );
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [guest.id]);
        await tx.exec('set local role authenticated');
        const [row] = (
          await tx.query<{ result: { code?: string; message?: string; room_id?: string } }>(
            'select public.join_room_by_code(code => $1, idempotency_key => $2) as result',
            [code, newKey()],
          )
        ).rows;
        return row.result;
      });
    }

    it('works until the last moment', async () => {
      const { code, roomId } = await insertRoom(await unusedCode());
      await expect(joinAtExpiry(code, roomId, '1 millisecond')).resolves.toEqual({
        room_id: roomId,
      });
    });

    it('stops at the expiry time itself', async () => {
      const { code, roomId } = await insertRoom(await unusedCode());
      await expect(joinAtExpiry(code, roomId, '0 seconds')).resolves.toMatchObject({
        message: 'code_invalid',
      });
    });
  });
});

describe('join_room_by_code attempt limits', () => {
  it('locks a user out after five wrong codes in ten minutes', async () => {
    const { roomId, code } = await newRoom();
    const guest = await db.createUser();
    for (let i = 0; i < 5; i += 1) {
      await expect(join(guest, await unusedCode())).rejects.toMatchObject({ code: 'code_invalid' });
    }
    const error = (await join(guest, await unusedCode()).catch((e: unknown) => e)) as DbError;
    expect(error).toMatchObject({ code: 'rate_limited', hint: 'qd' });
    const { retry_after_seconds: wait } = error.details as { retry_after_seconds: number };
    expect(wait).toBeGreaterThan(590);
    expect(wait).toBeLessThanOrEqual(600);
    // Checked before the lookup: even the right code waits, and nothing is recorded.
    await expect(join(guest, code)).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await members(roomId)).toHaveLength(1);
    expect(await failures(guest)).toBe(5);
  });

  it('opens again as failures age out of the window', async () => {
    const { roomId, code } = await newRoom();
    const guest = await db.createUser();
    for (let i = 0; i < 5; i += 1) {
      await join(guest, await unusedCode()).catch(() => undefined);
    }
    await ageFailures(guest, '9 minutes');
    const error = (await join(guest, code).catch((e: unknown) => e)) as DbError;
    expect(error.code).toBe('rate_limited');
    const { retry_after_seconds: wait } = error.details as { retry_after_seconds: number };
    expect(wait).toBeGreaterThan(50);
    expect(wait).toBeLessThanOrEqual(60);
    await ageFailures(guest, '1 minute');
    await expect(join(guest, code)).resolves.toEqual({ room_id: roomId });
  });

  it('a sliding window: one failure ageing out allows exactly one more try', async () => {
    const guest = await db.createUser();
    await join(guest, await unusedCode()).catch(() => undefined);
    await ageFailures(guest, '10 minutes');
    for (let i = 0; i < 4; i += 1) {
      await join(guest, await unusedCode()).catch(() => undefined);
    }
    // Four in the window, one outside it: one more try is allowed.
    await expect(join(guest, await unusedCode())).rejects.toMatchObject({ code: 'code_invalid' });
    await expect(join(guest, await unusedCode())).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('a successful join does not reset the count', async () => {
    const own = await newRoom();
    const guest = await db.createUser();
    for (let i = 0; i < 4; i += 1) {
      await join(guest, await unusedCode()).catch(() => undefined);
    }
    // Joining a room the caller already knows doesn't buy more guesses.
    await expect(join(guest, own.code)).resolves.toEqual({ room_id: own.roomId });
    await expect(join(guest, await unusedCode())).rejects.toMatchObject({ code: 'code_invalid' });
    await expect(join(guest, own.code)).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('counts each user separately', async () => {
    const { roomId, code } = await newRoom();
    const guesser = await db.createUser();
    for (let i = 0; i < 5; i += 1) {
      await join(guesser, await unusedCode()).catch(() => undefined);
    }
    await expect(join(guesser, code)).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(join(await db.createUser(), code)).resolves.toEqual({ room_id: roomId });
  });

  it('counts parallel guesses one after another', async () => {
    const guest = await db.createUser();
    const codes = await Promise.all(Array.from({ length: 8 }, () => unusedCode()));
    const results = await Promise.allSettled(codes.map((code) => join(guest, code)));
    const errors = results.map((result) => (result as PromiseRejectedResult).reason.code);
    expect(errors.filter((code) => code === 'code_invalid')).toHaveLength(5);
    expect(errors.filter((code) => code === 'rate_limited')).toHaveLength(3);
    expect(await failures(guest)).toBe(5);
  });

  it('locks an IP address out after twenty wrong codes from any accounts', async () => {
    const { roomId, code } = await newRoom();
    const ip = '203.0.113.7';
    for (let user = 0; user < 5; user += 1) {
      const guesser = await db.createUser();
      for (let i = 0; i < 4; i += 1) {
        await expect(join(guesser, await unusedCode(), { ip })).rejects.toMatchObject({
          code: 'code_invalid',
        });
      }
    }
    const fresh = await db.createUser();
    const error = (await join(fresh, code, { ip }).catch((e: unknown) => e)) as DbError;
    expect(error).toMatchObject({ code: 'rate_limited' });
    expect(
      (error.details as { retry_after_seconds: number }).retry_after_seconds,
    ).toBeLessThanOrEqual(600);
    // The same account from another address, or with none, isn't held back.
    await expect(join(fresh, code, { ip: '198.51.100.2' })).resolves.toEqual({ room_id: roomId });
  });

  it('reads the first X-Forwarded-For entry and ignores garbage', async () => {
    const ip = '192.0.2.44';
    for (let user = 0; user < 4; user += 1) {
      const guesser = await db.createUser();
      for (let i = 0; i < 5; i += 1) {
        await join(guesser, await unusedCode(), {
          headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` },
        }).catch(() => undefined);
      }
    }
    const { code } = await newRoom();
    await expect(join(await db.createUser(), code, { ip })).rejects.toMatchObject({
      code: 'rate_limited',
    });
    // Not an address: no IP limit applies (the per-user limit still does).
    const other = await newRoom();
    await expect(
      join(await db.createUser(), other.code, { headers: { 'x-forwarded-for': 'not-an-ip' } }),
    ).resolves.toEqual({ room_id: other.roomId });
  });

  it('stores neither the code that was tried nor the raw IP address', async () => {
    const guest = await db.createUser();
    await join(guest, await unusedCode(), { ip: '203.0.113.99' }).catch(() => undefined);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'private' and table_name = 'join_attempts' order by ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'kind',
      'user_id',
      'ip_hash',
      'attempted_at',
    ]);
    const [row] = await db.query<{ hashed: boolean }>(
      `select ip_hash = sha256(convert_to('203.0.113.99', 'UTF8')) as hashed
         from private.join_attempts where user_id = $1`,
      [guest.id],
    );
    expect(row.hashed).toBe(true);
  });

  it('keeps the attempts out of reach of every API role', async () => {
    const user = await db.createUser();
    await expect(db.as(user).query('select * from private.join_attempts')).rejects.toMatchObject({
      sqlstate: '42501',
    });
    await expect(
      db
        .as(user)
        .query(`insert into private.join_attempts (kind, user_id) values ('code', $1)`, [user.id]),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(db.as(user).query('delete from private.join_attempts')).rejects.toMatchObject({
      sqlstate: '42501',
    });
    await expect(db.asAnon().query('select * from private.join_attempts')).rejects.toMatchObject({
      sqlstate: '42501',
    });
  });

  it('purges attempts older than a day', async () => {
    const guest = await db.createUser();
    await join(guest, await unusedCode()).catch(() => undefined);
    await join(guest, await unusedCode()).catch(() => undefined);
    await db.query(
      `update private.join_attempts set attempted_at = now() - interval '25 hours'
        where id = (select min(id) from private.join_attempts where user_id = $1)`,
      [guest.id],
    );
    const [{ purged }] = await db.query<{ purged: number }>(
      'select private.purge_join_attempts() as purged',
    );
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await failures(guest)).toBe(1);
  });
});

describe('join_room_by_code idempotency', () => {
  it('a retry with the same key returns the same result without a second broadcast', async () => {
    const { roomId, code } = await newRoom();
    const guest = await db.createUser();
    const key = newKey();
    await join(guest, code, { key });
    const broadcasts = (await db.broadcasts(roomId)).length;
    await expect(join(guest, code, { key })).resolves.toEqual({ room_id: roomId });
    expect(await db.broadcasts(roomId)).toHaveLength(broadcasts);
  });

  it('treats the same code typed differently as the same request', async () => {
    const { roomId, code } = await newRoom();
    const guest = await db.createUser();
    const key = newKey();
    await join(guest, code, { key });
    await expect(join(guest, `qd-${code.toLowerCase()}`, { key })).resolves.toEqual({
      room_id: roomId,
    });
  });

  it('the same key with another code fails with idempotency_conflict', async () => {
    const a = await newRoom();
    const b = await newRoom();
    const guest = await db.createUser();
    const key = newKey();
    await join(guest, a.code, { key });
    await expect(join(guest, b.code, { key })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(await members(b.roomId)).toHaveLength(1);
  });

  it('replays before every other check: after the code expired, the room ended or a lockout', async () => {
    const { roomId, code } = await newRoom();
    const guest = await db.createUser();
    const key = newKey();
    await join(guest, code, { key });
    for (let i = 0; i < 5; i += 1) {
      await join(guest, await unusedCode()).catch(() => undefined);
    }
    await db.query(
      `update public.rooms set code_expires_at = now() - interval '1 minute', state = 'ended',
              ended_at = now() where id = $1`,
      [roomId],
    );
    await expect(join(guest, code, { key })).resolves.toEqual({ room_id: roomId });
  });

  it('a new key after success goes through every check again', async () => {
    const { roomId, code } = await newRoom();
    const guest = await db.createUser();
    await join(guest, code);
    await expect(join(guest, code)).resolves.toEqual({ room_id: roomId });
    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
      roomId,
    ]);
    await expect(join(guest, code)).rejects.toMatchObject({ code: 'code_invalid' });
  });

  it('a wrong code is not stored, so the key can be used again with the right one', async () => {
    const { roomId, code } = await newRoom();
    const guest = await db.createUser();
    const key = newKey();
    await expect(join(guest, await unusedCode(), { key })).rejects.toMatchObject({
      code: 'code_invalid',
    });
    await expect(join(guest, code, { key })).resolves.toEqual({ room_id: roomId });
  });
});

describe('private.error_response', () => {
  it('sets a 400 status and returns the body a raised q’d error has', async () => {
    const rows = await db.pg.transaction(async (tx) => {
      const [{ body }] = (
        await tx.query<{ body: unknown }>(
          `select private.error_response('rate_limited', '{"retry_after_seconds": 5}') as body`,
        )
      ).rows;
      const [{ status }] = (
        await tx.query<{ status: string }>(`select current_setting('response.status') as status`)
      ).rows;
      return { body, status };
    });
    expect(rows).toEqual({
      status: '400',
      body: {
        code: 'P0001',
        message: 'rate_limited',
        details: '{"retry_after_seconds": 5}',
        hint: 'qd',
      },
    });
  });

  it('refuses codes that are not in the contract', async () => {
    await expect(db.query(`select private.error_response('oops')`)).rejects.toMatchObject({
      code: 'unknown q’d error code: oops',
    });
  });
});

describe('join_room_by_code attempt limit bypasses (review)', () => {
  it('counts a wrong code however it is typed: case, spaces, dashes and the QD- prefix', async () => {
    const guest = await db.createUser();
    const variants = [
      (c: string) => c.toLowerCase(),
      (c: string) => `QD-${c}`,
      (c: string) => `qd ${c.slice(0, 3)} ${c.slice(3)}`,
      (c: string) => `${c.slice(0, 3)}-${c.slice(3)}`,
      (c: string) => ` ${c} `,
    ];
    for (const variant of variants) {
      await expect(join(guest, variant(await unusedCode()))).rejects.toMatchObject({
        code: 'code_invalid',
      });
    }
    expect(await failures(guest)).toBe(5);
    await expect(join(guest, await unusedCode())).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('a locked-out caller gets rate_limited even for input that is not a code', async () => {
    const guest = await db.createUser();
    for (let i = 0; i < 5; i += 1) {
      await join(guest, await unusedCode()).catch(() => undefined);
    }
    await expect(join(guest, '7K4F9O')).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(join(guest, null)).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await failures(guest)).toBe(5);
  });

  it('reusing the key of a wrong guess for another guess is counted again, not a conflict', async () => {
    const guest = await db.createUser();
    const key = newKey();
    for (let i = 0; i < 5; i += 1) {
      await expect(join(guest, await unusedCode(), { key })).rejects.toMatchObject({
        code: 'code_invalid',
      });
    }
    await expect(join(guest, await unusedCode(), { key })).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(await failures(guest)).toBe(5);
  });

  it('a stored success cannot be replayed to probe other codes', async () => {
    const own = await newRoom();
    const guest = await db.createUser();
    const key = newKey();
    await join(guest, own.code, { key });
    // Another code under the same key: a conflict whether or not it exists.
    const other = await newRoom();
    await expect(join(guest, other.code, { key })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    await expect(join(guest, await unusedCode(), { key })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(await members(other.roomId)).toHaveLength(1);
  });

  it('a new address for every guess does not get past the per-user limit', async () => {
    const guest = await db.createUser();
    for (let i = 0; i < 5; i += 1) {
      await join(guest, await unusedCode(), { ip: `198.51.100.${i + 10}` }).catch(() => undefined);
    }
    const { code } = await newRoom();
    await expect(join(guest, code, { ip: '198.51.100.99' })).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('a wrong code commits the attempt and nothing else: no member, no key, no broadcast', async () => {
    const { roomId } = await newRoom();
    const guest = await db.createUser();
    const key = newKey();
    const before = (await db.broadcasts(roomId)).length;
    await expect(join(guest, await unusedCode(), { key })).rejects.toMatchObject({
      code: 'code_invalid',
    });
    expect(await failures(guest)).toBe(1);
    const [{ n }] = await db.query<{ n: number }>(
      'select count(*)::int as n from public.idempotency_keys where user_id = $1',
      [guest.id],
    );
    expect(n).toBe(0);
    const [{ m }] = await db.query<{ m: number }>(
      'select count(*)::int as m from public.room_members where user_id = $1',
      [guest.id],
    );
    expect(m).toBe(0);
    expect(await db.broadcasts(roomId)).toHaveLength(before);
  });
});

describe('private.error_response usage (review)', () => {
  // Setting response.status commits whatever the transaction already wrote. A
  // `perform private.error_response(...)` (no return) would let the function
  // carry on and commit a success under an error status. Every use must return
  // it straight away, and only the join RPCs may use it.
  it('is only ever returned immediately, and only by the join RPCs', async () => {
    const rows = await db.query<{ name: string; src: string }>(
      `select n.nspname || '.' || p.proname as name, p.prosrc as src
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prosrc like '%error_response(%' and p.proname <> 'error_response'`,
    );
    const users = new Set<string>();
    for (const { name, src } of rows) {
      const code = src.replace(/--[^\n]*/g, '');
      for (const line of code.match(/[^\n;]*private\.error_response\(/g) ?? []) {
        expect(line.trim()).toMatch(/^return private\.error_response\(/);
        users.add(name);
      }
    }
    expect([...users]).toContain('public.join_room_by_code');
    for (const name of users) {
      expect(['public.join_room_by_code', 'public.join_room_by_invite']).toContain(name);
    }
  });
});
