/**
 * Rows for one live room, as the Supabase tables would hold them after
 * `create_room`, two joins and three `enqueue_recording` calls. Made up for
 * tests; nothing here is a real person or song.
 */
export const ids = {
  host: '11111111-1111-4111-8111-111111111111',
  guest: '22222222-2222-4222-8222-222222222222',
  other: '33333333-3333-4333-8333-333333333333',
  room: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  endedRoom: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  recA: 'c0000000-0000-4000-8000-00000000000a',
  recB: 'c0000000-0000-4000-8000-00000000000b',
  recC: 'c0000000-0000-4000-8000-00000000000c',
  entryA: 'e0000000-0000-4000-8000-00000000000a',
  entryB: 'e0000000-0000-4000-8000-00000000000b',
  entryC: 'e0000000-0000-4000-8000-00000000000c',
};

export const liveCode = 'K7M2P9';

export function liveRoomTables(): Record<string, Record<string, unknown>[]> {
  return {
    rooms: [
      {
        id: ids.room,
        name: 'Late Night Live',
        host_id: ids.host,
        state: 'live',
        playback_provider: 'spotify',
        code: liveCode,
        add_songs: 'everyone',
        control: 'host',
        created_at: '2026-11-25T20:00:00+00:00',
        ended_at: null,
      },
      {
        // An older, ended room that once had the same code.
        id: ids.endedRoom,
        name: 'Old One',
        host_id: ids.host,
        state: 'ended',
        playback_provider: 'spotify',
        code: liveCode,
        add_songs: 'everyone',
        control: 'host',
        created_at: '2026-11-01T20:00:00+00:00',
        ended_at: '2026-11-01T23:00:00+00:00',
      },
    ],
    room_members: [
      { room_id: ids.room, user_id: ids.guest, role: 'member' },
      { room_id: ids.room, user_id: ids.host, role: 'host' },
      { room_id: ids.room, user_id: ids.other, role: 'member' },
      { room_id: ids.endedRoom, user_id: ids.guest, role: 'member' },
    ],
    profiles: [
      {
        id: ids.host,
        display_name: 'Rowan',
        color: '#8fb4f0',
        adult_confirmed_at: '2026-11-20T12:00:00Z',
      },
      {
        id: ids.guest,
        display_name: 'Sam',
        color: '#ff8a5b',
        adult_confirmed_at: '2026-11-20T12:00:00Z',
      },
      // Joined before finishing a profile (or a profile the app can't read).
      { id: ids.other, display_name: null, color: null, adult_confirmed_at: null },
    ],
    room_rule_members: [{ room_id: ids.room, rule: 'control', user_id: ids.guest }],
    recordings: [
      {
        id: ids.recA,
        title: 'Glass Harbor',
        primary_artist: 'The Paper Lanterns',
        artists: ['The Paper Lanterns'],
        album: 'Low Tide',
        duration_ms: 201_000,
        explicit: false,
      },
      {
        id: ids.recB,
        title: 'Northbound',
        primary_artist: 'Ivy Marsh',
        artists: [],
        album: null,
        duration_ms: 185_500,
        explicit: true,
      },
      {
        id: ids.recC,
        title: 'Static Bloom',
        primary_artist: 'Wren & Vale',
        artists: ['Wren & Vale'],
        album: 'Bloom',
        duration_ms: 240_000,
        explicit: false,
      },
    ],
    queue_entries: [
      {
        id: ids.entryB,
        room_id: ids.room,
        recording_id: ids.recB,
        position: 2,
        added_by: ids.host,
        status: 'queued',
      },
      {
        id: ids.entryA,
        room_id: ids.room,
        recording_id: ids.recA,
        position: 0,
        added_by: ids.guest,
        status: 'playing',
      },
      {
        id: ids.entryC,
        room_id: ids.room,
        recording_id: ids.recC,
        position: 1,
        added_by: ids.guest,
        status: 'queued',
      },
      {
        id: 'e0000000-0000-4000-8000-0000000000ff',
        room_id: ids.room,
        recording_id: ids.recC,
        position: 5,
        added_by: ids.guest,
        status: 'removed',
      },
    ],
    track_matches: [
      {
        recording_id: ids.recA,
        provider: 'spotify',
        provider_track_id: 'sp-a',
        confidence: 100,
        method: 'isrc',
        warning: null,
      },
      {
        recording_id: ids.recC,
        provider: 'spotify',
        provider_track_id: null,
        confidence: 0,
        method: 'score',
        warning: null,
      },
    ],
  };
}
