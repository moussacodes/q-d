/**
 * override_track_match: the host's "Wrong version?" correction.
 * API_CONTRACTS.md § override_track_match, PRODUCT_SPEC.md §6 rule 8.
 */
import { createTestDb, newKey, type TestDb, type TestUser } from './harness/db';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => db.close());

type Override = {
  override_id: string;
  recording_id: string;
  provider: string;
  provider_track_id: string;
  created_at: string;
};

type Room = {
  id: string;
  host: TestUser;
  member: TestUser;
  recordingId: string;
  /** Saved Spotify versions of the recording. */
  tracks: string[];
};

let seq = 0;

/** A live Spotify room with a member and one queued song that has two saved Spotify versions. */
async function setup({
  provider = 'spotify',
}: { provider?: 'spotify' | 'apple_music' } = {}): Promise<Room> {
  seq += 1;
  const host = await db.createUser({ provider });
  const member = await db.createUser();
  const { room_id: id } = await db.as(host).rpc<{ room_id: string }>('create_room', {
    name: 'Friday',
    playback_provider: provider,
    idempotency_key: newKey(),
  });
  await db.query('insert into public.room_members (room_id, user_id) values ($1, $2)', [
    id,
    member.id,
  ]);
  const [recording] = await db.query<{ id: string }>(
    `insert into public.recordings (title, primary_artist, duration_ms)
     values ('Way Bigger', 'Don Toliver', 196000) returning id`,
  );
  const tracks = [`sp-${seq}-a`, `sp-${seq}-b`];
  for (const trackId of tracks) {
    await db.query(
      `insert into public.provider_tracks (provider, provider_track_id, title, duration_ms)
       values ($1, $2, 'Way Bigger', 196000)`,
      [provider, trackId],
    );
  }
  await db.query(
    `insert into public.queue_entries (room_id, recording_id, position, added_by)
     values ($1, $2, 1, $3)`,
    [id, recording.id, member.id],
  );
  return { id, host, member, recordingId: recording.id, tracks };
}

const override = (
  user: TestUser,
  room: Room,
  args: Record<string, unknown> = {},
): Promise<Override> =>
  db.as(user).rpc<Override>('override_track_match', {
    room_id: room.id,
    recording_id: room.recordingId,
    provider: 'spotify',
    provider_track_id: room.tracks[0],
    idempotency_key: newKey(),
    ...args,
  });

const overrideRows = (room: Room) =>
  db.query<{ provider_track_id: string; created_by: string | null }>(
    `select provider_track_id, created_by from public.track_match_overrides
      where room_id = $1 order by created_at, id`,
    [room.id],
  );

const queueEvents = async (room: Room) =>
  (await db.broadcasts(room.id)).filter((b) => b.event === 'queue.changed');

