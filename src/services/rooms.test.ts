import { createFakeSupabaseData, rpcError } from '@/test/fakeSupabaseData';
import { ids, liveCode, liveRoomTables } from '@/test/liveRoomFixture';

import { roomReads, roomRpc, RoomReadError } from './rooms';

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const key = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';

describe('roomRpc', () => {
  it('create_room sends the contract’s arguments, always aux, and maps the result', async () => {
    const fake = createFakeSupabaseData();
    fake.rpc.mockResolvedValue({
      data: { room_id: ids.room, code: liveCode, code_expires_at: '2026-11-26T20:00:00+00:00' },
      error: null,
    });
    const result = await roomRpc.createRoom(fake.client, {
      name: 'Late Night Live',
      playbackProvider: 'spotify',
      addSongs: 'chosen',
      control: 'everyone',
      idempotencyKey: key,
    });
    expect(fake.rpc).toHaveBeenCalledWith('create_room', {
      name: 'Late Night Live',
      playback_provider: 'spotify',
      add_songs: 'chosen',
      control: 'everyone',
      mode: 'aux',
      idempotency_key: key,
    });
    expect(result).toEqual({
      ok: true,
      value: { roomId: ids.room, code: liveCode, codeExpiresAt: '2026-11-26T20:00:00+00:00' },
    });
  });

  it.each([
    [
      'joinRoomByCode',
      'join_room_by_code',
      { code: liveCode, idempotencyKey: key },
      { code: liveCode, idempotency_key: key },
      { room_id: ids.room },
      { roomId: ids.room },
    ],
    [
      'joinRoomByInvite',
      'join_room_by_invite',
      { token: 'T'.repeat(43), idempotencyKey: key },
      { token: 'T'.repeat(43), idempotency_key: key },
      { room_id: ids.room },
      { roomId: ids.room },
    ],
    [
      'createRoomInvite',
      'create_room_invite',
      { roomId: ids.room, idempotencyKey: key },
      { room_id: ids.room, idempotency_key: key },
      { token: 'T'.repeat(43), expires_at: '2026-11-26T20:00:00+00:00' },
      { token: 'T'.repeat(43), expiresAt: '2026-11-26T20:00:00+00:00' },
    ],
    [
      'endRoom',
      'end_room',
      { roomId: ids.room, idempotencyKey: key },
      { room_id: ids.room, idempotency_key: key },
      { room_id: ids.room, ended_at: '2026-11-25T23:00:00+00:00' },
      { roomId: ids.room, endedAt: '2026-11-25T23:00:00+00:00' },
    ],
    [
      'enqueueRecording',
      'enqueue_recording',
      { roomId: ids.room, recordingId: ids.recA, allowDuplicate: true, idempotencyKey: key },
      { room_id: ids.room, recording_id: ids.recA, allow_duplicate: true, idempotency_key: key },
      { entry_id: ids.entryA, position: 3, queue_length: 3 },
      { entryId: ids.entryA, position: 3, queueLength: 3 },
    ],
    [
      'reorderQueue',
      'reorder_queue',
      { roomId: ids.room, entryId: ids.entryB, afterEntryId: null, idempotencyKey: key },
      { room_id: ids.room, entry_id: ids.entryB, after_entry_id: null, idempotency_key: key },
      { entry_id: ids.entryB, position: 1, queue_length: 2 },
      { entryId: ids.entryB, position: 1, queueLength: 2 },
    ],
    [
      'removeQueueEntry',
      'remove_queue_entry',
      { roomId: ids.room, entryId: ids.entryB, idempotencyKey: key },
      { room_id: ids.room, entry_id: ids.entryB, idempotency_key: key },
      { entry_id: ids.entryB, queue_length: 1 },
      { entryId: ids.entryB, queueLength: 1 },
    ],
  ] as const)(
    '%s calls %s by name and maps its result',
    async (method, name, input, args, data, value) => {
      const fake = createFakeSupabaseData();
      fake.rpc.mockResolvedValue({ data, error: null });
      const call = roomRpc[method] as (client: unknown, input: unknown) => Promise<unknown>;
      expect(await call(fake.client, input)).toEqual({ ok: true, value });
      expect(fake.rpc).toHaveBeenCalledWith(name, args);
    },
  );

  it('passes the server’s errors through as codes', async () => {
    const fake = createFakeSupabaseData();
    fake.rpc.mockResolvedValue(rpcError('room_full'));
    expect(
      await roomRpc.joinRoomByCode(fake.client, { code: liveCode, idempotencyKey: key }),
    ).toEqual({ ok: false, error: { code: 'room_full' }, details: {} });
  });
});

