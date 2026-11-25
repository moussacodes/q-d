/**
 * enqueue_recording: a member the add-songs rule allows puts a song at the end
 * of the queue. API_CONTRACTS.md § enqueue_recording.
 */
import { createTestDb, newKey, type TestDb, type TestUser } from './harness/db';
import {
  addMember,
  broadcastCount,
  choose,
  expectQueueInvariants,
  insertRecording,
  queueRows,
  startRoom,
  type EnqueueResult,
} from './harness/queue';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => db.close());

const enqueue = (user: TestUser, args: Record<string, unknown>) =>
  db.as(user).rpc<EnqueueResult>('enqueue_recording', { idempotency_key: newKey(), ...args });

const entryCount = async (roomId: string) => (await queueRows(db, roomId)).length;

describe('enqueue_recording', () => {
  it('starts the song when nothing is playing (queue_length 0, "playing now")', async () => {
    const { host, roomId } = await startRoom(db);
    const recordingId = await insertRecording(db);

    const result = await enqueue(host, { room_id: roomId, recording_id: recordingId });

    expect(Object.keys(result).sort()).toEqual(['entry_id', 'position', 'queue_length']);
    expect(result).toMatchObject({ position: 0, queue_length: 0 });
    expect(await queueRows(db, roomId)).toEqual([
      {
        id: result.entry_id,
        recording_id: recordingId,
        position: 0,
        status: 'playing',
        added_by: host.id,
        batch_id: null,
      },
    ]);
  });

  it('appends later songs in order and reports where each landed', async () => {
    const { host, roomId } = await startRoom(db);
    const member = await addMember(db, roomId);
    const [a, b, c, d] = [
      await insertRecording(db),
      await insertRecording(db),
      await insertRecording(db),
      await insertRecording(db),
    ];

    await enqueue(host, { room_id: roomId, recording_id: a });
    const second = await enqueue(member, { room_id: roomId, recording_id: b });
    const third = await enqueue(host, { room_id: roomId, recording_id: c });
    const fourth = await enqueue(member, { room_id: roomId, recording_id: d });

    expect(second).toMatchObject({ position: 1, queue_length: 1 });
    expect(third).toMatchObject({ position: 2, queue_length: 2 });
    expect(fourth).toMatchObject({ position: 3, queue_length: 3 });

    const rows = await queueRows(db, roomId);
    expect(rows.map((r) => [r.recording_id, r.status, r.added_by])).toEqual([
      [a, 'playing', host.id],
      [b, 'queued', member.id],
      [c, 'queued', host.id],
      [d, 'queued', member.id],
    ]);
    await expectQueueInvariants(db, roomId);
  });

  it('gives every entry its own id, separate from the recording', async () => {
    const { host, roomId } = await startRoom(db);
    const recordingId = await insertRecording(db);
    const first = await enqueue(host, { room_id: roomId, recording_id: recordingId });
    const second = await enqueue(host, {
      room_id: roomId,
      recording_id: recordingId,
      allow_duplicate: true,
    });
    expect(first.entry_id).not.toBe(second.entry_id);
    expect(first.entry_id).not.toBe(recordingId);
  });

  it('sends one queue.changed refetch hint per add, with ids only', async () => {
    const { host, roomId } = await startRoom(db);
    await enqueue(host, { room_id: roomId, recording_id: await insertRecording(db) });
    await enqueue(host, { room_id: roomId, recording_id: await insertRecording(db) });
    const messages = await db.broadcasts(roomId);
    expect(messages.map((m) => m.event)).toEqual(['queue.changed', 'queue.changed']);
    expect(Object.keys(messages[0].payload).sort()).toEqual(['at', 'roomId', 'type', 'v']);
    expect(messages[0]).toMatchObject({ private: true, payload: { v: 1, roomId } });
  });

  it('lets members read the new entry through RLS, and outsiders not', async () => {
    const { host, roomId } = await startRoom(db);
    const member = await addMember(db, roomId);
    const outsider = await db.createUser();
    const { entry_id: entryId } = await enqueue(member, {
      room_id: roomId,
      recording_id: await insertRecording(db),
    });
    const read = (user: TestUser) =>
      db
        .as(user)
        .query<{ id: string }>('select id from public.queue_entries where room_id = $1', [roomId]);
    expect(await read(host)).toEqual([{ id: entryId }]);
    expect(await read(member)).toEqual([{ id: entryId }]);
    expect(await read(outsider)).toEqual([]);
  });

  it('still accepts songs while the room is paused', async () => {
    const { host, roomId } = await startRoom(db);
    await db.query(`update public.rooms set state = 'paused' where id = $1`, [roomId]);
    await expect(
      enqueue(host, { room_id: roomId, recording_id: await insertRecording(db) }),
    ).resolves.toMatchObject({ position: 0 });
  });
});

