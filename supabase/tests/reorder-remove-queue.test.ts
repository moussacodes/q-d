/**
 * reorder_queue and remove_queue_entry: the control rule decides who may, the
 * person who added a waiting entry may take it back (Undo), and retries are
 * safe. API_CONTRACTS.md § reorder_queue, § remove_queue_entry.
 */
import { createTestDb, newKey, type TestDb, type TestUser } from './harness/db';
import {
  addMember,
  broadcastCount,
  choose,
  expectQueueInvariants,
  insertRecording,
  playingId,
  queuedIds,
  queueRows,
  startRoom,
  type Audience,
  type EnqueueResult,
} from './harness/queue';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => db.close());

type ReorderResult = { entry_id: string; position: number; queue_length: number };
type RemoveResult = { entry_id: string; queue_length: number };

const add = async (user: TestUser, roomId: string) =>
  (
    await db.as(user).rpc<EnqueueResult>('enqueue_recording', {
      room_id: roomId,
      recording_id: await insertRecording(db),
      idempotency_key: newKey(),
    })
  ).entry_id;

/** A room with one song playing and `waiting` songs queued (added by `adder`, or the host). */
async function roomWithQueue(
  waiting: number,
  rules: { add_songs?: Audience; control?: Audience } = {},
) {
  const { host, roomId } = await startRoom(db, rules);
  const member = await addMember(db, roomId);
  const playing = await add(host, roomId);
  const queued: string[] = [];
  for (let i = 0; i < waiting; i += 1) queued.push(await add(host, roomId));
  return { host, member, roomId, playing, queued };
}

const reorder = (user: TestUser, args: Record<string, unknown>) =>
  db.as(user).rpc<ReorderResult>('reorder_queue', { idempotency_key: newKey(), ...args });

const remove = (user: TestUser, args: Record<string, unknown>) =>
  db.as(user).rpc<RemoveResult>('remove_queue_entry', { idempotency_key: newKey(), ...args });

