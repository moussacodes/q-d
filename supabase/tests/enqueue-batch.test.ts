/**
 * enqueue_batch and undo_batch: playlist import's queue side, post-demo and
 * behind the `playlist_import` flag. API_CONTRACTS.md § enqueue_batch,
 * § undo_batch.
 */
import { createTestDb, newKey, type TestDb, type TestUser } from './harness/db';
import {
  addMember,
  broadcastCount,
  expectQueueInvariants,
  insertRecording,
  insertRecordings,
  queueRows,
  startRoom,
} from './harness/queue';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => db.close());

type BatchResult = { batch_id: string; added: number; skipped: number };
type UndoResult = { batch_id: string; removed: number };

const setFlag = (enabled: boolean) =>
  db.query(`update private.feature_flags set enabled = $1 where flag = 'playlist_import'`, [
    enabled,
  ]);

/** A `previewing` batch, as the post-demo import preview would create. */
async function previewBatch(roomId: string, user: TestUser, status = 'previewing') {
  const [row] = await db.query<{ id: string }>(
    `insert into public.playlist_import_batches (room_id, created_by, provider, source_name, item_count, status)
     values ($1, $2, 'spotify', 'Road trip', 0, $3) returning id`,
    [roomId, user.id, status],
  );
  return row.id;
}

const importBatch = (user: TestUser, args: Record<string, unknown>) =>
  db.as(user).rpc<BatchResult>('enqueue_batch', { idempotency_key: newKey(), ...args });

const undo = (user: TestUser, args: Record<string, unknown>) =>
  db.as(user).rpc<UndoResult>('undo_batch', { idempotency_key: newKey(), ...args });

const batchRow = async (batchId: string) =>
  (
    await db.query(
      `select status, item_count, added_count, skipped_count, finished_at is not null as finished
         from public.playlist_import_batches where id = $1`,
      [batchId],
    )
  )[0];

describe('playlist_import flag', () => {
  it('is off by default: both RPCs fail with feature_disabled and change nothing', async () => {
    const { host, roomId } = await startRoom(db);
    const batchId = await previewBatch(roomId, host);
    await expect(
      importBatch(host, {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: [await insertRecording(db)],
      }),
    ).rejects.toMatchObject({ code: 'feature_disabled', details: { flag: 'playlist_import' } });
    await expect(undo(host, { room_id: roomId, batch_id: batchId })).rejects.toMatchObject({
      code: 'feature_disabled',
      details: { flag: 'playlist_import' },
    });
    expect(await queueRows(db, roomId)).toEqual([]);
    expect(await batchRow(batchId)).toMatchObject({ status: 'previewing' });
  });

  it('can be neither read nor changed by clients', async () => {
    const user = await db.createUser();
    await expect(db.as(user).query('select * from private.feature_flags')).rejects.toMatchObject({
      sqlstate: '42501',
    });
    await expect(
      db.as(user).query(`update private.feature_flags set enabled = true`),
    ).rejects.toMatchObject({ sqlstate: '42501' });
    await expect(db.asAnon().query('select * from private.feature_flags')).rejects.toMatchObject({
      sqlstate: '42501',
    });
  });
});

