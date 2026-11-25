/**
 * Fixtures for the queue RPC tests: rooms made through create_room, members
 * and chosen people inserted directly (join_room_by_code is another card), and
 * catalog recordings. Plus readers for the queue and its invariants.
 */
import { newKey, type TestDb, type TestUser } from './db';

export type Audience = 'everyone' | 'chosen' | 'host';

export type QueueRow = {
  id: string;
  recording_id: string;
  position: number;
  status: 'queued' | 'playing' | 'played' | 'removed';
  added_by: string | null;
  batch_id: string | null;
};

export type EnqueueResult = { entry_id: string; position: number; queue_length: number };

/** A live room made through create_room, hosted by a new user with Spotify. */
export async function startRoom(
  db: TestDb,
  rules: { add_songs?: Audience; control?: Audience } = {},
): Promise<{ host: TestUser; roomId: string }> {
  const host = await db.createUser({ provider: 'spotify' });
  const { room_id: roomId } = await db.as(host).rpc<{ room_id: string }>('create_room', {
    name: 'Friday',
    playback_provider: 'spotify',
    idempotency_key: newKey(),
    ...rules,
  });
  return { host, roomId };
}

/** A new user who is a member of the room (inserted as the superuser). */
export async function addMember(db: TestDb, roomId: string): Promise<TestUser> {
  const user = await db.createUser();
  await db.query('insert into public.room_members (room_id, user_id) values ($1, $2)', [
    roomId,
    user.id,
  ]);
  return user;
}

/** Picks a member for a rule set to Chosen people. */
export async function choose(
  db: TestDb,
  roomId: string,
  rule: 'add_songs' | 'control',
  user: TestUser,
): Promise<void> {
  await db.query(
    'insert into public.room_rule_members (room_id, rule, user_id) values ($1, $2, $3)',
    [roomId, rule, user.id],
  );
}

let recordingCount = 0;

/** A canonical recording, as a catalog search result would create. */
export async function insertRecording(db: TestDb, title?: string): Promise<string> {
  recordingCount += 1;
  const [row] = await db.query<{ id: string }>(
    `insert into public.recordings (title, primary_artist, duration_ms)
     values ($1, 'Test Artist', 200000) returning id`,
    [title ?? `Song ${recordingCount}`],
  );
  return row.id;
}

/** Several recordings at once. */
export async function insertRecordings(db: TestDb, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push(await insertRecording(db));
  return ids;
}

/** Every entry of the room: playing first, then queued in order, then the rest. */
export async function queueRows(db: TestDb, roomId: string): Promise<QueueRow[]> {
  return db.query<QueueRow>(
    `select id, recording_id, position::int as position, status, added_by, batch_id
       from public.queue_entries where room_id = $1
      order by case status when 'playing' then 0 when 'queued' then 1 else 2 end,
               position, added_at, id`,
    [roomId],
  );
}

/** Entry ids still waiting to play, in play order. */
export async function queuedIds(db: TestDb, roomId: string): Promise<string[]> {
  return (await queueRows(db, roomId)).filter((r) => r.status === 'queued').map((r) => r.id);
}

/** The playing entry's id, or null. */
export async function playingId(db: TestDb, roomId: string): Promise<string | null> {
  return (await queueRows(db, roomId)).find((r) => r.status === 'playing')?.id ?? null;
}

/**
 * The position invariants every queue RPC keeps: at most one playing entry,
 * at position 0, and queued entries at 1..n with no gaps or repeats.
 */
export async function expectQueueInvariants(db: TestDb, roomId: string): Promise<void> {
  const rows = await queueRows(db, roomId);
  const playing = rows.filter((r) => r.status === 'playing');
  expect(playing.length).toBeLessThanOrEqual(1);
  for (const row of playing) expect(row.position).toBe(0);
  const positions = rows.filter((r) => r.status === 'queued').map((r) => r.position);
  expect(positions).toEqual(positions.map((_, i) => i + 1));
}

/** How many broadcasts of one type the room's channel got. */
export async function broadcastCount(db: TestDb, roomId: string, type: string): Promise<number> {
  return (await db.broadcasts(roomId)).filter((b) => b.event === type).length;
}