describe('reorder_queue', () => {
  it('moves an entry down, after another one', async () => {
    const { host, roomId, queued } = await roomWithQueue(5);
    const [a, b, c, d, e] = queued;
    const result = await reorder(host, { room_id: roomId, entry_id: b, after_entry_id: d });
    expect(result).toEqual({ entry_id: b, position: 4, queue_length: 5 });
    expect(await queuedIds(db, roomId)).toEqual([a, c, d, b, e]);
    await expectQueueInvariants(db, roomId);
  });

  it('moves an entry up, after another one', async () => {
    const { host, roomId, queued } = await roomWithQueue(5);
    const [a, b, c, d, e] = queued;
    const result = await reorder(host, { room_id: roomId, entry_id: e, after_entry_id: a });
    expect(result.position).toBe(2);
    expect(await queuedIds(db, roomId)).toEqual([a, e, b, c, d]);
    await expectQueueInvariants(db, roomId);
  });

  it('moves an entry to the top with after_entry_id null', async () => {
    const { host, roomId, queued } = await roomWithQueue(4);
    const [a, b, c, d] = queued;
    expect(
      (await reorder(host, { room_id: roomId, entry_id: d, after_entry_id: null })).position,
    ).toBe(1);
    expect(await queuedIds(db, roomId)).toEqual([d, a, b, c]);
  });

  it('moves an entry to the end, after the last one', async () => {
    const { host, roomId, queued } = await roomWithQueue(4);
    const [a, b, c, d] = queued;
    expect(
      (await reorder(host, { room_id: roomId, entry_id: a, after_entry_id: d })).position,
    ).toBe(4);
    expect(await queuedIds(db, roomId)).toEqual([b, c, d, a]);
  });

  it('treats "after the playing song" as the top', async () => {
    const { host, roomId, playing, queued } = await roomWithQueue(3);
    const [a, b, c] = queued;
    await reorder(host, { room_id: roomId, entry_id: c, after_entry_id: playing });
    expect(await queuedIds(db, roomId)).toEqual([c, a, b]);
    expect(await playingId(db, roomId)).toBe(playing);
  });

  it('a move to where the entry already is changes nothing and sends nothing', async () => {
    const { host, roomId, queued } = await roomWithQueue(3);
    const [a, b] = queued;
    const before = await broadcastCount(db, roomId, 'queue.changed');
    expect(
      (await reorder(host, { room_id: roomId, entry_id: b, after_entry_id: a })).position,
    ).toBe(2);
    expect(
      (await reorder(host, { room_id: roomId, entry_id: a, after_entry_id: null })).position,
    ).toBe(1);
    expect(await queuedIds(db, roomId)).toEqual(queued);
    expect(await broadcastCount(db, roomId, 'queue.changed')).toBe(before);
  });

  it('sends queue.changed when the order changes', async () => {
    const { host, roomId, queued } = await roomWithQueue(2);
    const before = await broadcastCount(db, roomId, 'queue.changed');
    await reorder(host, { room_id: roomId, entry_id: queued[1], after_entry_id: null });
    expect(await broadcastCount(db, roomId, 'queue.changed')).toBe(before + 1);
  });

  it('keeps 1..n through many moves', async () => {
    const { host, roomId, queued } = await roomWithQueue(8);
    const model = [...queued];
    const moves: [number, number | null][] = [
      [7, null],
      [0, 5],
      [3, 1],
      [6, 2],
      [2, 7],
      [5, null],
    ];
    for (const [from, after] of moves) {
      const id = model[from];
      const afterId = after === null ? null : model[after];
      await reorder(host, { room_id: roomId, entry_id: id, after_entry_id: afterId });
      model.splice(from, 1);
      model.splice(afterId === null ? 0 : model.indexOf(afterId) + 1, 0, id);
      expect(await queuedIds(db, roomId)).toEqual(model);
      await expectQueueInvariants(db, roomId);
    }
  });

  describe('the control rule', () => {
    it('Only you (default): members get not_allowed, even for their own song', async () => {
      const { member, roomId, queued } = await roomWithQueue(2);
      const own = await add(member, roomId);
      await expect(
        reorder(member, { room_id: roomId, entry_id: queued[1], after_entry_id: null }),
      ).rejects.toMatchObject({ code: 'not_allowed' });
      await expect(
        reorder(member, { room_id: roomId, entry_id: own, after_entry_id: null }),
      ).rejects.toMatchObject({ code: 'not_allowed' });
      expect(await queuedIds(db, roomId)).toEqual([...queued, own]);
    });

    it('Everyone: any member reorders', async () => {
      const { member, roomId, queued } = await roomWithQueue(2, { control: 'everyone' });
      await reorder(member, { room_id: roomId, entry_id: queued[1], after_entry_id: null });
      expect(await queuedIds(db, roomId)).toEqual([queued[1], queued[0]]);
    });

    it('Chosen: people chosen for controls reorder; adds-songs picks do not count', async () => {
      const { roomId, queued } = await roomWithQueue(2, { control: 'chosen', add_songs: 'chosen' });
      const controller = await addMember(db, roomId);
      const adder = await addMember(db, roomId);
      await choose(db, roomId, 'control', controller);
      await choose(db, roomId, 'add_songs', adder);
      await expect(
        reorder(adder, { room_id: roomId, entry_id: queued[1], after_entry_id: null }),
      ).rejects.toMatchObject({ code: 'not_allowed' });
      await expect(
        reorder(controller, { room_id: roomId, entry_id: queued[1], after_entry_id: null }),
      ).resolves.toMatchObject({ position: 1 });
    });

    it('not_member for outsiders, before anything about the entry', async () => {
      const { roomId } = await roomWithQueue(1);
      const outsider = await db.createUser();
      await expect(
        reorder(outsider, {
          room_id: roomId,
          entry_id: '00000000-0000-0000-0000-000000000000',
          after_entry_id: null,
        }),
      ).rejects.toMatchObject({ code: 'not_member' });
    });
  });

  describe('errors', () => {
    it('entry_not_found for an entry that was removed, played, or never here', async () => {
      const { host, roomId, queued } = await roomWithQueue(3);
      const other = await roomWithQueue(1);
      await db.query(`update public.queue_entries set status = 'removed' where id = $1`, [
        queued[0],
      ]);
      await db.query(`update public.queue_entries set status = 'played' where id = $1`, [
        queued[1],
      ]);
      for (const id of [queued[0], queued[1], other.queued[0]]) {
        await expect(
          reorder(host, { room_id: roomId, entry_id: id, after_entry_id: null }),
        ).rejects.toMatchObject({ code: 'entry_not_found', details: { field: 'entry_id' } });
      }
    });

    it('stale_state for the entry that is playing now', async () => {
      const { host, roomId, playing, queued } = await roomWithQueue(2);
      await expect(
        reorder(host, { room_id: roomId, entry_id: playing, after_entry_id: queued[1] }),
      ).rejects.toMatchObject({
        code: 'stale_state',
        details: { field: 'entry_id', status: 'playing' },
      });
    });

    it('stale_state when the entry to follow was removed or played since', async () => {
      const { host, roomId, queued } = await roomWithQueue(3);
      await db.query(`update public.queue_entries set status = 'removed' where id = $1`, [
        queued[0],
      ]);
      await expect(
        reorder(host, { room_id: roomId, entry_id: queued[2], after_entry_id: queued[0] }),
      ).rejects.toMatchObject({
        code: 'stale_state',
        details: { field: 'after_entry_id', status: 'removed' },
      });
    });

    it('entry_not_found when the entry to follow is not in this room', async () => {
      const { host, roomId, queued } = await roomWithQueue(2);
      const other = await roomWithQueue(1);
      await expect(
        reorder(host, { room_id: roomId, entry_id: queued[0], after_entry_id: other.queued[0] }),
      ).rejects.toMatchObject({ code: 'entry_not_found', details: { field: 'after_entry_id' } });
    });

    it.each([
      ['room_id', { room_id: null }],
      ['entry_id', { entry_id: null }],
      ['idempotency_key', { idempotency_key: null }],
    ])('invalid_input when %s is missing', async (field, override) => {
      const { host, roomId, queued } = await roomWithQueue(2);
      await expect(
        reorder(host, { room_id: roomId, entry_id: queued[1], after_entry_id: null, ...override }),
      ).rejects.toMatchObject({ code: 'invalid_input', details: { field } });
    });

    it('invalid_input for moving an entry after itself', async () => {
      const { host, roomId, queued } = await roomWithQueue(2);
      await expect(
        reorder(host, { room_id: roomId, entry_id: queued[0], after_entry_id: queued[0] }),
      ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'after_entry_id' } });
    });

    it('room_not_found, room_ended, sign-in and anon', async () => {
      const { host, roomId, queued } = await roomWithQueue(2);
      const args = { entry_id: queued[1], after_entry_id: null };
      await expect(
        reorder(host, { room_id: '00000000-0000-0000-0000-000000000000', ...args }),
      ).rejects.toMatchObject({ code: 'room_not_found' });
      await expect(
        db
          .asServiceRole()
          .rpc('reorder_queue', { room_id: roomId, ...args, idempotency_key: newKey() }),
      ).rejects.toMatchObject({ code: 'not_authenticated' });
      await expect(
        db.asAnon().rpc('reorder_queue', { room_id: roomId, ...args, idempotency_key: newKey() }),
      ).rejects.toMatchObject({ sqlstate: '42501' });
      await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
        roomId,
      ]);
      await expect(reorder(host, { room_id: roomId, ...args })).rejects.toMatchObject({
        code: 'room_ended',
      });
    });
  });

  describe('retries', () => {
    it('a replay returns the stored result and does not move the entry again', async () => {
      const { host, roomId, queued } = await roomWithQueue(4);
      const [a, b, c, d] = queued;
      const args = { room_id: roomId, entry_id: d, after_entry_id: a, idempotency_key: newKey() };
      const first = await db.as(host).rpc('reorder_queue', args);
      // Someone else moves things in between; the replay must not re-apply.
      await reorder(host, { room_id: roomId, entry_id: c, after_entry_id: null });
      const order = await queuedIds(db, roomId);
      expect(order).toEqual([c, a, d, b]);
      await expect(db.as(host).rpc('reorder_queue', args)).resolves.toEqual(first);
      expect(await queuedIds(db, roomId)).toEqual(order);
    });

    it('a replay is answered after the entry was removed', async () => {
      const { host, roomId, queued } = await roomWithQueue(2);
      const args = {
        room_id: roomId,
        entry_id: queued[1],
        after_entry_id: null,
        idempotency_key: newKey(),
      };
      const first = await db.as(host).rpc('reorder_queue', args);
      await remove(host, { room_id: roomId, entry_id: queued[1] });
      await expect(db.as(host).rpc('reorder_queue', args)).resolves.toEqual(first);
    });

    it('the same key with another target fails with idempotency_conflict', async () => {
      const { host, roomId, queued } = await roomWithQueue(3);
      const key = newKey();
      await reorder(host, {
        room_id: roomId,
        entry_id: queued[2],
        after_entry_id: null,
        idempotency_key: key,
      });
      await expect(
        reorder(host, {
          room_id: roomId,
          entry_id: queued[2],
          after_entry_id: queued[0],
          idempotency_key: key,
        }),
      ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    });
  });
});

