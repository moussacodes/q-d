/**
 * Realtime Broadcast and Presence, server side (API_CONTRACTS.md §4). The
 * RPCs send versioned refetch hints from inside their transaction, and only
 * the room's members can receive them. This checks what the app's Realtime
 * service (src/services/realtime.ts) relies on:
 *
 * - every room change sends the event the client maps to its queries;
 * - every payload parses with the app's versioned schema and carries ids,
 *   the version and a time only, never names, codes or songs;
 * - a refused change sends nothing (it rolled back);
 * - only members can receive the channel, including `room.ended`.
 *
 * PGlite runs the Supabase shim's `realtime.messages` (supabase/tests/harness),
 * so this checks the policies and the messages, not the Realtime server's
 * socket. That needs `supabase start` on the Mac.
 */
import { parseRoomEvent } from '../../src/domain/realtime';
import { createTestDb, newKey, type TestDb, type TestUser } from './harness/db';
import { insertRecording, startRoom } from './harness/queue';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => db.close());

const events = async (roomId: string) => (await db.broadcasts(roomId)).map((b) => b.event);

async function roomWithGuest() {
  const { host, roomId } = await startRoom(db);
  const [{ code }] = await db.query<{ code: string }>(
    'select code from public.rooms where id = $1',
    [roomId],
  );
  const guest = await db.createUser();
  await db.as(guest).rpc('join_room_by_code', { code, idempotency_key: newKey() });
  return { host, guest, roomId, code };
}

const enqueue = (user: TestUser, roomId: string, recordingId: string) =>
  db.as(user).rpc<{ entry_id: string }>('enqueue_recording', {
    room_id: roomId,
    recording_id: recordingId,
    idempotency_key: newKey(),
  });

describe('what each RPC broadcasts', () => {
  it('create_room sends nothing: nobody else is in the room yet', async () => {
    const { roomId } = await startRoom(db);
    expect(await events(roomId)).toEqual([]);
  });

  it('join_room_by_code sends members.changed', async () => {
    const { roomId } = await roomWithGuest();
    expect(await events(roomId)).toEqual(['members.changed']);
  });

  it('enqueue, reorder and remove each send queue.changed', async () => {
    const { host, roomId } = await roomWithGuest();
    await enqueue(host, roomId, await insertRecording(db));
    const second = await enqueue(host, roomId, await insertRecording(db));
    const third = await enqueue(host, roomId, await insertRecording(db));
    await db.as(host).rpc('reorder_queue', {
      room_id: roomId,
      entry_id: third.entry_id,
      after_entry_id: null,
      idempotency_key: newKey(),
    });
    await db.as(host).rpc('remove_queue_entry', {
      room_id: roomId,
      entry_id: second.entry_id,
      idempotency_key: newKey(),
    });
    expect(await events(roomId)).toEqual([
      'members.changed',
      'queue.changed',
      'queue.changed',
      'queue.changed',
      'queue.changed',
      'queue.changed',
    ]);
  });

  it('end_room sends room.ended', async () => {
    const { host, roomId } = await roomWithGuest();
    await db.as(host).rpc('end_room', { room_id: roomId, idempotency_key: newKey() });
    expect((await events(roomId)).at(-1)).toBe('room.ended');
  });

  it('a refused change sends nothing, because it rolled back', async () => {
    const { guest, roomId } = await roomWithGuest();
    const before = await events(roomId);
    // The default control rule is host only.
    const recording = await insertRecording(db);
    const { entry_id } = await enqueue(guest, roomId, recording);
    const afterAdd = await events(roomId);
    await expect(
      db.as(guest).rpc('remove_queue_entry', {
        room_id: roomId,
        entry_id: '00000000-0000-4000-8000-000000000000',
        idempotency_key: newKey(),
      }),
    ).rejects.toMatchObject({ code: 'entry_not_found' });
    expect(entry_id).toBeTruthy();
    expect(afterAdd).toEqual([...before, 'queue.changed']);
    expect(await events(roomId)).toEqual(afterAdd);
  });

  it('a replayed request sends nothing again', async () => {
    const { host, roomId } = await roomWithGuest();
    const key = newKey();
    const args = { room_id: roomId, recording_id: await insertRecording(db), idempotency_key: key };
    await db.as(host).rpc('enqueue_recording', args);
    const once = await events(roomId);
    await db.as(host).rpc('enqueue_recording', args);
    expect(await events(roomId)).toEqual(once);
  });
});