describe('roomReads', () => {
  const fake = () => createFakeSupabaseData(liveRoomTables());

  it('finds the live room for a code, not an ended one that had it before', async () => {
    const room = await roomReads.roomByCode(fake().client, liveCode);
    expect(room).toMatchObject({ id: ids.room, ended: false, name: 'Late Night Live' });
  });

  it('finds nothing for a code that isn’t one of your rooms', async () => {
    expect(await roomReads.roomByCode(fake().client, 'ZZZZZZ')).toBeNull();
  });

  it('reads the room with its rules and chosen people', async () => {
    expect(await roomReads.detail(fake().client, ids.room)).toEqual({
      id: ids.room,
      name: 'Late Night Live',
      hostId: ids.host,
      ended: false,
      playsThrough: 'spotify',
      code: liveCode,
      addSongs: 'everyone',
      control: 'host',
      createdAt: '2026-11-25T20:00:00+00:00',
      chosen: { addSongs: [], control: [ids.guest] },
    });
  });

  it('reads members with their profiles, the host first, and keeps a member without a name', async () => {
    const members = await roomReads.members(fake().client, ids.room);
    expect(members).toEqual([
      { userId: ids.host, role: 'host', name: 'Rowan', color: '#8fb4f0' },
      { userId: ids.guest, role: 'member', name: 'Sam', color: '#ff8a5b' },
      { userId: ids.other, role: 'member', name: null, color: null },
    ]);
  });

  it('reads the queue: the playing entry, then the waiting ones by position, skipping removed', async () => {
    const { nowPlaying, queue } = await roomReads.queue(fake().client, ids.room);
    expect(nowPlaying).toMatchObject({
      entryId: ids.entryA,
      status: 'playing',
      recording: { title: 'Glass Harbor', artists: ['The Paper Lanterns'], durationMs: 201_000 },
      matches: { spotify: { providerTrackId: 'sp-a', method: 'isrc', confidence: 100 } },
    });
    expect(queue.map((e) => e.entryId)).toEqual([ids.entryC, ids.entryB]);
    // An empty artists list falls back to the primary artist.
    expect(queue[1].recording.artists).toEqual(['Ivy Marsh']);
    // A stored "not on Spotify" match comes through; an unmatched one stays empty.
    expect(queue[0].matches.spotify?.providerTrackId).toBeNull();
    expect(queue[1].matches).toEqual({});
  });

  it('reads an empty queue without asking for songs', async () => {
    const data = fake();
    data.tables.set('queue_entries', []);
    expect(await roomReads.queue(data.client, ids.room)).toEqual({ nowPlaying: null, queue: [] });
    expect(data.reads).not.toContain('recordings');
  });

  it('drops a row that doesn’t parse instead of showing it half-read', async () => {
    const data = fake();
    data.insert('queue_entries', {
      id: 'not-a-uuid',
      room_id: ids.room,
      recording_id: ids.recA,
      position: 3,
      added_by: null,
      status: 'queued',
    });
    const { queue } = await roomReads.queue(data.client, ids.room);
    expect(queue).toHaveLength(2);
  });

  it('leaves out an entry whose song it can’t read', async () => {
    const data = fake();
    data.tables.set(
      'recordings',
      data.rows('recordings').filter((r) => r.id !== ids.recB),
    );
    const { queue } = await roomReads.queue(data.client, ids.room);
    expect(queue.map((e) => e.entryId)).toEqual([ids.entryC]);
  });

  it('throws a read error, with no row data, when the table refuses', async () => {
    const data = fake();
    data.fail('rooms');
    await expect(roomReads.detail(data.client, ids.room)).rejects.toBeInstanceOf(RoomReadError);
  });

  it('lists your live rooms, newest first, without ended ones', async () => {
    const rooms = await roomReads.mine(fake().client, ids.guest);
    expect(rooms.map((r) => r.id)).toEqual([ids.room]);
    expect(await roomReads.mine(fake().client, '99999999-9999-4999-8999-999999999999')).toEqual([]);
  });
});
