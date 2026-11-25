/**
 * Queue ordering and idempotency when several people act at once.
 *
 * What PGlite can and can't show: it runs one Postgres backend behind a
 * mutex, so requests fired together with Promise.all are queued and each runs
 * as its own whole transaction, one after another. Two transactions never
 * hold locks at the same moment here, so these tests can't prove the room
 * lock blocks a second backend. They prove the rest: whatever order requests
 * arrive in, interleaved across members and operations, the queue stays
 * correct (one playing entry, queued positions 1..n, every success applied
 * exactly once, replays identical). A structural test checks that every queue
 * RPC takes the room lock before it reads or writes the queue. The harness
 * only targets PGlite today; running this file against real parallel backends
 * (a Supabase local stack, `supabase start` on the Mac) needs a harness that
 * connects there, which doesn't exist yet. Until then, parallel blocking is
 * unproven here.
 */
import { createTestDb, newKey, type DbError, type TestDb, type TestUser } from './harness/db';
import {
  addMember,
  broadcastCount,
  expectQueueInvariants,
  insertRecording,
  insertRecordings,
  queuedIds,
  queueRows,
  startRoom,
  type EnqueueResult,
} from './harness/queue';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => db.close());

type Settled<T> = { ok: true; value: T } | { ok: false; code: string };

/** Runs calls together and reports each outcome, in submission order. */
async function together<T>(calls: Promise<T>[]): Promise<Settled<T>[]> {
  const results = await Promise.allSettled(calls);
  return results.map((r) =>
    r.status === 'fulfilled'
      ? { ok: true, value: r.value }
      : { ok: false, code: (r.reason as DbError).code },
  );
}

const enqueueArgs = (roomId: string, recordingId: string, extra: Record<string, unknown> = {}) => ({
  room_id: roomId,
  recording_id: recordingId,
  idempotency_key: newKey(),
  ...extra,
});

async function roomWithMembers(count: number) {
  const { host, roomId } = await startRoom(db, { control: 'everyone' });
  const members: TestUser[] = [host];
  for (let i = 0; i < count; i += 1) members.push(await addMember(db, roomId));
  return { host, roomId, members };
}