describe('payloads', () => {
  it('every event parses with the app’s versioned schema, for its own room', async () => {
    const { host, roomId } = await roomWithGuest();
    await enqueue(host, roomId, await insertRecording(db));
    await db.as(host).rpc('end_room', { room_id: roomId, idempotency_key: newKey() });
    const broadcasts = await db.broadcasts(roomId);
    expect(broadcasts.length).toBeGreaterThan(0);
    for (const broadcast of broadcasts) {
      const parsed = parseRoomEvent(broadcast.payload, roomId);
      expect(parsed).toMatchObject({ ok: true, value: { type: broadcast.event, roomId } });
      expect(broadcast.private).toBe(true);
    }
  });

  it('carry the version, type, room id and time, and nothing else', async () => {
    const { host, roomId, code } = await roomWithGuest();
    await enqueue(host, roomId, await insertRecording(db, 'A Song Title'));
    for (const { payload } of await db.broadcasts(roomId)) {
      expect(Object.keys(payload).sort()).toEqual(['at', 'roomId', 'type', 'v']);
      const text = JSON.stringify(payload);
      expect(text).not.toContain('A Song Title');
      expect(text).not.toContain(code);
      expect(text).not.toContain(host.id);
    }
  });
});

describe('who receives them (Realtime Authorization)', () => {
  const listen = (user: TestUser, roomId: string) =>
    db.as(user, { 'realtime.topic': `room:${roomId}` });

  it('members of an ended room still receive room.ended, so their phones leave honestly', async () => {
    const { host, guest, roomId } = await roomWithGuest();
    await db.as(host).rpc('end_room', { room_id: roomId, idempotency_key: newKey() });
    const rows = await listen(guest, roomId).query<{ event: string }>(
      'select event from realtime.messages',
    );
    expect(rows.map((row) => row.event)).toContain('room.ended');
  });

  it('someone who isn’t in the room receives nothing, even with the room id', async () => {
    const { host, roomId } = await roomWithGuest();
    await enqueue(host, roomId, await insertRecording(db));
    const outsider = await db.createUser();
    expect(await listen(outsider, roomId).query('select * from realtime.messages')).toEqual([]);
  });

  it('a member can’t read another room’s channel by naming it as the topic', async () => {
    const first = await roomWithGuest();
    const second = await roomWithGuest();
    await enqueue(second.host, second.roomId, await insertRecording(db));
    const rows = await db
      .as(first.guest, { 'realtime.topic': `room:${second.roomId}` })
      .query('select * from realtime.messages');
    expect(rows).toEqual([]);
  });

  it('members may track presence on their room, outsiders may not, and nobody broadcasts', async () => {
    const { guest, roomId } = await roomWithGuest();
    const outsider = await db.createUser();
    const send = (user: TestUser, extension: 'presence' | 'broadcast') =>
      listen(user, roomId).query(
        `insert into realtime.messages (topic, extension, event, payload, private)
         values ($1, $2, 'sync', '{}', true)`,
        [`room:${roomId}`, extension],
      );
    await send(guest, 'presence');
    await expect(send(guest, 'broadcast')).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(send(outsider, 'presence')).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('anonymous clients receive nothing', async () => {
    const { roomId } = await roomWithGuest();
    const rows = await db
      .asAnon()
      .query('select * from realtime.messages where topic = $1', [`room:${roomId}`])
      .catch(() => []);
    expect(rows).toEqual([]);
  });
});