describe('override_track_match', () => {
  it('stores the host’s pick with who made it, and returns it', async () => {
    const room = await setup();
    const result = await override(room.host, room);

    expect(Object.keys(result).sort()).toEqual([
      'created_at',
      'override_id',
      'provider',
      'provider_track_id',
      'recording_id',
    ]);
    expect(result).toMatchObject({
      recording_id: room.recordingId,
      provider: 'spotify',
      provider_track_id: room.tracks[0],
    });
    const [row] = await db.query(
      `select id, room_id, recording_id, provider, provider_track_id, created_by
         from public.track_match_overrides where id = $1`,
      [result.override_id],
    );
    expect(row).toEqual({
      id: result.override_id,
      room_id: room.id,
      recording_id: room.recordingId,
      provider: 'spotify',
      provider_track_id: room.tracks[0],
      created_by: room.host.id,
    });
  });

  it('works for an Apple Music room too', async () => {
    const room = await setup({ provider: 'apple_music' });
    const result = await override(room.host, room, { provider: 'apple_music' });
    expect(result.provider).toBe('apple_music');
  });

  it('keeps every change as an audit trail; the newest wins', async () => {
    const room = await setup();
    await override(room.host, room);
    await override(room.host, room, { provider_track_id: room.tracks[1] });
    await override(room.host, room);
    expect((await overrideRows(room)).map((r) => r.provider_track_id)).toEqual([
      room.tracks[0],
      room.tracks[1],
      room.tracks[0],
    ]);
    const [newest] = await db.query<{ provider_track_id: string }>(
      `select provider_track_id from public.track_match_overrides
        where room_id = $1 and recording_id = $2 and provider = 'spotify'
        order by created_at desc, id desc limit 1`,
      [room.id, room.recordingId],
    );
    expect(newest.provider_track_id).toBe(room.tracks[0]);
  });

  it('picking the version that’s already picked adds no row and sends no event', async () => {
    const room = await setup();
    const first = await override(room.host, room);
    const before = (await queueEvents(room)).length;
    const again = await override(room.host, room);
    expect(again).toEqual(first);
    expect(await overrideRows(room)).toHaveLength(1);
    expect(await queueEvents(room)).toHaveLength(before);
  });

  it('is scoped to the room: shared track_matches and other rooms are untouched', async () => {
    const room = await setup();
    const other = await setup();
    await db.query(
      `insert into public.track_matches (recording_id, provider, provider_track_id, confidence, method, warning)
       values ($1, 'spotify', $2, 81, 'score', 'low_confidence')`,
      [room.recordingId, room.tracks[1]],
    );
    await override(room.host, room);
    expect(
      await db.query(
        'select provider_track_id, method, warning from public.track_matches where recording_id = $1',
        [room.recordingId],
      ),
    ).toEqual([{ provider_track_id: room.tracks[1], method: 'score', warning: 'low_confidence' }]);
    expect(await overrideRows(other)).toEqual([]);
  });

  it('accepts a song that has already played', async () => {
    const room = await setup();
    await db.query(`update public.queue_entries set status = 'played' where room_id = $1`, [
      room.id,
    ]);
    await expect(override(room.host, room)).resolves.toMatchObject({
      provider_track_id: room.tracks[0],
    });
  });

  it('tells the room’s phones to refetch the queue, with ids only', async () => {
    const room = await setup();
    const before = (await queueEvents(room)).length;
    await override(room.host, room);
    const events = await queueEvents(room);
    expect(events).toHaveLength(before + 1);
    const last = events[events.length - 1];
    expect(last.private).toBe(true);
    expect(Object.keys(last.payload).sort()).toEqual(['at', 'roomId', 'type', 'v']);
    expect(last.payload).toMatchObject({ v: 1, type: 'queue.changed', roomId: room.id });
  });

  it('members read the override through RLS; outsiders and anon don’t', async () => {
    const room = await setup();
    const outsider = await db.createUser();
    const { override_id: id } = await override(room.host, room);
    const read = 'select id from public.track_match_overrides where room_id = $1';
    expect(await db.as(room.member).query(read, [room.id])).toEqual([{ id }]);
    expect(await db.as(outsider).query(read, [room.id])).toEqual([]);
    await expect(db.asAnon().query(read, [room.id])).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('clients can’t write overrides directly, not even the host', async () => {
    const room = await setup();
    await expect(
      db.as(room.host).query(
        `insert into public.track_match_overrides (room_id, recording_id, provider, provider_track_id)
         values ($1, $2, 'spotify', $3)`,
        [room.id, room.recordingId, room.tracks[0]],
      ),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });
});

describe('override_track_match idempotency', () => {
  it('a retry with the same key returns the stored result and adds nothing', async () => {
    const room = await setup();
    const key = newKey();
    const first = await override(room.host, room, { idempotency_key: key });
    const events = (await queueEvents(room)).length;
    const again = await override(room.host, room, { idempotency_key: key });
    expect(again).toEqual(first);
    expect(await overrideRows(room)).toHaveLength(1);
    expect(await queueEvents(room)).toHaveLength(events);
  });

  it('a replay is answered first, even after the room ended', async () => {
    const room = await setup();
    const key = newKey();
    const first = await override(room.host, room, { idempotency_key: key });
    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
      room.id,
    ]);
    await expect(override(room.host, room, { idempotency_key: key })).resolves.toEqual(first);
    await expect(override(room.host, room)).rejects.toMatchObject({ code: 'room_ended' });
  });

  it('the same key with another version fails with idempotency_conflict', async () => {
    const room = await setup();
    const key = newKey();
    await override(room.host, room, { idempotency_key: key });
    await expect(
      override(room.host, room, { idempotency_key: key, provider_track_id: room.tracks[1] }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict', hint: 'qd' });
    expect(await overrideRows(room)).toHaveLength(1);
  });

  it('a rejected call leaves the key free for a retry', async () => {
    const room = await setup();
    const key = newKey();
    await expect(
      override(room.host, room, { idempotency_key: key, provider_track_id: 'not-saved' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    // Only successes are stored, so the same key works once the version is saved.
    await db.query(
      `insert into public.provider_tracks (provider, provider_track_id, title, duration_ms)
       values ('spotify', 'not-saved', 'Way Bigger', 196000)`,
    );
    await expect(
      override(room.host, room, { idempotency_key: key, provider_track_id: 'not-saved' }),
    ).resolves.toMatchObject({ provider_track_id: 'not-saved' });
  });

  it('keys are per user: the same key from two hosts doesn’t collide', async () => {
    const a = await setup();
    const b = await setup();
    const key = newKey();
    await override(a.host, a, { idempotency_key: key });
    await expect(override(b.host, b, { idempotency_key: key })).resolves.toMatchObject({
      recording_id: b.recordingId,
    });
  });
});

describe('override_track_match errors', () => {
  it('needs a signed-in user', async () => {
    const room = await setup();
    await expect(
      db.asServiceRole().rpc('override_track_match', {
        room_id: room.id,
        recording_id: room.recordingId,
        provider: 'spotify',
        provider_track_id: room.tracks[0],
        idempotency_key: newKey(),
      }),
    ).rejects.toMatchObject({ code: 'not_authenticated', hint: 'qd' });
  });

  it('anon can’t run it at all', async () => {
    const room = await setup();
    await expect(
      db.asAnon().rpc('override_track_match', {
        room_id: room.id,
        recording_id: room.recordingId,
        provider: 'spotify',
        provider_track_id: room.tracks[0],
        idempotency_key: newKey(),
      }),
    ).rejects.toMatchObject({ sqlstate: '42501' });
  });

  it('a listener gets not_host, and nothing is stored', async () => {
    const room = await setup();
    await expect(override(room.member, room)).rejects.toMatchObject({ code: 'not_host' });
    expect(await overrideRows(room)).toEqual([]);
  });

  it('a listener the control rule lets in still gets not_host', async () => {
    const room = await setup();
    await db.query(`update public.rooms set control = 'everyone' where id = $1`, [room.id]);
    await expect(override(room.member, room)).rejects.toMatchObject({ code: 'not_host' });
  });

  it('someone outside the room gets not_member', async () => {
    const room = await setup();
    const outsider = await db.createUser({ provider: 'spotify' });
    await expect(override(outsider, room)).rejects.toMatchObject({ code: 'not_member' });
  });

  it('an unknown room is room_not_found', async () => {
    const room = await setup();
    await expect(
      override(room.host, room, { room_id: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ code: 'room_not_found' });
  });

  it('an ended room is room_ended', async () => {
    const room = await setup();
    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
      room.id,
    ]);
    await expect(override(room.host, room)).rejects.toMatchObject({ code: 'room_ended' });
  });

  it.each([
    ['idempotency_key', { idempotency_key: null }],
    ['room_id', { room_id: null }],
    ['recording_id', { recording_id: null }],
    ['provider', { provider: null }],
    ['provider_track_id', { provider_track_id: null }],
    ['provider_track_id', { provider_track_id: '' }],
    ['provider_track_id', { provider_track_id: ' padded ' }],
    ['provider_track_id', { provider_track_id: 'x'.repeat(201) }],
  ])('a missing or bad %s is invalid_input', async (field, args) => {
    const room = await setup();
    await expect(override(room.host, room, args)).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field },
    });
  });

  it('a service the room doesn’t play through is invalid_input (provider)', async () => {
    const room = await setup();
    await db.query(
      `insert into public.provider_tracks (provider, provider_track_id, title, duration_ms)
       values ('apple_music', $1, 'Way Bigger', 196000)`,
      [`am-${room.id}`],
    );
    await expect(
      override(room.host, room, { provider: 'apple_music', provider_track_id: `am-${room.id}` }),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'provider' } });
  });

  it('a song never queued in this room is invalid_input (recording_id)', async () => {
    const room = await setup();
    const other = await setup();
    await expect(
      override(room.host, room, { recording_id: other.recordingId }),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'recording_id' } });
    await expect(
      override(room.host, room, { recording_id: '00000000-0000-4000-8000-000000000001' }),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'recording_id' } });
  });

  it('a version q’d hasn’t saved is invalid_input (provider_track_id)', async () => {
    const room = await setup();
    await expect(
      override(room.host, room, { provider_track_id: 'unknown-track' }),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'provider_track_id' } });
    expect(await overrideRows(room)).toEqual([]);
  });

  it('a track id saved only on another service is invalid_input (provider_track_id)', async () => {
    const room = await setup();
    const id = `shared-${room.id}`;
    await db.query(
      `insert into public.provider_tracks (provider, provider_track_id, title, duration_ms)
       values ('apple_music', $1, 'Way Bigger', 196000)`,
      [id],
    );
    await expect(override(room.host, room, { provider_track_id: id })).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'provider_track_id' },
    });
    expect(await overrideRows(room)).toEqual([]);
  });

  it('a song that was queued and then removed still counts as queued', async () => {
    const room = await setup();
    await db.query(`update public.queue_entries set status = 'removed' where room_id = $1`, [
      room.id,
    ]);
    await expect(override(room.host, room)).resolves.toMatchObject({
      provider_track_id: room.tracks[0],
    });
  });

  it('a host who has since lost the host role gets not_host, even for a song they queued', async () => {
    const room = await setup();
    await db.query(
      `update public.room_members set role = 'member' where room_id = $1 and user_id = $2`,
      [room.id, room.host.id],
    );
    await expect(override(room.host, room)).rejects.toMatchObject({ code: 'not_host' });
  });

  it('checks the room before the caller’s role, and the role before the song', async () => {
    const room = await setup();
    await db.query(`update public.rooms set state = 'ended', ended_at = now() where id = $1`, [
      room.id,
    ]);
    await expect(
      override(room.member, room, { provider_track_id: 'unknown-track' }),
    ).rejects.toMatchObject({ code: 'room_ended' });

    const live = await setup();
    await expect(
      override(live.member, live, { provider_track_id: 'unknown-track' }),
    ).rejects.toMatchObject({ code: 'not_host' });
  });

  it('a failed call sends no broadcast', async () => {
    const room = await setup();
    const before = (await queueEvents(room)).length;
    await expect(override(room.member, room)).rejects.toMatchObject({ code: 'not_host' });
    await expect(override(room.host, room, { provider_track_id: 'nope' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(await queueEvents(room)).toHaveLength(before);
  });
});

describe('override_track_match security', () => {
  it('is security definer with a pinned search_path, executable by authenticated only', async () => {
    const [fn] = await db.query<{
      definer: boolean;
      config: string[];
      anon: boolean;
      authenticated: boolean;
      public_role: boolean;
    }>(
      `select p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              exists (
                select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
              ) as public_role
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'override_track_match'`,
    );
    expect(fn).toEqual({
      definer: true,
      config: ['search_path=""'],
      anon: false,
      authenticated: true,
      public_role: false,
    });
  });
});