describe('with the flag on', () => {
  beforeAll(() => setFlag(true));
  afterAll(() => setFlag(false));

  describe('enqueue_batch', () => {
    it('adds the songs in playlist order under one batch, after the existing queue', async () => {
      const { host, roomId } = await startRoom(db);
      const member = await addMember(db, roomId);
      const existing = await insertRecordings(db, 2);
      for (const id of existing) {
        await db.as(host).rpc('enqueue_recording', {
          room_id: roomId,
          recording_id: id,
          idempotency_key: newKey(),
        });
      }
      const songs = await insertRecordings(db, 4);
      const batchId = await previewBatch(roomId, member);

      const result = await importBatch(member, {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: songs,
      });

      expect(result).toEqual({ batch_id: batchId, added: 4, skipped: 0 });
      const rows = await queueRows(db, roomId);
      expect(rows.map((r) => [r.recording_id, r.status, r.position, r.batch_id])).toEqual([
        [existing[0], 'playing', 0, null],
        [existing[1], 'queued', 1, null],
        [songs[0], 'queued', 2, batchId],
        [songs[1], 'queued', 3, batchId],
        [songs[2], 'queued', 4, batchId],
        [songs[3], 'queued', 5, batchId],
      ]);
      expect(rows.filter((r) => r.batch_id).every((r) => r.added_by === member.id)).toBe(true);
      expect(await batchRow(batchId)).toEqual({
        status: 'done',
        item_count: 4,
        added_count: 4,
        skipped_count: 0,
        finished: true,
      });
      await expectQueueInvariants(db, roomId);
    });

    it('starts the first song in an empty room', async () => {
      const { host, roomId } = await startRoom(db);
      const songs = await insertRecordings(db, 3);
      const batchId = await previewBatch(roomId, host);
      await importBatch(host, { room_id: roomId, batch_id: batchId, recording_ids: songs });
      const rows = await queueRows(db, roomId);
      expect(rows.map((r) => [r.recording_id, r.status, r.position])).toEqual([
        [songs[0], 'playing', 0],
        [songs[1], 'queued', 1],
        [songs[2], 'queued', 2],
      ]);
    });

    it('skips songs already queued or playing, and repeats within the batch', async () => {
      const { host, roomId } = await startRoom(db);
      const [playing, queued, fresh] = await insertRecordings(db, 3);
      for (const id of [playing, queued]) {
        await db.as(host).rpc('enqueue_recording', {
          room_id: roomId,
          recording_id: id,
          idempotency_key: newKey(),
        });
      }
      const batchId = await previewBatch(roomId, host);
      const result = await importBatch(host, {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: [playing, fresh, queued, fresh],
      });
      expect(result).toEqual({ batch_id: batchId, added: 1, skipped: 3 });
      expect(await batchRow(batchId)).toMatchObject({
        item_count: 4,
        added_count: 1,
        skipped_count: 3,
      });
    });

    it('keeps the preview item count when it is larger (unmatched songs)', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      await db.query('update public.playlist_import_batches set item_count = 10 where id = $1', [
        batchId,
      ]);
      await importBatch(host, {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: await insertRecordings(db, 3),
      });
      expect(await batchRow(batchId)).toMatchObject({ item_count: 10, added_count: 3 });
    });

    it('takes 50 songs, the limit', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      const result = await importBatch(host, {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: await insertRecordings(db, 50),
      });
      expect(result.added).toBe(50);
      await expectQueueInvariants(db, roomId);
    });

    it('limit_exceeded over 50 songs, before anything changes', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      const ids = await insertRecordings(db, 51);
      await expect(
        importBatch(host, { room_id: roomId, batch_id: batchId, recording_ids: ids }),
      ).rejects.toMatchObject({ code: 'limit_exceeded', details: { limit: 50 } });
      expect(await queueRows(db, roomId)).toEqual([]);
      expect(await batchRow(batchId)).toMatchObject({ status: 'previewing' });
    });

    it('sends one queue.changed for the whole batch', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      await importBatch(host, {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: await insertRecordings(db, 5),
      });
      expect(await broadcastCount(db, roomId, 'queue.changed')).toBe(1);
    });

    it('import_in_progress while another import runs in the room', async () => {
      const { host, roomId } = await startRoom(db);
      const member = await addMember(db, roomId);
      await previewBatch(roomId, member, 'importing');
      const batchId = await previewBatch(roomId, host);
      await expect(
        importBatch(host, {
          room_id: roomId,
          batch_id: batchId,
          recording_ids: [await insertRecording(db)],
        }),
      ).rejects.toMatchObject({ code: 'import_in_progress' });
      expect(await queueRows(db, roomId)).toEqual([]);
    });

    it('a running import in another room does not block this one', async () => {
      const other = await startRoom(db);
      await previewBatch(other.roomId, other.host, 'importing');
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      await expect(
        importBatch(host, {
          room_id: roomId,
          batch_id: batchId,
          recording_ids: [await insertRecording(db)],
        }),
      ).resolves.toMatchObject({ added: 1 });
    });

    it('stale_state when the batch was already imported (a new key)', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      const ids = await insertRecordings(db, 2);
      await importBatch(host, { room_id: roomId, batch_id: batchId, recording_ids: ids });
      await expect(
        importBatch(host, { room_id: roomId, batch_id: batchId, recording_ids: ids }),
      ).rejects.toMatchObject({ code: 'stale_state', details: { status: 'done' } });
      expect(await queueRows(db, roomId)).toHaveLength(2);
    });

    it.each(['undone', 'failed'])('stale_state for a batch that is %s', async (status) => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host, status);
      await expect(
        importBatch(host, {
          room_id: roomId,
          batch_id: batchId,
          recording_ids: [await insertRecording(db)],
        }),
      ).rejects.toMatchObject({ code: 'stale_state', details: { status } });
    });

    it('a replay returns the stored result without adding again', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      const args = {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: await insertRecordings(db, 3),
        idempotency_key: newKey(),
      };
      const first = await db.as(host).rpc('enqueue_batch', args);
      await expect(db.as(host).rpc('enqueue_batch', args)).resolves.toEqual(first);
      expect(await queueRows(db, roomId)).toHaveLength(3);
      expect(await broadcastCount(db, roomId, 'queue.changed')).toBe(1);
    });

    it('a replay is answered even after the flag is switched off', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      const args = {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: [await insertRecording(db)],
        idempotency_key: newKey(),
      };
      const first = await db.as(host).rpc('enqueue_batch', args);
      await setFlag(false);
      try {
        await expect(db.as(host).rpc('enqueue_batch', args)).resolves.toEqual(first);
      } finally {
        await setFlag(true);
      }
    });

    it('the same key with other songs fails with idempotency_conflict', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      const key = newKey();
      await importBatch(host, {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: [await insertRecording(db)],
        idempotency_key: key,
      });
      await expect(
        importBatch(host, {
          room_id: roomId,
          batch_id: batchId,
          recording_ids: [await insertRecording(db)],
          idempotency_key: key,
        }),
      ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    });

    it('the same songs in another order are different arguments', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      const [a, b] = await insertRecordings(db, 2);
      const key = newKey();
      await importBatch(host, {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: [a, b],
        idempotency_key: key,
      });
      await expect(
        importBatch(host, {
          room_id: roomId,
          batch_id: batchId,
          recording_ids: [b, a],
          idempotency_key: key,
        }),
      ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    });

    it('follows the add-songs rule: not_allowed for members in a host-only room', async () => {
      const { roomId } = await startRoom(db, { add_songs: 'host' });
      const member = await addMember(db, roomId);
      const batchId = await previewBatch(roomId, member);
      await expect(
        importBatch(member, {
          room_id: roomId,
          batch_id: batchId,
          recording_ids: [await insertRecording(db)],
        }),
      ).rejects.toMatchObject({ code: 'not_allowed' });
    });

    it('not_member, room_not_found and room_ended', async () => {
      const { host, roomId } = await startRoom(db);
      const outsider = await db.createUser();
      const batchId = await previewBatch(roomId, host);
      const ids = [await insertRecording(db)];
      await expect(
        importBatch(outsider, { room_id: roomId, batch_id: batchId, recording_ids: ids }),
      ).rejects.toMatchObject({ code: 'not_member' });
      await expect(
        importBatch(host, {
          room_id: '00000000-0000-0000-0000-000000000000',
          batch_id: batchId,
          recording_ids: ids,
        }),
      ).rejects.toMatchObject({ code: 'room_not_found' });
      await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
        roomId,
      ]);
      await expect(
        importBatch(host, { room_id: roomId, batch_id: batchId, recording_ids: ids }),
      ).rejects.toMatchObject({ code: 'room_ended' });
    });

    it('is not callable by anon, and needs sign-in', async () => {
      const { host, roomId } = await startRoom(db);
      const args = {
        room_id: roomId,
        batch_id: await previewBatch(roomId, host),
        recording_ids: [await insertRecording(db)],
        idempotency_key: newKey(),
      };
      await expect(db.asAnon().rpc('enqueue_batch', args)).rejects.toMatchObject({
        sqlstate: '42501',
      });
      await expect(db.asServiceRole().rpc('enqueue_batch', args)).rejects.toMatchObject({
        code: 'not_authenticated',
      });
    });

    it.each([
      ['room_id', { room_id: null }],
      ['batch_id', { batch_id: null }],
      ['recording_ids', { recording_ids: null }],
      ['recording_ids', { recording_ids: [] }],
      ['recording_ids', { recording_ids: ['00000000-0000-0000-0000-000000000000'] }],
      ['idempotency_key', { idempotency_key: null }],
    ])('invalid_input (%s) for %j', async (field, override) => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      await expect(
        importBatch(host, {
          room_id: roomId,
          batch_id: batchId,
          recording_ids: [await insertRecording(db)],
          ...override,
        }),
      ).rejects.toMatchObject({ code: 'invalid_input', details: { field } });
      expect(await queueRows(db, roomId)).toEqual([]);
    });

    it('invalid_input for a missing song among good ones, adding none of them', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      await expect(
        importBatch(host, {
          room_id: roomId,
          batch_id: batchId,
          recording_ids: [await insertRecording(db), '00000000-0000-0000-0000-000000000000'],
        }),
      ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'recording_ids' } });
      expect(await queueRows(db, roomId)).toEqual([]);
    });

    it('invalid_input for a batch from another room or another person', async () => {
      const { host, roomId } = await startRoom(db);
      const member = await addMember(db, roomId);
      const other = await startRoom(db);
      const ids = [await insertRecording(db)];
      const elsewhere = await previewBatch(other.roomId, other.host);
      const someoneElses = await previewBatch(roomId, member);
      await expect(
        importBatch(host, { room_id: roomId, batch_id: elsewhere, recording_ids: ids }),
      ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'batch_id' } });
      await expect(
        importBatch(host, { room_id: roomId, batch_id: someoneElses, recording_ids: ids }),
      ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'batch_id' } });
    });
  });

  describe('undo_batch', () => {
    /** A room playing a solo song, then a 4-song batch, then another solo song. */
    async function roomWithBatch() {
      const { host, roomId } = await startRoom(db);
      const member = await addMember(db, roomId);
      const [first, last] = await insertRecordings(db, 2);
      await db.as(host).rpc('enqueue_recording', {
        room_id: roomId,
        recording_id: first,
        idempotency_key: newKey(),
      });
      const batchId = await previewBatch(roomId, member);
      await importBatch(member, {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: await insertRecordings(db, 4),
      });
      await db.as(host).rpc('enqueue_recording', {
        room_id: roomId,
        recording_id: last,
        idempotency_key: newKey(),
      });
      return { host, member, roomId, batchId, first, last };
    }

    it('removes the batch songs still waiting and closes the gap', async () => {
      const { host, roomId, batchId, first, last } = await roomWithBatch();
      const result = await undo(host, { room_id: roomId, batch_id: batchId });
      expect(result).toEqual({ batch_id: batchId, removed: 4 });
      const rows = await queueRows(db, roomId);
      expect(
        rows.filter((r) => r.status !== 'removed').map((r) => [r.recording_id, r.position]),
      ).toEqual([
        [first, 0],
        [last, 1],
      ]);
      expect(rows.filter((r) => r.status === 'removed')).toHaveLength(4);
      expect(await batchRow(batchId)).toMatchObject({ status: 'undone' });
      await expectQueueInvariants(db, roomId);
    });

    it('leaves the batch song that is playing and the ones already played', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      const songs = await insertRecordings(db, 3);
      await importBatch(host, { room_id: roomId, batch_id: batchId, recording_ids: songs });
      // songs[0] played, songs[1] plays now, songs[2] waits.
      await db.query(
        `update public.queue_entries set status = 'played' where room_id = $1 and recording_id = $2`,
        [roomId, songs[0]],
      );
      await db.query(
        `update public.queue_entries set status = 'playing', position = 0 where room_id = $1 and recording_id = $2`,
        [roomId, songs[1]],
      );
      const result = await undo(host, { room_id: roomId, batch_id: batchId });
      expect(result.removed).toBe(1);
      const rows = await queueRows(db, roomId);
      expect(rows.map((r) => [r.recording_id, r.status])).toEqual([
        [songs[1], 'playing'],
        [songs[0], 'played'],
        [songs[2], 'removed'],
      ]);
    });

    it('sends queue.changed', async () => {
      const { host, roomId, batchId } = await roomWithBatch();
      const before = await broadcastCount(db, roomId, 'queue.changed');
      await undo(host, { room_id: roomId, batch_id: batchId });
      expect(await broadcastCount(db, roomId, 'queue.changed')).toBe(before + 1);
    });

    it('is the host’s: the member who imported gets not_host', async () => {
      const { member, roomId, batchId } = await roomWithBatch();
      await expect(undo(member, { room_id: roomId, batch_id: batchId })).rejects.toMatchObject({
        code: 'not_host',
      });
      expect(await batchRow(batchId)).toMatchObject({ status: 'done' });
    });

    it('a replay returns the stored result; a new key gets stale_state', async () => {
      const { host, roomId, batchId } = await roomWithBatch();
      const args = { room_id: roomId, batch_id: batchId, idempotency_key: newKey() };
      const first = await db.as(host).rpc('undo_batch', args);
      await expect(db.as(host).rpc('undo_batch', args)).resolves.toEqual(first);
      await expect(undo(host, { room_id: roomId, batch_id: batchId })).rejects.toMatchObject({
        code: 'stale_state',
        details: { status: 'undone' },
      });
    });

    it('stale_state for a batch that was never imported', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      await expect(undo(host, { room_id: roomId, batch_id: batchId })).rejects.toMatchObject({
        code: 'stale_state',
        details: { status: 'previewing' },
      });
    });

    it('invalid_input for a missing or foreign batch, and missing arguments', async () => {
      const { host, roomId } = await startRoom(db);
      const other = await startRoom(db);
      const elsewhere = await previewBatch(other.roomId, other.host, 'done');
      await expect(undo(host, { room_id: roomId, batch_id: elsewhere })).rejects.toMatchObject({
        code: 'invalid_input',
        details: { field: 'batch_id' },
      });
      await expect(undo(host, { room_id: roomId, batch_id: null })).rejects.toMatchObject({
        code: 'invalid_input',
        details: { field: 'batch_id' },
      });
      await expect(undo(host, { room_id: null, batch_id: elsewhere })).rejects.toMatchObject({
        code: 'invalid_input',
        details: { field: 'room_id' },
      });
    });

    it('not_member and room_ended', async () => {
      const { host, roomId, batchId } = await roomWithBatch();
      const outsider = await db.createUser();
      await expect(undo(outsider, { room_id: roomId, batch_id: batchId })).rejects.toMatchObject({
        code: 'not_member',
      });
      await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
        roomId,
      ]);
      await expect(undo(host, { room_id: roomId, batch_id: batchId })).rejects.toMatchObject({
        code: 'room_ended',
      });
    });
  });
});