describe('the add-songs rule', () => {
  it('Everyone: any member adds', async () => {
    const { roomId } = await startRoom(db, { add_songs: 'everyone' });
    const member = await addMember(db, roomId);
    await expect(
      enqueue(member, { room_id: roomId, recording_id: await insertRecording(db) }),
    ).resolves.toMatchObject({ position: 0 });
  });

  it('Only you: members get not_allowed, the host adds', async () => {
    const { host, roomId } = await startRoom(db, { add_songs: 'host' });
    const member = await addMember(db, roomId);
    const recordingId = await insertRecording(db);
    await expect(
      enqueue(member, { room_id: roomId, recording_id: recordingId }),
    ).rejects.toMatchObject({ code: 'not_allowed', hint: 'qd' });
    expect(await entryCount(roomId)).toBe(0);
    await expect(
      enqueue(host, { room_id: roomId, recording_id: recordingId }),
    ).resolves.toBeTruthy();
  });

  it('Chosen: only people chosen for adding songs, plus the host', async () => {
    const { host, roomId } = await startRoom(db, { add_songs: 'chosen', control: 'chosen' });
    const chosen = await addMember(db, roomId);
    const controlsOnly = await addMember(db, roomId);
    const other = await addMember(db, roomId);
    await choose(db, roomId, 'add_songs', chosen);
    await choose(db, roomId, 'control', controlsOnly);

    await expect(
      enqueue(chosen, { room_id: roomId, recording_id: await insertRecording(db) }),
    ).resolves.toBeTruthy();
    await expect(
      enqueue(controlsOnly, { room_id: roomId, recording_id: await insertRecording(db) }),
    ).rejects.toMatchObject({ code: 'not_allowed' });
    await expect(
      enqueue(other, { room_id: roomId, recording_id: await insertRecording(db) }),
    ).rejects.toMatchObject({ code: 'not_allowed' });
    await expect(
      enqueue(host, { room_id: roomId, recording_id: await insertRecording(db) }),
    ).resolves.toBeTruthy();
    expect(await entryCount(roomId)).toBe(2);
  });

  it('follows a rule change straight away', async () => {
    const { roomId } = await startRoom(db);
    const member = await addMember(db, roomId);
    await enqueue(member, { room_id: roomId, recording_id: await insertRecording(db) });
    await db.query(`update public.rooms set add_songs = 'host' where id = $1`, [roomId]);
    await expect(
      enqueue(member, { room_id: roomId, recording_id: await insertRecording(db) }),
    ).rejects.toMatchObject({ code: 'not_allowed' });
  });
});

describe('already in queue', () => {
  it('asks first when the song is queued (details.status = queued)', async () => {
    const { host, roomId } = await startRoom(db);
    const [playing, queued] = [await insertRecording(db), await insertRecording(db)];
    await enqueue(host, { room_id: roomId, recording_id: playing });
    await enqueue(host, { room_id: roomId, recording_id: queued });

    await expect(enqueue(host, { room_id: roomId, recording_id: queued })).rejects.toMatchObject({
      code: 'already_in_queue',
      details: { status: 'queued' },
    });
    expect(await entryCount(roomId)).toBe(2);
  });

  it('asks first when the song is playing (details.status = playing)', async () => {
    const { roomId } = await startRoom(db);
    const member = await addMember(db, roomId);
    const recordingId = await insertRecording(db);
    await enqueue(member, { room_id: roomId, recording_id: recordingId });
    await expect(
      enqueue(member, { room_id: roomId, recording_id: recordingId }),
    ).rejects.toMatchObject({ code: 'already_in_queue', details: { status: 'playing' } });
  });

  it('reports playing when the song is both playing and queued', async () => {
    const { host, roomId } = await startRoom(db);
    const recordingId = await insertRecording(db);
    await enqueue(host, { room_id: roomId, recording_id: recordingId });
    await enqueue(host, { room_id: roomId, recording_id: recordingId, allow_duplicate: true });
    await expect(
      enqueue(host, { room_id: roomId, recording_id: recordingId }),
    ).rejects.toMatchObject({ details: { status: 'playing' } });
  });

  it('adds a second copy once the user confirms (allow_duplicate)', async () => {
    const { host, roomId } = await startRoom(db);
    const recordingId = await insertRecording(db);
    await enqueue(host, { room_id: roomId, recording_id: recordingId });
    const again = await enqueue(host, {
      room_id: roomId,
      recording_id: recordingId,
      allow_duplicate: true,
    });
    expect(again).toMatchObject({ position: 1, queue_length: 1 });
    const rows = await queueRows(db, roomId);
    expect(rows.map((r) => [r.recording_id, r.status])).toEqual([
      [recordingId, 'playing'],
      [recordingId, 'queued'],
    ]);
  });

  it('does not count songs that already played or were removed', async () => {
    const { host, roomId } = await startRoom(db);
    const recordingId = await insertRecording(db);
    const first = await enqueue(host, { room_id: roomId, recording_id: recordingId });
    await db.query(`update public.queue_entries set status = 'played' where id = $1`, [
      first.entry_id,
    ]);
    const second = await enqueue(host, { room_id: roomId, recording_id: recordingId });
    expect(second.position).toBe(0);
    await enqueue(host, { room_id: roomId, recording_id: await insertRecording(db) });
    const third = await enqueue(host, {
      room_id: roomId,
      recording_id: recordingId,
      allow_duplicate: true,
    });
    await db.query(`update public.queue_entries set status = 'removed' where id = $1`, [
      third.entry_id,
    ]);
    await db.query(`update public.queue_entries set status = 'played' where id = $1`, [
      second.entry_id,
    ]);
    await expect(
      enqueue(host, { room_id: roomId, recording_id: recordingId }),
    ).resolves.toBeTruthy();
  });

  it('is per room: the same song can wait in two rooms', async () => {
    const one = await startRoom(db);
    const two = await startRoom(db);
    const recordingId = await insertRecording(db);
    await enqueue(one.host, { room_id: one.roomId, recording_id: recordingId });
    await expect(
      enqueue(two.host, { room_id: two.roomId, recording_id: recordingId }),
    ).resolves.toMatchObject({ position: 0 });
  });
});

