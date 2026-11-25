/**
 * end_room: the host ends the room. API_CONTRACTS.md § end_room.
 */
import { createTestDb, newKey, type TestDb, type TestUser } from './harness/db';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => db.close());

type Ended = { room_id: string; ended_at: string };

async function newRoom() {
  const host = await db.createUser({ provider: 'spotify' });
  const room = await db.as(host).rpc<{ room_id: string; code: string }>('create_room', {
    name: 'Friday',
    playback_provider: 'spotify',
    idempotency_key: newKey(),
  });
  const member = await db.createUser();
  await db.as(member).rpc('join_room_by_code', { code: room.code, idempotency_key: newKey() });
  return { host, member, roomId: room.room_id, code: room.code };
}

const end = (user: TestUser, roomId: string, key = newKey()) =>
  db.as(user).rpc<Ended>('end_room', { room_id: roomId, idempotency_key: key });

const roomRow = async (roomId: string) =>
  (
    await db.query<{ state: string; ended_at: Date | null; code_expires_at: Date }>(
      'select state, ended_at, code_expires_at from public.rooms where id = $1',
      [roomId],
    )
  )[0];

const broadcastsOf = async (roomId: string, event: string) =>
  (await db.broadcasts(roomId)).filter((b) => b.event === event);

describe('end_room', () => {
  it('ends the room and returns when', async () => {
    const { host, roomId } = await newRoom();
    const result = await end(host, roomId);
    expect(Object.keys(result).sort()).toEqual(['ended_at', 'room_id']);
    expect(result.room_id).toBe(roomId);
    const room = await roomRow(roomId);
    expect(room.state).toBe('ended');
    expect(room.ended_at?.toISOString()).toBe(new Date(result.ended_at).toISOString());
    expect(room.code_expires_at.getTime()).toBeLessThanOrEqual(room.ended_at!.getTime());
  });

  it('stops playback', async () => {
    const { host, roomId } = await newRoom();
    await db.query(
      `update public.playback_states set status = 'playing', position_ms = 42000 where room_id = $1`,
      [roomId],
    );
    await end(host, roomId);
    const [playback] = await db.query(
      'select status, reported_by from public.playback_states where room_id = $1',
      [roomId],
    );
    expect(playback).toEqual({ status: 'stopped', reported_by: host.id });
  });

  it('frees the code: it stops working and a new room may draw it', async () => {
    const { host, roomId, code } = await newRoom();
    await end(host, roomId);
    const guest = await db.createUser();
    await expect(
      db.as(guest).rpc('join_room_by_code', { code, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ code: 'code_invalid' });
    // The partial unique index no longer covers the ended room.
    const [other] = await db.query<{ id: string }>(
      `insert into public.rooms (name, host_id, playback_provider, code, code_expires_at)
       values ('Next', $1, 'spotify', $2, now() + interval '1 day') returning id`,
      [host.id, code],
    );
    expect(other.id).toEqual(expect.any(String));
  });

  it('revokes the invite, so the QR code stops working', async () => {
    const { host, roomId } = await newRoom();
    const { token } = await db
      .as(host)
      .rpc<{ token: string }>('create_room_invite', { room_id: roomId, idempotency_key: newKey() });
    await end(host, roomId);
    const [invite] = await db.query<{ revoked: boolean }>(
      'select revoked_at is not null as revoked from public.room_invites where room_id = $1',
      [roomId],
    );
    expect(invite.revoked).toBe(true);
    await expect(
      db.as(await db.createUser()).rpc('join_room_by_invite', { token, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ code: 'room_ended' });
  });

  it('tells the room it ended, with ids only', async () => {
    const { host, roomId } = await newRoom();
    await end(host, roomId);
    const sent = await broadcastsOf(roomId, 'room.ended');
    expect(sent).toHaveLength(1);
    expect(sent[0].private).toBe(true);
    expect(Object.keys(sent[0].payload).sort()).toEqual(['at', 'roomId', 'type', 'v']);
    expect(sent[0].payload).toMatchObject({ v: 1, type: 'room.ended', roomId });
  });

  it('keeps the history readable by its members', async () => {
    const { host, member, roomId } = await newRoom();
    await end(host, roomId);
    expect(await db.as(member).query('select id, state from public.rooms')).toEqual([
      { id: roomId, state: 'ended' },
    ]);
    expect(await db.as(member).query('select user_id from public.room_members')).toHaveLength(2);
  });

  it('blocks every later mutation of the room', async () => {
    const { host, roomId } = await newRoom();
    await end(host, roomId);
    await expect(
      db.as(host).rpc('create_room_invite', { room_id: roomId, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ code: 'room_ended' });
  });

  it('leaves the host’s other rooms alone', async () => {
    const a = await newRoom();
    const second = await db.as(a.host).rpc<{ room_id: string }>('create_room', {
      name: 'Saturday',
      playback_provider: 'spotify',
      idempotency_key: newKey(),
    });
    await end(a.host, a.roomId);
    expect((await roomRow(second.room_id)).state).toBe('live');
  });
});

describe('end_room errors', () => {
  it('needs a signed-in user', async () => {
    const { roomId } = await newRoom();
    await expect(
      db.asServiceRole().rpc('end_room', { room_id: roomId, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ code: 'not_authenticated' });
  });

  it('is not callable by anon', async () => {
    const { roomId } = await newRoom();
    await expect(
      db.asAnon().rpc('end_room', { room_id: roomId, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    expect((await roomRow(roomId)).state).toBe('live');
  });

  it('is for the host only', async () => {
    const { member, roomId } = await newRoom();
    await expect(end(member, roomId)).rejects.toMatchObject({ code: 'not_host', hint: 'qd' });
    await expect(end(await db.createUser(), roomId)).rejects.toMatchObject({
      code: 'not_member',
    });
    expect((await roomRow(roomId)).state).toBe('live');
    expect(await broadcastsOf(roomId, 'room.ended')).toEqual([]);
  });

  it('cannot be done by writing the row directly', async () => {
    const { host, roomId } = await newRoom();
    await expect(
      db
        .as(host)
        .query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [roomId]),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    expect((await roomRow(roomId)).state).toBe('live');
  });

  it('answers room_not_found for a room that does not exist', async () => {
    const host = await db.createUser();
    await expect(end(host, '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      code: 'room_not_found',
    });
  });

  it('answers room_ended with a new key once the room ended', async () => {
    const { host, roomId } = await newRoom();
    await end(host, roomId);
    await expect(end(host, roomId)).rejects.toMatchObject({ code: 'room_ended' });
    expect(await broadcastsOf(roomId, 'room.ended')).toHaveLength(1);
  });

  it('needs an idempotency key and a room', async () => {
    const { host, roomId } = await newRoom();
    await expect(
      db.as(host).rpc('end_room', { room_id: roomId, idempotency_key: null }),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'idempotency_key' } });
    await expect(
      db.as(host).rpc('end_room', { room_id: null, idempotency_key: newKey() }),
    ).rejects.toMatchObject({ code: 'room_not_found' });
  });
});

describe('end_room idempotency', () => {
  it('a retry with the same key succeeds with the same result, without a second broadcast', async () => {
    const { host, roomId } = await newRoom();
    const key = newKey();
    const first = await end(host, roomId, key);
    await expect(end(host, roomId, key)).resolves.toEqual(first);
    await expect(end(host, roomId, key)).resolves.toEqual(first);
    expect(await broadcastsOf(roomId, 'room.ended')).toHaveLength(1);
  });

  it('the same key for another room fails with idempotency_conflict', async () => {
    const a = await newRoom();
    const second = await db.as(a.host).rpc<{ room_id: string }>('create_room', {
      name: 'Saturday',
      playback_provider: 'spotify',
      idempotency_key: newKey(),
    });
    const key = newKey();
    await end(a.host, a.roomId, key);
    await expect(end(a.host, second.room_id, key)).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect((await roomRow(second.room_id)).state).toBe('live');
  });

  it('a rejected call is not stored, so the key works once the caller may end it', async () => {
    const { member, roomId } = await newRoom();
    const key = newKey();
    await expect(end(member, roomId, key)).rejects.toMatchObject({ code: 'not_host' });
    await db.query(`update public.room_members set role = 'member' where room_id = $1`, [roomId]);
    await db.query(
      `update public.room_members set role = 'host' where room_id = $1 and user_id = $2`,
      [roomId, member.id],
    );
    await expect(end(member, roomId, key)).resolves.toMatchObject({ room_id: roomId });
  });

  it('two taps at once end the room once', async () => {
    const { host, roomId } = await newRoom();
    const key = newKey();
    const [a, b] = await Promise.all([end(host, roomId, key), end(host, roomId, key)]);
    expect(a).toEqual(b);
    expect(await broadcastsOf(roomId, 'room.ended')).toHaveLength(1);
  });

  it('two taps with different keys: one ends it, the other gets room_ended', async () => {
    const { host, roomId } = await newRoom();
    const results = await Promise.allSettled([end(host, roomId), end(host, roomId)]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'room_ended' });
  });
});

describe('end_room details (review)', () => {
  it('keeps an expiry that had already passed instead of moving it later', async () => {
    const { host, roomId } = await newRoom();
    await db.query(
      `update public.rooms set code_expires_at = now() - interval '2 hours' where id = $1`,
      [roomId],
    );
    const before = (await roomRow(roomId)).code_expires_at;
    await end(host, roomId);
    expect((await roomRow(roomId)).code_expires_at.getTime()).toBe(before.getTime());
  });

  it('the freed code then joins the new room that drew it, never the ended one', async () => {
    const { host, roomId, code } = await newRoom();
    await end(host, roomId);
    const [next] = await db.query<{ id: string }>(
      `insert into public.rooms (name, host_id, playback_provider, code, code_expires_at)
       values ('Next', $1, 'spotify', $2, now() + interval '1 day') returning id`,
      [host.id, code],
    );
    await db.query(
      `insert into public.room_members (room_id, user_id, role) values ($1, $2, 'host')`,
      [next.id, host.id],
    );
    const guest = await db.createUser();
    await expect(
      db.as(guest).rpc('join_room_by_code', { code, idempotency_key: newKey() }),
    ).resolves.toEqual({ room_id: next.id });
  });

  it('revokes only this room’s invite', async () => {
    const a = await newRoom();
    const b = await newRoom();
    const invite = (room: { host: TestUser; roomId: string }) =>
      db.as(room.host).rpc<{ token: string }>('create_room_invite', {
        room_id: room.roomId,
        idempotency_key: newKey(),
      });
    await invite(a);
    const { token } = await invite(b);
    await end(a.host, a.roomId);
    await expect(
      db.as(await db.createUser()).rpc('join_room_by_invite', { token, idempotency_key: newKey() }),
    ).resolves.toEqual({ room_id: b.roomId });
  });

  it('a refused call changes nothing and announces nothing', async () => {
    const { member, roomId } = await newRoom();
    await db.query("update public.playback_states set status = 'playing' where room_id = $1", [
      roomId,
    ]);
    const before = (await db.broadcasts(roomId)).length;
    await expect(end(member, roomId)).rejects.toMatchObject({ code: 'not_host' });
    expect((await roomRow(roomId)).state).toBe('live');
    expect(await db.broadcasts(roomId)).toHaveLength(before);
    const [{ status }] = await db.query<{ status: string }>(
      'select status from public.playback_states where room_id = $1',
      [roomId],
    );
    expect(status).toBe('playing');
  });
});