describe('renumber_queue', () => {
  it('closes gaps and keeps the order', async () => {
    const { host, roomId } = await startRoom(db);
    const songs = await insertRecordings(db, 5);
    for (const id of songs) {
      await db.as(host).rpc('enqueue_recording', {
        room_id: roomId,
        recording_id: id,
        idempotency_key: newKey(),
      });
    }
    await db.query(
      `update public.queue_entries set status = 'removed' where room_id = $1 and recording_id = any($2::uuid[])`,
      [roomId, [songs[1], songs[3]]],
    );
    await db.query('select private.renumber_queue($1)', [roomId]);
    const rows = (await queueRows(db, roomId)).filter((r) => r.status === 'queued');
    expect(rows.map((r) => [r.recording_id, r.position])).toEqual([
      [songs[2], 1],
      [songs[4], 2],
    ]);
  });

  it('is not callable by clients', async () => {
    const { host, roomId } = await startRoom(db);
    await expect(
      db.as(host).query('select private.renumber_queue($1)', [roomId]),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });
});

describe('review: flag table, grants and batch lifecycle', () => {
  it('API roles have no privilege on private.feature_flags or the batch helpers', async () => {
    // authenticated has usage on the private schema (the RLS migration grants it
    // for policy helpers), so table and function grants are what keep this closed.
    const [row] = await db.query<Record<string, boolean>>(
      `select has_table_privilege('anon', 'private.feature_flags', 'select') as anon_select,
              has_table_privilege('authenticated', 'private.feature_flags', 'select') as auth_select,
              has_table_privilege('authenticated', 'private.feature_flags', 'update') as auth_update,
              has_function_privilege('authenticated', 'private.require_feature(text)', 'execute') as require_feature,
              has_function_privilege('authenticated', 'private.batch_limit()', 'execute') as batch_limit`,
    );
    expect(row).toEqual({
      anon_select: false,
      auth_select: false,
      auth_update: false,
      require_feature: false,
      batch_limit: false,
    });
  });

  it('both RPCs are security definer with a pinned search_path, for authenticated only', async () => {
    const rows = await db.query<{ definer: boolean; config: string; anon: boolean; auth: boolean }>(
      `select p.prosecdef as definer, array_to_string(p.proconfig, ',') as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p
        where p.oid in ('public.enqueue_batch(uuid, uuid, uuid[], uuid)'::regprocedure,
                        'public.undo_batch(uuid, uuid, uuid)'::regprocedure)`,
    );
    expect(rows).toEqual([
      { definer: true, config: 'search_path=""', anon: false, auth: true },
      { definer: true, config: 'search_path=""', anon: false, auth: true },
    ]);
  });

  describe('with the flag on', () => {
    beforeAll(() => setFlag(true));
    afterAll(() => setFlag(false));

    it('an undone batch cannot be imported again (stale_state, status undone)', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      await importBatch(host, {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: await insertRecordings(db, 3),
      });
      await undo(host, { room_id: roomId, batch_id: batchId });
      await expect(
        importBatch(host, {
          room_id: roomId,
          batch_id: batchId,
          recording_ids: await insertRecordings(db, 1),
        }),
      ).rejects.toMatchObject({ code: 'stale_state', details: { status: 'undone' } });
      await expectQueueInvariants(db, roomId);
    });

    it('a rejected import leaves the batch previewing and sends nothing', async () => {
      const { host, roomId } = await startRoom(db);
      const batchId = await previewBatch(roomId, host);
      await expect(
        importBatch(host, {
          room_id: roomId,
          batch_id: batchId,
          recording_ids: [await insertRecording(db), '00000000-0000-0000-0000-000000000000'],
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
      expect(await batchRow(batchId)).toMatchObject({ status: 'previewing', added_count: 0 });
      expect(await db.broadcasts(roomId)).toEqual([]);
    });

    it('Chosen add-songs rule: a chosen member imports, an unchosen one gets not_allowed', async () => {
      const { roomId } = await startRoom(db, { add_songs: 'chosen' });
      const chosen = await addMember(db, roomId);
      const other = await addMember(db, roomId);
      await db.query(
        `insert into public.room_rule_members (room_id, rule, user_id) values ($1, 'add_songs', $2)`,
        [roomId, chosen.id],
      );
      const chosenBatch = await previewBatch(roomId, chosen);
      const otherBatch = await previewBatch(roomId, other);
      await expect(
        importBatch(chosen, {
          room_id: roomId,
          batch_id: chosenBatch,
          recording_ids: await insertRecordings(db, 2),
        }),
      ).resolves.toMatchObject({ added: 2, skipped: 0 });
      await expect(
        importBatch(other, {
          room_id: roomId,
          batch_id: otherBatch,
          recording_ids: await insertRecordings(db, 2),
        }),
      ).rejects.toMatchObject({ code: 'not_allowed' });
    });

    it('undo keeps the other songs in their order, with positions 1..n', async () => {
      const { host, roomId } = await startRoom(db);
      const [playing, before, after] = await insertRecordings(db, 3);
      const add = (recordingId: string) =>
        db.as(host).rpc<{ entry_id: string }>('enqueue_recording', {
          room_id: roomId,
          recording_id: recordingId,
          idempotency_key: newKey(),
        });
      await add(playing);
      await add(before);
      const batchId = await previewBatch(roomId, host);
      await importBatch(host, {
        room_id: roomId,
        batch_id: batchId,
        recording_ids: await insertRecordings(db, 5),
      });
      await add(after);
      await expect(undo(host, { room_id: roomId, batch_id: batchId })).resolves.toMatchObject({
        removed: 5,
      });
      const live = (await queueRows(db, roomId)).filter((r) => r.status !== 'removed');
      expect(live.map((r) => [r.recording_id, r.status, r.position])).toEqual([
        [playing, 'playing', 0],
        [before, 'queued', 1],
        [after, 'queued', 2],
      ]);
    });
  });
});