describe('idempotency', () => {
  it('a replay returns the stored result without adding again or re-broadcasting', async () => {
    const { host, roomId } = await startRoom(db);
    await enqueue(host, { room_id: roomId, recording_id: await insertRecording(db) });
    const args = {
      room_id: roomId,
      recording_id: await insertRecording(db),
      idempotency_key: newKey(),
    };
    const first = await db.as(host).rpc('enqueue_recording', args);
    const second = await db.as(host).rpc('enqueue_recording', args);
    expect(second).toEqual(first);
    expect(await entryCount(roomId)).toBe(2);
    expect(await broadcastCount(db, roomId, 'queue.changed')).toBe(2);
  });

  it('a replay is answered even after the song itself became a duplicate', async () => {
    // Without the replay check first, the retry would fail with already_in_queue.
    const { host, roomId } = await startRoom(db);
    const args = {
      room_id: roomId,
      recording_id: await insertRecording(db),
      idempotency_key: newKey(),
    };
    const first = await db.as(host).rpc('enqueue_recording', args);
    await expect(db.as(host).rpc('enqueue_recording', args)).resolves.toEqual(first);
  });

  it('a replay is answered after the room ended', async () => {
    const { host, roomId } = await startRoom(db);
    const args = {
      room_id: roomId,
      recording_id: await insertRecording(db),
      idempotency_key: newKey(),
    };
    const first = await db.as(host).rpc('enqueue_recording', args);
    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
      roomId,
    ]);
    await expect(db.as(host).rpc('enqueue_recording', args)).resolves.toEqual(first);
  });

  it('the same key with another song fails with idempotency_conflict', async () => {
    const { host, roomId } = await startRoom(db);
    const key = newKey();
    await enqueue(host, {
      room_id: roomId,
      recording_id: await insertRecording(db),
      idempotency_key: key,
    });
    await expect(
      enqueue(host, {
        room_id: roomId,
        recording_id: await insertRecording(db),
        idempotency_key: key,
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    expect(await entryCount(roomId)).toBe(1);
  });

  it('the same key with allow_duplicate changed fails with idempotency_conflict', async () => {
    const { host, roomId } = await startRoom(db);
    const recordingId = await insertRecording(db);
    const key = newKey();
    await enqueue(host, { room_id: roomId, recording_id: recordingId, idempotency_key: key });
    await expect(
      enqueue(host, {
        room_id: roomId,
        recording_id: recordingId,
        allow_duplicate: true,
        idempotency_key: key,
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('a rejected already_in_queue stores nothing, so the confirmed retry may reuse the key', async () => {
    const { host, roomId } = await startRoom(db);
    const recordingId = await insertRecording(db);
    await enqueue(host, { room_id: roomId, recording_id: recordingId });
    const key = newKey();
    await expect(
      enqueue(host, { room_id: roomId, recording_id: recordingId, idempotency_key: key }),
    ).rejects.toMatchObject({ code: 'already_in_queue' });
    await expect(
      enqueue(host, {
        room_id: roomId,
        recording_id: recordingId,
        allow_duplicate: true,
        idempotency_key: key,
      }),
    ).resolves.toMatchObject({ position: 1 });
  });

  it('keys belong to one user: two people may use the same key', async () => {
    const { host, roomId } = await startRoom(db);
    const member = await addMember(db, roomId);
    const key = newKey();
    await enqueue(host, {
      room_id: roomId,
      recording_id: await insertRecording(db),
      idempotency_key: key,
    });
    await enqueue(member, {
      room_id: roomId,
      recording_id: await insertRecording(db),
      idempotency_key: key,
    });
    expect(await entryCount(roomId)).toBe(2);
  });
});

describe('errors', () => {
  it('needs a signed-in user', async () => {
    const { roomId } = await startRoom(db);
    await expect(
      db.asServiceRole().rpc('enqueue_recording', {
        room_id: roomId,
        recording_id: await insertRecording(db),
        idempotency_key: newKey(),
      }),
    ).rejects.toMatchObject({ code: 'not_authenticated' });
  });

  it('is not callable by anon', async () => {
    const { roomId } = await startRoom(db);
    await expect(
      db.asAnon().rpc('enqueue_recording', {
        room_id: roomId,
        recording_id: await insertRecording(db),
        idempotency_key: newKey(),
      }),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('room_not_found for a room that does not exist', async () => {
    const user = await db.createUser();
    await expect(
      enqueue(user, {
        room_id: '00000000-0000-0000-0000-000000000000',
        recording_id: await insertRecording(db),
      }),
    ).rejects.toMatchObject({ code: 'room_not_found' });
  });

  it('room_ended once the room has ended', async () => {
    const { host, roomId } = await startRoom(db);
    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
      roomId,
    ]);
    await expect(
      enqueue(host, { room_id: roomId, recording_id: await insertRecording(db) }),
    ).rejects.toMatchObject({ code: 'room_ended' });
  });

  it('not_member for someone outside the room, and nothing is added or sent', async () => {
    const { roomId } = await startRoom(db);
    const outsider = await db.createUser();
    await expect(
      enqueue(outsider, { room_id: roomId, recording_id: await insertRecording(db) }),
    ).rejects.toMatchObject({ code: 'not_member' });
    expect(await entryCount(roomId)).toBe(0);
    expect(await db.broadcasts(roomId)).toEqual([]);
  });

  it('checks membership before the rule: an outsider in a host-only room gets not_member', async () => {
    const { roomId } = await startRoom(db, { add_songs: 'host' });
    const outsider = await db.createUser();
    await expect(
      enqueue(outsider, { room_id: roomId, recording_id: await insertRecording(db) }),
    ).rejects.toMatchObject({ code: 'not_member' });
  });

  it.each([
    ['room_id', { room_id: null }],
    ['recording_id', { recording_id: null }],
    ['allow_duplicate', { allow_duplicate: null }],
    ['idempotency_key', { idempotency_key: null }],
  ])('invalid_input when %s is missing', async (field, override) => {
    const { host, roomId } = await startRoom(db);
    await expect(
      enqueue(host, { room_id: roomId, recording_id: await insertRecording(db), ...override }),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field } });
    expect(await entryCount(roomId)).toBe(0);
  });

  it('invalid_input for a recording that does not exist', async () => {
    const { host, roomId } = await startRoom(db);
    await expect(
      enqueue(host, { room_id: roomId, recording_id: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'recording_id' } });
  });

  it('clients still cannot insert queue entries directly', async () => {
    const { host, roomId } = await startRoom(db);
    await expect(
      db.as(host).query(
        `insert into public.queue_entries (room_id, recording_id, position, added_by)
         values ($1, $2, 1, $3)`,
        [roomId, await insertRecording(db), host.id],
      ),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });
});

describe('queue positions', () => {
  it('a duplicate queued position is impossible, whatever writes it', async () => {
    const { host, roomId } = await startRoom(db);
    await enqueue(host, { room_id: roomId, recording_id: await insertRecording(db) });
    await enqueue(host, { room_id: roomId, recording_id: await insertRecording(db) });
    await expect(
      db.query(
        `insert into public.queue_entries (room_id, recording_id, position, added_by)
         values ($1, $2, 1, $3)`,
        [roomId, await insertRecording(db), host.id],
      ),
    ).rejects.toMatchObject({ sqlstate: '23505' });
  });

  it('only the room lock decides the order: many adds stay 1..n', async () => {
    const { host, roomId } = await startRoom(db);
    for (let i = 0; i < 12; i += 1) {
      await enqueue(host, { room_id: roomId, recording_id: await insertRecording(db) });
    }
    await expectQueueInvariants(db, roomId);
    expect((await queueRows(db, roomId)).filter((r) => r.status === 'queued')).toHaveLength(11);
  });
});