describe('remove_queue_entry', () => {
  it('removes a waiting entry and closes the gap', async () => {
    const { host, roomId, queued } = await roomWithQueue(4);
    const [a, b, c, d] = queued;
    const result = await remove(host, { room_id: roomId, entry_id: b });
    expect(result).toEqual({ entry_id: b, queue_length: 3 });
    expect(await queuedIds(db, roomId)).toEqual([a, c, d]);
    const removed = (await queueRows(db, roomId)).find((r) => r.id === b);
    expect(removed?.status).toBe('removed');
    await expectQueueInvariants(db, roomId);
  });

  it('removes the first and the last entries too', async () => {
    const { host, roomId, queued } = await roomWithQueue(3);
    await remove(host, { room_id: roomId, entry_id: queued[0] });
    await remove(host, { room_id: roomId, entry_id: queued[2] });
    expect(await queuedIds(db, roomId)).toEqual([queued[1]]);
    await expectQueueInvariants(db, roomId);
  });

  it('keeps the row for history and sends queue.changed', async () => {
    const { host, roomId, queued } = await roomWithQueue(1);
    const before = await broadcastCount(db, roomId, 'queue.changed');
    await remove(host, { room_id: roomId, entry_id: queued[0] });
    expect(await queueRows(db, roomId)).toHaveLength(2);
    expect(await broadcastCount(db, roomId, 'queue.changed')).toBe(before + 1);
  });

  it('lets the song be added again without "Already in queue"', async () => {
    const { host, roomId } = await roomWithQueue(0);
    const recordingId = await insertRecording(db);
    const { entry_id: entryId } = await db.as(host).rpc<EnqueueResult>('enqueue_recording', {
      room_id: roomId,
      recording_id: recordingId,
      idempotency_key: newKey(),
    });
    await remove(host, { room_id: roomId, entry_id: entryId });
    await expect(
      db.as(host).rpc('enqueue_recording', {
        room_id: roomId,
        recording_id: recordingId,
        idempotency_key: newKey(),
      }),
    ).resolves.toMatchObject({ position: 1 });
  });

  describe('who may', () => {
    it('Only you (default): the host removes anyone’s entry; members get not_allowed', async () => {
      const { host, member, roomId, queued } = await roomWithQueue(2);
      const memberSong = await add(member, roomId);
      await expect(remove(member, { room_id: roomId, entry_id: queued[0] })).rejects.toMatchObject({
        code: 'not_allowed',
      });
      await expect(remove(host, { room_id: roomId, entry_id: memberSong })).resolves.toMatchObject({
        entry_id: memberSong,
      });
    });

    it('Undo: the person who added a waiting entry removes it, whatever the rule', async () => {
      const { member, roomId } = await roomWithQueue(1, { control: 'host' });
      const own = await add(member, roomId);
      await expect(remove(member, { room_id: roomId, entry_id: own })).resolves.toMatchObject({
        entry_id: own,
      });
    });

    it('Undo ends once the song plays: stale_state', async () => {
      const { roomId } = await startRoom(db);
      const member = await addMember(db, roomId);
      const own = await add(member, roomId); // empty room, so it plays at once
      await expect(remove(member, { room_id: roomId, entry_id: own })).rejects.toMatchObject({
        code: 'stale_state',
        details: { status: 'playing' },
      });
    });

    it('Everyone: any member removes any waiting entry', async () => {
      const { member, roomId, queued } = await roomWithQueue(2, { control: 'everyone' });
      await expect(remove(member, { room_id: roomId, entry_id: queued[0] })).resolves.toBeTruthy();
    });

    it('Chosen: people chosen for controls remove; others only their own', async () => {
      const { roomId, queued } = await roomWithQueue(3, { control: 'chosen' });
      const controller = await addMember(db, roomId);
      const other = await addMember(db, roomId);
      await choose(db, roomId, 'control', controller);
      await choose(db, roomId, 'add_songs', other);
      const own = await add(other, roomId);
      await expect(remove(other, { room_id: roomId, entry_id: queued[0] })).rejects.toMatchObject({
        code: 'not_allowed',
      });
      await expect(remove(other, { room_id: roomId, entry_id: own })).resolves.toBeTruthy();
      await expect(
        remove(controller, { room_id: roomId, entry_id: queued[0] }),
      ).resolves.toBeTruthy();
    });

    it('not_member for outsiders', async () => {
      const { roomId, queued } = await roomWithQueue(1);
      const outsider = await db.createUser();
      await expect(
        remove(outsider, { room_id: roomId, entry_id: queued[0] }),
      ).rejects.toMatchObject({ code: 'not_member' });
    });

    it('clients cannot delete or update entries directly, even the host', async () => {
      const { host, roomId, queued } = await roomWithQueue(1);
      await expect(
        db.as(host).query('delete from public.queue_entries where id = $1', [queued[0]]),
      ).rejects.toMatchObject({ sqlstate: '42501' });
      await expect(
        db
          .as(host)
          .query(`update public.queue_entries set status = 'removed' where id = $1`, [queued[0]]),
      ).rejects.toMatchObject({ sqlstate: '42501' });
      expect(await queuedIds(db, roomId)).toEqual(queued);
    });
  });

  describe('errors', () => {
    it('entry_not_found for an entry already removed, played, or in another room', async () => {
      const { host, roomId, queued } = await roomWithQueue(2);
      const other = await roomWithQueue(1);
      await remove(host, { room_id: roomId, entry_id: queued[0] });
      await db.query(`update public.queue_entries set status = 'played' where id = $1`, [
        queued[1],
      ]);
      for (const id of [queued[0], queued[1], other.queued[0]]) {
        await expect(remove(host, { room_id: roomId, entry_id: id })).rejects.toMatchObject({
          code: 'entry_not_found',
        });
      }
    });

    it('stale_state for the playing entry, even for the host (Skip is advance_queue)', async () => {
      const { host, roomId, playing } = await roomWithQueue(1);
      await expect(remove(host, { room_id: roomId, entry_id: playing })).rejects.toMatchObject({
        code: 'stale_state',
      });
    });

    it.each([
      ['room_id', { room_id: null }],
      ['entry_id', { entry_id: null }],
      ['idempotency_key', { idempotency_key: null }],
    ])('invalid_input when %s is missing', async (field, override) => {
      const { host, roomId, queued } = await roomWithQueue(1);
      await expect(
        remove(host, { room_id: roomId, entry_id: queued[0], ...override }),
      ).rejects.toMatchObject({ code: 'invalid_input', details: { field } });
    });

    it('room_not_found, room_ended, sign-in and anon', async () => {
      const { host, roomId, queued } = await roomWithQueue(1);
      await expect(
        remove(host, { room_id: '00000000-0000-0000-0000-000000000000', entry_id: queued[0] }),
      ).rejects.toMatchObject({ code: 'room_not_found' });
      const args = { room_id: roomId, entry_id: queued[0], idempotency_key: newKey() };
      await expect(db.asServiceRole().rpc('remove_queue_entry', args)).rejects.toMatchObject({
        code: 'not_authenticated',
      });
      await expect(db.asAnon().rpc('remove_queue_entry', args)).rejects.toMatchObject({
        sqlstate: '42501',
      });
      await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
        roomId,
      ]);
      await expect(remove(host, { room_id: roomId, entry_id: queued[0] })).rejects.toMatchObject({
        code: 'room_ended',
      });
    });
  });

  describe('retries', () => {
    it('a replay returns the stored result; a new key gets entry_not_found', async () => {
      const { host, roomId, queued } = await roomWithQueue(3);
      const args = { room_id: roomId, entry_id: queued[1], idempotency_key: newKey() };
      const first = await db.as(host).rpc('remove_queue_entry', args);
      await expect(db.as(host).rpc('remove_queue_entry', args)).resolves.toEqual(first);
      expect(await queuedIds(db, roomId)).toEqual([queued[0], queued[2]]);
      expect(await broadcastCount(db, roomId, 'queue.changed')).toBe(5); // 4 adds + 1 removal
      await expect(remove(host, { room_id: roomId, entry_id: queued[1] })).rejects.toMatchObject({
        code: 'entry_not_found',
      });
    });

    it('a double-tapped Undo with one key removes once', async () => {
      const { member, roomId } = await roomWithQueue(2);
      const own = await add(member, roomId);
      const args = { room_id: roomId, entry_id: own, idempotency_key: newKey() };
      const [first, second] = await Promise.all([
        db.as(member).rpc('remove_queue_entry', args),
        db.as(member).rpc('remove_queue_entry', args),
      ]);
      expect(second).toEqual(first);
      expect(await queuedIds(db, roomId)).not.toContain(own);
    });

    it('the same key for another entry fails with idempotency_conflict', async () => {
      const { host, roomId, queued } = await roomWithQueue(2);
      const key = newKey();
      await remove(host, { room_id: roomId, entry_id: queued[0], idempotency_key: key });
      await expect(
        remove(host, { room_id: roomId, entry_id: queued[1], idempotency_key: key }),
      ).rejects.toMatchObject({ code: 'idempotency_conflict' });
      expect(await queuedIds(db, roomId)).toEqual([queued[1]]);
    });
  });
});