/** A small deterministic PRNG (mulberry32), so a failing run can be replayed. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('simultaneous adds', () => {
  it('six people adding 30 songs at once get one gap-free order, each song once', async () => {
    const { roomId, members } = await roomWithMembers(5);
    const songs = await insertRecordings(db, 30);
    const outcomes = await together(
      songs.map((id, i) =>
        db
          .as(members[i % members.length])
          .rpc<EnqueueResult>('enqueue_recording', enqueueArgs(roomId, id)),
      ),
    );

    expect(outcomes.every((o) => o.ok)).toBe(true);
    const results = outcomes.map((o) => (o.ok ? o.value : null)) as EnqueueResult[];
    // One song plays, 29 wait at 1..29, and every returned position is distinct.
    expect(results.map((r) => r.position).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, i) => i),
    );
    expect(new Set(results.map((r) => r.entry_id)).size).toBe(30);
    // Positions returned are the positions stored: no later add moved an earlier one.
    const rows = await queueRows(db, roomId);
    for (const r of results) {
      expect(rows.find((row) => row.id === r.entry_id)?.position).toBe(r.position);
    }
    // queue_length counted the queue at that moment, so it equals the place in line.
    for (const r of results) expect(r.queue_length).toBe(r.position);
    expect(rows.map((r) => r.recording_id).sort()).toEqual([...songs].sort());
    await expectQueueInvariants(db, roomId);
    expect(await broadcastCount(db, roomId, 'queue.changed')).toBe(30);
  });

  it('the same song added by several people at once: one wins, the rest are asked', async () => {
    const { roomId, members } = await roomWithMembers(4);
    const recordingId = await insertRecording(db);
    const outcomes = await together(
      members.map((m) => db.as(m).rpc('enqueue_recording', enqueueArgs(roomId, recordingId))),
    );
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok).map((o) => !o.ok && o.code)).toEqual(
      Array(members.length - 1).fill('already_in_queue'),
    );
    expect(await queueRows(db, roomId)).toHaveLength(1);
  });

  it('confirmed duplicates at once each get their own entry and place', async () => {
    const { roomId, members } = await roomWithMembers(3);
    const recordingId = await insertRecording(db);
    const outcomes = await together(
      members.map((m) =>
        db
          .as(m)
          .rpc<EnqueueResult>(
            'enqueue_recording',
            enqueueArgs(roomId, recordingId, { allow_duplicate: true }),
          ),
      ),
    );
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(await queueRows(db, roomId)).toHaveLength(members.length);
    await expectQueueInvariants(db, roomId);
  });

  it('adds to two rooms at once never mix', async () => {
    const one = await roomWithMembers(2);
    const two = await roomWithMembers(2);
    const songs = await insertRecordings(db, 12);
    await together(
      songs.map((id, i) => {
        const room = i % 2 === 0 ? one : two;
        return db
          .as(room.members[i % room.members.length])
          .rpc('enqueue_recording', enqueueArgs(room.roomId, id));
      }),
    );
    expect(await queueRows(db, one.roomId)).toHaveLength(6);
    expect(await queueRows(db, two.roomId)).toHaveLength(6);
    await expectQueueInvariants(db, one.roomId);
    await expectQueueInvariants(db, two.roomId);
  });
});

describe('retries at the same moment', () => {
  it('five copies of one request (one key) add one entry and all return it', async () => {
    const { roomId, members } = await roomWithMembers(1);
    const args = enqueueArgs(roomId, await insertRecording(db));
    const outcomes = await together(
      Array.from({ length: 5 }, () => db.as(members[1]).rpc('enqueue_recording', args)),
    );
    expect(outcomes.every((o) => o.ok)).toBe(true);
    const values = outcomes.map((o) => o.ok && o.value);
    for (const v of values) expect(v).toEqual(values[0]);
    expect(await queueRows(db, roomId)).toHaveLength(1);
    expect(await broadcastCount(db, roomId, 'queue.changed')).toBe(1);
  });

  it('one key with two different songs at once: one applies, the other is idempotency_conflict', async () => {
    const { roomId, members } = await roomWithMembers(1);
    const key = newKey();
    const [a, b] = await insertRecordings(db, 2);
    const outcomes = await together([
      db.as(members[1]).rpc('enqueue_recording', enqueueArgs(roomId, a, { idempotency_key: key })),
      db.as(members[1]).rpc('enqueue_recording', enqueueArgs(roomId, b, { idempotency_key: key })),
    ]);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.find((o) => !o.ok)).toEqual({ ok: false, code: 'idempotency_conflict' });
    expect(await queueRows(db, roomId)).toHaveLength(1);
  });

  it('one key reused by one person for two operations is two requests', async () => {
    const { roomId, members } = await roomWithMembers(1);
    const key = newKey();
    await db
      .as(members[0])
      .rpc('enqueue_recording', enqueueArgs(roomId, await insertRecording(db)));
    const added = await db
      .as(members[0])
      .rpc<EnqueueResult>(
        'enqueue_recording',
        enqueueArgs(roomId, await insertRecording(db), { idempotency_key: key }),
      );
    const outcomes = await together([
      db.as(members[0]).rpc('remove_queue_entry', {
        room_id: roomId,
        entry_id: added.entry_id,
        idempotency_key: key,
      }),
    ]);
    expect(outcomes).toEqual([{ ok: true, value: { entry_id: added.entry_id, queue_length: 0 } }]);
    await expectQueueInvariants(db, roomId);
  });

  it('the same key from two people is two requests', async () => {
    const { roomId, members } = await roomWithMembers(2);
    const key = newKey();
    const outcomes = await together(
      [members[1], members[2]].map(async (m) =>
        db
          .as(m)
          .rpc(
            'enqueue_recording',
            enqueueArgs(roomId, await insertRecording(db), { idempotency_key: key }),
          ),
      ),
    );
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(await queueRows(db, roomId)).toHaveLength(2);
  });

  it('remove, then its replay alongside new adds: removed once, replay identical', async () => {
    const { roomId, members } = await roomWithMembers(2);
    const ids: string[] = [];
    for (const song of await insertRecordings(db, 4)) {
      ids.push(
        (await db.as(members[1]).rpc<EnqueueResult>('enqueue_recording', enqueueArgs(roomId, song)))
          .entry_id,
      );
    }
    const removeArgs = { room_id: roomId, entry_id: ids[2], idempotency_key: newKey() };
    const first = await db.as(members[1]).rpc('remove_queue_entry', removeArgs);
    const more = await insertRecordings(db, 3);
    const outcomes = await together([
      db.as(members[1]).rpc('remove_queue_entry', removeArgs),
      ...more.map((s) => db.as(members[2]).rpc('enqueue_recording', enqueueArgs(roomId, s))),
      db.as(members[1]).rpc('remove_queue_entry', removeArgs),
    ]);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(outcomes[0]).toEqual({ ok: true, value: first });
    expect(outcomes[outcomes.length - 1]).toEqual({ ok: true, value: first });
    const rows = await queueRows(db, roomId);
    expect(rows.filter((r) => r.status === 'removed').map((r) => r.id)).toEqual([ids[2]]);
    await expectQueueInvariants(db, roomId);
  });

  it('two people removing the same entry at once: one removes, the other gets entry_not_found', async () => {
    const { roomId, members } = await roomWithMembers(2);
    await db
      .as(members[0])
      .rpc('enqueue_recording', enqueueArgs(roomId, await insertRecording(db)));
    const { entry_id: entryId } = await db
      .as(members[1])
      .rpc<EnqueueResult>('enqueue_recording', enqueueArgs(roomId, await insertRecording(db)));
    const outcomes = await together(
      [members[1], members[2]].map((m) =>
        db.as(m).rpc('remove_queue_entry', {
          room_id: roomId,
          entry_id: entryId,
          idempotency_key: newKey(),
        }),
      ),
    );
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.find((o) => !o.ok)).toEqual({ ok: false, code: 'entry_not_found' });
  });
});

describe('reorders during adds', () => {
  it('moves and adds interleaved keep 1..n, and moved entries land where asked', async () => {
    const { host, roomId, members } = await roomWithMembers(3);
    const ids: string[] = [];
    for (const song of await insertRecordings(db, 6)) {
      ids.push(
        (await db.as(host).rpc<EnqueueResult>('enqueue_recording', enqueueArgs(roomId, song)))
          .entry_id,
      );
    }
    const waiting = ids.slice(1); // ids[0] plays
    const extra = await insertRecordings(db, 6);
    const outcomes = await together([
      db.as(members[1]).rpc('enqueue_recording', enqueueArgs(roomId, extra[0])),
      db.as(host).rpc('reorder_queue', {
        room_id: roomId,
        entry_id: waiting[4],
        after_entry_id: null,
        idempotency_key: newKey(),
      }),
      db.as(members[2]).rpc('enqueue_recording', enqueueArgs(roomId, extra[1])),
      db.as(members[3]).rpc('reorder_queue', {
        room_id: roomId,
        entry_id: waiting[0],
        after_entry_id: waiting[2],
        idempotency_key: newKey(),
      }),
      ...extra
        .slice(2)
        .map((s, i) => db.as(members[i % 4]).rpc('enqueue_recording', enqueueArgs(roomId, s))),
    ]);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    await expectQueueInvariants(db, roomId);
    const order = await queuedIds(db, roomId);
    expect(order).toHaveLength(11);
    // The top move happened; the second move put waiting[0] right after waiting[2].
    expect(order[0]).toBe(waiting[4]);
    expect(order[order.indexOf(waiting[2]) + 1]).toBe(waiting[0]);
    // Every song added during the moves sits after all the songs that were there before.
    const lastOld = Math.max(...waiting.map((id) => order.indexOf(id)));
    expect(order.slice(lastOld + 1)).toHaveLength(6);
  });

  it('a reorder after its anchor was removed in the same burst is stale_state, and changes nothing', async () => {
    const { host, roomId } = await roomWithMembers(1);
    const ids: string[] = [];
    for (const song of await insertRecordings(db, 4)) {
      ids.push(
        (await db.as(host).rpc<EnqueueResult>('enqueue_recording', enqueueArgs(roomId, song)))
          .entry_id,
      );
    }
    const outcomes = await together([
      db.as(host).rpc('remove_queue_entry', {
        room_id: roomId,
        entry_id: ids[1],
        idempotency_key: newKey(),
      }),
      db.as(host).rpc('reorder_queue', {
        room_id: roomId,
        entry_id: ids[3],
        after_entry_id: ids[1],
        idempotency_key: newKey(),
      }),
    ]);
    expect(outcomes[0].ok).toBe(true);
    expect(outcomes[1]).toEqual({ ok: false, code: 'stale_state' });
    expect(await queuedIds(db, roomId)).toEqual([ids[2], ids[3]]);
    await expectQueueInvariants(db, roomId);
  });
});

describe('a long random burst', () => {
  it('300 mixed operations from six people keep every invariant (seeded)', async () => {
    const random = prng(20261125);
    const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];
    const { roomId, members } = await roomWithMembers(5);
    const catalog = await insertRecordings(db, 40);
    const done: { user: TestUser; name: string; args: Record<string, unknown>; value: unknown }[] =
      [];

    for (let wave = 0; wave < 30; wave += 1) {
      const known = await queuedIds(db, roomId);
      const plan: { user: TestUser; name: string; args: Record<string, unknown> }[] = [];
      for (let i = 0; i < 10; i += 1) {
        const user = pick(members);
        const roll = random();
        if (roll < 0.5 || known.length < 2) {
          plan.push({
            user,
            name: 'enqueue_recording',
            args: enqueueArgs(roomId, pick(catalog), { allow_duplicate: random() < 0.3 }),
          });
        } else if (roll < 0.7) {
          plan.push({
            user,
            name: 'reorder_queue',
            args: {
              room_id: roomId,
              entry_id: pick(known),
              after_entry_id: random() < 0.3 ? null : pick(known),
              idempotency_key: newKey(),
            },
          });
        } else if (roll < 0.85) {
          plan.push({
            user,
            name: 'remove_queue_entry',
            args: { room_id: roomId, entry_id: pick(known), idempotency_key: newKey() },
          });
        } else if (done.length > 0) {
          const earlier = pick(done);
          plan.push({ user: earlier.user, name: earlier.name, args: earlier.args });
        }
      }

      const outcomes = await together(plan.map((p) => db.as(p.user).rpc(p.name, p.args)));
      outcomes.forEach((outcome, i) => {
        const p = plan[i];
        if (outcome.ok) {
          const earlier = done.find(
            (d) => d.user === p.user && d.name === p.name && d.args === p.args,
          );
          if (earlier) {
            // A replay returns exactly what the first success returned.
            expect(outcome.value).toEqual(earlier.value);
          } else {
            done.push({ ...p, value: outcome.value });
          }
        } else {
          // Every failure is one of the expected, contract-level answers.
          expect(['already_in_queue', 'entry_not_found', 'stale_state', 'invalid_input']).toContain(
            outcome.code,
          );
        }
      });
      await expectQueueInvariants(db, roomId);
    }

    // Every successful add exists exactly once; every successful removal stuck.
    const rows = await queueRows(db, roomId);
    const adds = done.filter((d) => d.name === 'enqueue_recording');
    const entryIds = adds.map((d) => (d.value as EnqueueResult).entry_id);
    expect(new Set(entryIds).size).toBe(entryIds.length);
    expect(rows.map((r) => r.id).sort()).toEqual([...entryIds].sort());
    for (const removal of done.filter((d) => d.name === 'remove_queue_entry')) {
      expect(rows.find((r) => r.id === removal.args.entry_id)?.status).toBe('removed');
    }
    // No song waits twice unless someone confirmed the duplicate.
    const waiting = rows.filter((r) => r.status === 'queued' || r.status === 'playing');
    const confirmed = new Set(
      adds.filter((d) => d.args.allow_duplicate).map((d) => (d.value as EnqueueResult).entry_id),
    );
    const seen = new Map<string, number>();
    for (const r of waiting.filter((w) => !confirmed.has(w.id))) {
      seen.set(r.recording_id, (seen.get(r.recording_id) ?? 0) + 1);
    }
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });
});

describe('the room lock', () => {
  it('every queue RPC locks the room before it touches the queue', async () => {
    const rows = await db.query<{ name: string; src: string }>(
      `select p.proname as name, p.prosrc as src from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('enqueue_recording', 'enqueue_batch', 'undo_batch',
                            'reorder_queue', 'remove_queue_entry')`,
    );
    expect(rows.map((r) => r.name).sort()).toEqual([
      'enqueue_batch',
      'enqueue_recording',
      'remove_queue_entry',
      'reorder_queue',
      'undo_batch',
    ]);
    for (const row of rows) {
      const { name } = row;
      // The body only: the declare section names queue_entries as a type.
      const src = row.src.slice(row.src.search(/^begin$/m));
      const lock = src.indexOf('private.lock_room(');
      const firstQueueTouch = Math.min(
        ...[
          'public.queue_entries',
          'public.playlist_import_batches',
          'private.append_queue_entry(',
          'private.renumber_queue(',
          'private.require_queued_entry(',
          'private.queued_count(',
        ]
          .map((needle) => src.indexOf(needle))
          .filter((at) => at >= 0),
      );
      expect({ name, locksFirst: lock >= 0 && lock < firstQueueTouch }).toEqual({
        name,
        locksFirst: true,
      });
    }
  });

  it('lock_room holds the room row FOR UPDATE for the rest of the transaction', async () => {
    const { roomId } = await startRoom(db);
    // Inside one transaction: after lock_room, the row is locked by this
    // transaction: the row's xmax is this transaction's id.
    const rows = await db.pg.transaction(async (tx) => {
      await tx.query('select private.lock_room($1)', [roomId]);
      return (
        await tx.query<{ mine: boolean }>(
          `select xmax::text::bigint = (txid_current() % 4294967296) as mine
             from public.rooms where id = $1`,
          [roomId],
        )
      ).rows;
    });
    expect(rows).toEqual([{ mine: true }]);
    // xmax is set by any row lock, so check the mode too: FOR UPDATE, not a share lock.
    const [fn] = await db.query<{ src: string }>(
      `select prosrc as src from pg_proc where oid = 'private.lock_room(uuid)'::regprocedure`,
    );
    expect(fn.src).toMatch(/\bfor update\b/i);
    expect(fn.src).not.toMatch(/\bfor (no key update|share|key share)\b/i);
  });
});
