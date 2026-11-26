import * as Clipboard from 'expo-clipboard';
import { router, type Href } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { forgetLiveInvites } from '@/features/room/liveRoom';
import {
  createFakeSupabase,
  fakeSession,
  fakeUser,
  flushAuthEvents,
  type FakeSupabase,
} from '@/test/fakeSupabase';
import { createFakeSupabaseData, rpcError, type FakeSupabaseData } from '@/test/fakeSupabaseData';
import { ids, liveCode, liveRoomTables } from '@/test/liveRoomFixture';

// Live room screens (Forge card "Wire room screens to live data"): Home, join,
// the room, Up next, Listeners and Invite read Supabase and call the RPCs.
// Supabase is faked at the service boundary (auth, tables, rpc, Realtime);
// the screens, hooks and services are the real ones. Nothing here touches
// the network, and nothing here proves it works against a real project.
jest.setTimeout(60_000);

let mockAuth: FakeSupabase;
let mockData: FakeSupabaseData;
/** One client for the whole test, like supabase.ts's singleton. */
let mockClient: unknown;

jest.mock('@/services/dataMode', () => ({
  ...jest.requireActual('@/services/dataMode'),
  dataMode: 'live',
  isMockMode: false,
  authMode: 'live',
  isLiveAuth: true,
}));

jest.mock('@/services/supabase', () => ({
  ...jest.requireActual('@/services/supabase'),
  getSupabase: () => mockClient,
  startSessionAutoRefresh: () => () => {},
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));

const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

beforeEach(() => {
  mockAuth = createFakeSupabase();
  mockData = createFakeSupabaseData(liveRoomTables());
  mockClient = { ...mockAuth.client, ...mockData.client };
  forgetLiveInvites();
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const press = async (label: string | RegExp) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const pressText = async (text: string | RegExp) => {
  await act(async () => {
    fireEvent.press(await screen.findByText(text));
  });
};

/** Restores a signed-in Supabase session for `userId`, with a finished profile, on Home. */
async function signInAs(userId: string, initialUrl = '/home') {
  mockAuth.setStoredSession(fakeSession(fakeUser({ id: userId })));
  // The auth service reads `profiles` through `from`, which the data fake serves.
  await renderRouter('./app', { initialUrl: '/home' });
  await flushAuthEvents();
  await screen.findByText('Start a room or jump into one.');
  if (initialUrl !== '/home') {
    await act(async () => {
      router.push(initialUrl as Href);
    });
  }
}

const rpcCalls = (name: string) =>
  mockData.rpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args);

/** The room's Realtime channel, once the room screen joined it. */
const roomChannel = () => {
  const channel = mockData.realtime.channels.filter((c) => c.name === `room:${ids.room}`).at(-1);
  if (!channel) throw new Error('room channel not joined');
  return channel;
};

async function joinChannel() {
  await waitFor(() => roomChannel());
  await act(async () => {
    roomChannel().status?.('SUBSCRIBED');
  });
}

async function broadcast(type: string) {
  await act(async () => {
    roomChannel().send({ v: 1, type, roomId: ids.room, at: '2026-11-25T21:00:00.000Z' });
  });
}

async function openRoom(userId = ids.guest) {
  await signInAs(userId, `/room/QD-${liveCode}`);
  expect(await screen.findByText('Late Night Live')).toBeVisible();
}

describe('Home, live', () => {
  it('lists the live rooms you’re in, with their host and size, and no sample rooms', async () => {
    await signInAs(ids.guest);
    expect(await screen.findByText('Late Night Live')).toBeVisible();
    expect(screen.getByText(/Hosted by Rowan · 3 people/)).toBeVisible();
    expect(screen.queryByText('Kitchen Disco')).toBeNull();
    expect(screen.queryByText('Old One')).toBeNull();
    expect(screen.queryByText(/Mock data/)).toBeNull();
  });
});

describe('joining with a code, live', () => {
  const typeCode = async (code: string) => {
    await act(async () => {
      fireEvent.changeText(await screen.findByLabelText('Room code'), code);
    });
  };

  it('calls join_room_by_code with a key, then opens the room it joined', async () => {
    mockData.rpc.mockImplementation(async (name) =>
      name === 'join_room_by_code' ? { data: { room_id: ids.room }, error: null } : rpcError('x'),
    );
    await signInAs(ids.guest);
    await typeCode('k7m2p9');
    await press('Join');
    expect(rpcCalls('join_room_by_code')).toEqual([
      { code: liveCode, idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    ]);
    await waitFor(() => expect(screen).toHavePathname(`/room/QD-${liveCode}`));
    expect(await screen.findByText('Glass Harbor')).toBeVisible();
  });

  it.each([
    ['room_full', 'That room is full. Rooms hold up to 15 people.'],
    ['room_ended', 'That room has ended. Ask the host for a new code.'],
    ['profile_incomplete', 'Finish your profile before joining a room.'],
  ])('shows the copy for %s and stays on Home', async (code, words) => {
    mockData.rpc.mockResolvedValue(rpcError(code));
    await signInAs(ids.guest);
    await typeCode('ZZZZZZ');
    await press('Join');
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
    expect(screen).toHavePathname('/home');
  });

  it('reads a counted wrong code (the HTTP 400 path) like any other', async () => {
    mockData.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'code_invalid', details: null, hint: 'qd' },
      status: 400,
    });
    await signInAs(ids.guest);
    await typeCode('ZZZZZZ');
    await press('Join');
    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn’t match a room/);
  });

  it('says how long to wait when rate limited', async () => {
    mockData.rpc.mockResolvedValue(rpcError('rate_limited', { retry_after_seconds: 42 }));
    await signInAs(ids.guest);
    await typeCode('ZZZZZZ');
    await press('Join');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many tries. Wait 42 seconds, then try again.',
    );
  });

  it('says it can’t reach q’d with no answer, and the retry reuses the same key', async () => {
    mockData.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'TypeError: Network request failed' },
      })
      .mockResolvedValueOnce({ data: { room_id: ids.room }, error: null });
    await signInAs(ids.guest);
    await typeCode('K7M2P9');
    await press('Join');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Can’t reach q’d. Check your connection, then try again.',
    );
    await press('Join');
    const [first, second] = rpcCalls('join_room_by_code');
    expect(second.idempotency_key).toBe(first.idempotency_key);
    await waitFor(() => expect(screen).toHavePathname(`/room/QD-${liveCode}`));
  });

  it('uses a new key after an answered error (a new intent)', async () => {
    mockData.rpc.mockResolvedValue(rpcError('code_invalid'));
    await signInAs(ids.guest);
    await typeCode('ZZZZZZ');
    await press('Join');
    await screen.findByRole('alert');
    await press('Join');
    const [first, second] = rpcCalls('join_room_by_code');
    expect(second.idempotency_key).not.toBe(first.idempotency_key);
  });
});

describe('the room, live', () => {
  it('shows the room from Supabase: now playing, the queue in order, and who added what', async () => {
    await openRoom();
    expect(screen.getByText('Glass Harbor')).toBeVisible();
    expect(screen.getByText('2 songs')).toBeVisible();
    expect(screen.getByText('Static Bloom')).toBeVisible();
    expect(screen.getByText('Northbound')).toBeVisible();
    // A stored "not on Spotify" match says so in the queue.
    expect(screen.getByText('Not on Spotify · the host can skip it')).toBeVisible();
  });

  it('says playback isn’t live yet, with play, skip and repeat off', async () => {
    await openRoom(ids.host);
    expect(screen.getByText(/Playback isn’t connected to live rooms yet/)).toBeVisible();
    expect(screen.getByLabelText('Play')).toBeDisabled();
    expect(screen.getByLabelText('Skip')).toBeDisabled();
    expect(screen.getByLabelText('Repeat this song')).toBeDisabled();
  });

  it.each([
    ['isn’t on the room’s service', 'Not on Spotify', { provider_track_id: null, confidence: 0 }],
    ['has an uncertain match', 'Might be a different version', { warning: 'low_confidence' }],
  ])(
    'never offers the host a Skip that does nothing when the song %s',
    async (_case, title, change) => {
      mockData.update('track_matches', (row) => row.recording_id === ids.recA, change);
      await openRoom(ids.host);
      expect(await screen.findByText(title)).toBeVisible();
      expect(screen.getByLabelText('Skip this song')).toBeDisabled();
      expect(screen.getByText(/Skip comes with it/)).toBeVisible();
    },
  );

  it('says a room you aren’t in isn’t open to you', async () => {
    await signInAs(ids.guest, '/room/QD-ZZZZZZ');
    expect(await screen.findByText('This room isn’t open to you')).toBeVisible();
    await press('Back to Home');
    expect(screen).toHavePathname('/home');
  });

  it('says it couldn’t load the room when the read fails, and Try again reads it again', async () => {
    mockData.fail('rooms');
    await signInAs(ids.guest, `/room/QD-${liveCode}`);
    expect(
      await screen.findByText('Couldn’t load the room', {}, { timeout: 20_000 }),
    ).toBeVisible();
    mockData.fail('rooms', false);
    await press('Try again');
    expect(await screen.findByText('Late Night Live')).toBeVisible();
  });

  it('says it couldn’t load the room when only the queue can’t be read, never an empty queue', async () => {
    mockData.fail('queue_entries');
    await signInAs(ids.host, `/room/QD-${liveCode}`);
    expect(
      await screen.findByText('Couldn’t load the room', {}, { timeout: 20_000 }),
    ).toBeVisible();
    expect(screen.queryByText(/first song/i)).toBeNull();
    mockData.fail('queue_entries', false);
    await press('Try again');
    expect(await screen.findByText('Glass Harbor')).toBeVisible();
  });

  it('keeps showing the room when a refetch fails after it loaded', async () => {
    await openRoom();
    await joinChannel();
    mockData.fail('queue_entries');
    const before = mockData.reads.filter((table) => table === 'queue_entries').length;
    await broadcast('queue.changed');
    // The refetch was tried and failed; the room stays as it was read.
    await waitFor(() =>
      expect(mockData.reads.filter((table) => table === 'queue_entries').length).toBeGreaterThan(
        before,
      ),
    );
    expect(screen.getByText('Late Night Live')).toBeVisible();
    expect(screen.getByText('Static Bloom')).toBeVisible();
    expect(screen.queryByText('Couldn’t load the room')).toBeNull();
  });

  it('joins the room’s private channel and tracks only the user id and role', async () => {
    await openRoom();
    await joinChannel();
    expect(roomChannel().options).toEqual({
      config: { private: true, presence: { key: ids.guest } },
    });
    expect(roomChannel().tracked).toEqual([{ v: 1, userId: ids.guest, role: 'member' }]);
  });

  it('refetches the queue when queue.changed arrives, never trusting the payload', async () => {
    await openRoom();
    await joinChannel();
    mockData.insert('queue_entries', {
      id: 'e0000000-0000-4000-8000-00000000000d',
      room_id: ids.room,
      recording_id: ids.recA,
      position: 3,
      added_by: ids.host,
      status: 'queued',
    });
    await broadcast('queue.changed');
    await waitFor(() => expect(screen.getByText('3 songs')).toBeVisible());
  });

  it('shows the host reconnecting when their presence leaves', async () => {
    await openRoom();
    await joinChannel();
    await act(async () => {
      roomChannel().state = {
        [ids.host]: [{ v: 1, userId: ids.host, role: 'host' }],
        [ids.guest]: [{ v: 1, userId: ids.guest, role: 'member' }],
      };
      roomChannel().sync?.();
    });
    expect(screen.queryByText('Host reconnecting')).toBeNull();
    await act(async () => {
      roomChannel().state = { [ids.guest]: [{ v: 1, userId: ids.guest, role: 'member' }] };
      roomChannel().sync?.();
    });
    expect(await screen.findByText('Host reconnecting')).toBeVisible();
  });

  it('says the room ended when room.ended arrives, and goes Home on a tap', async () => {
    await openRoom();
    await joinChannel();
    mockData.update('rooms', (row) => row.id === ids.room, {
      state: 'ended',
      ended_at: '2026-11-25T23:00:00+00:00',
    });
    await broadcast('room.ended');
    expect(await screen.findByText('This room has ended')).toBeVisible();
    expect(screen.getByText(/Rowan ended this room/)).toBeVisible();
    await press('Back to Home');
    expect(screen).toHavePathname('/home');
  });

  it('says you’re offline when the channel drops, with adding off until it’s back', async () => {
    await openRoom();
    await joinChannel();
    await act(async () => {
      roomChannel().status?.('CHANNEL_ERROR');
    });
    expect(await screen.findByText('You’re offline')).toBeVisible();
    expect(screen.getAllByLabelText('Add a song')[0]).toBeDisabled();
  });
});

describe('the host’s queue edits, live', () => {
  it('reorders with reorder_queue and removes with remove_queue_entry, then refetches', async () => {
    mockData.rpc.mockImplementation(async (name, args) => {
      if (name === 'reorder_queue') {
        return {
          data: { entry_id: args.entry_id, position: 1, queue_length: 2 },
          error: null,
        };
      }
      if (name === 'remove_queue_entry') {
        mockData.update('queue_entries', (row) => row.id === args.entry_id, {
          status: 'removed',
        });
        return { data: { entry_id: args.entry_id, queue_length: 1 }, error: null };
      }
      return rpcError('x');
    });
    await openRoom(ids.host);
    await press('Reorder or remove Northbound');
    await press('Move Northbound up');
    expect(rpcCalls('reorder_queue')).toEqual([
      {
        room_id: ids.room,
        entry_id: ids.entryB,
        after_entry_id: null,
        idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    ]);
    await press('Remove Northbound');
    expect(rpcCalls('remove_queue_entry')).toEqual([
      {
        room_id: ids.room,
        entry_id: ids.entryB,
        idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    ]);
    await waitFor(() => expect(screen.getByText('1 song')).toBeVisible());
  });

  it('says when the queue changed first, and shows it as it is now', async () => {
    mockData.rpc.mockResolvedValue(rpcError('stale_state', { status: 'playing' }));
    await openRoom(ids.host);
    await press('Reorder or remove Northbound');
    await press('Move Northbound up');
    expect(await screen.findByText(/The queue changed before that went through/)).toBeVisible();
  });

  it('gives a listener the rules’ answer: no edits unless chosen', async () => {
    // Sam is on the control rule's chosen list, but the rule is "host only".
    await openRoom(ids.guest);
    expect(screen.queryByLabelText('Reorder or remove Northbound')).toBeNull();
  });
});

describe('Listeners, live', () => {
  it('lists the members with names from their profiles, the host first', async () => {
    await openRoom();
    await press('Room options');
    expect(await screen.findByText('Rowan')).toBeVisible();
    expect(screen.getByText('Sam (you)')).toBeVisible();
    expect(screen.getByText('Someone')).toBeVisible();
    expect(screen.getByText('3 people in the room')).toBeVisible();
  });

  it('lets the host end the room with end_room after asking, then goes Home', async () => {
    mockData.rpc.mockImplementation(async (name) =>
      name === 'end_room'
        ? { data: { room_id: ids.room, ended_at: '2026-11-25T23:00:00+00:00' }, error: null }
        : name === 'create_room_invite'
          ? { data: { token, expires_at: '2026-11-26T20:00:00+00:00' }, error: null }
          : rpcError('x'),
    );
    await signInAs(ids.host, `/room/QD-${liveCode}/listeners`);
    expect(
      await screen.findByText(/Changing the rules isn’t connected to live rooms yet/),
    ).toBeVisible();
    await pressText('End room');
    expect(screen.getByText('End Late Night Live?')).toBeVisible();
    await press('End Late Night Live for everyone');
    expect(rpcCalls('end_room')).toEqual([
      { room_id: ids.room, idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    ]);
    await waitFor(() => expect(screen).toHavePathname('/home'));
  });

  it('says so when ending fails, and keeps the room', async () => {
    mockData.rpc.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await signInAs(ids.host, `/room/QD-${liveCode}/listeners`);
    await pressText('End room');
    await press('End Late Night Live for everyone');
    expect(await screen.findByText(/Couldn’t end the room/)).toBeVisible();
  });

  it('never offers End room to a listener', async () => {
    await signInAs(ids.guest, `/room/QD-${liveCode}/listeners`);
    await screen.findByText('Rowan');
    expect(screen.queryByText('End room')).toBeNull();
  });
});

describe('invites, live', () => {
  it('makes an invite with create_room_invite and shows its link', async () => {
    mockData.rpc.mockResolvedValue({
      data: { token, expires_at: '2026-11-26T20:00:00+00:00' },
      error: null,
    });
    await signInAs(ids.host, `/room/QD-${liveCode}/invite`);
    await waitFor(() =>
      expect(rpcCalls('create_room_invite')).toEqual([
        { room_id: ids.room, idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      ]),
    );
    await waitFor(() => expect(screen.getByLabelText('Copy link')).toBeEnabled());
    await press('Copy link');
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(`qd://join?invite=${token}`);
  });

  it('joins from an invite link with join_room_by_invite', async () => {
    mockData.rpc.mockImplementation(async (name) =>
      name === 'join_room_by_invite' ? { data: { room_id: ids.room }, error: null } : rpcError('x'),
    );
    await signInAs(ids.guest, `/join?invite=${token}`);
    await waitFor(() => expect(screen).toHavePathname(`/room/QD-${liveCode}`));
    expect(rpcCalls('join_room_by_invite')).toEqual([
      { token, idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    ]);
  });

  it('says an invite doesn’t work any more', async () => {
    mockData.rpc.mockResolvedValue(rpcError('invite_invalid'));
    await signInAs(ids.guest, `/join?invite=${token}`);
    expect(await screen.findByText(/This invite doesn’t work anymore/)).toBeVisible();
  });
});

describe('starting a room, live', () => {
  it('needs a real music service: a mock connection gets provider_required from the server', async () => {
    mockData.rpc.mockResolvedValue(rpcError('provider_required', { provider: 'spotify' }));
    await signInAs(ids.guest, '/create-room');
    await press('Start room');
    expect(rpcCalls('create_room')).toEqual([
      {
        name: expect.any(String),
        playback_provider: 'spotify',
        add_songs: 'everyone',
        control: 'host',
        mode: 'aux',
        idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    ]);
    // The guest's connection is the labeled mock, which the server never counts.
    expect(
      await screen.findByText(
        'Spotify is connected only as the mock on this phone. A live room needs a real Spotify connection.',
      ),
    ).toBeVisible();
  });

  it('opens the new room once create_room answers', async () => {
    mockData.rpc.mockResolvedValue({
      data: { room_id: ids.room, code: liveCode, code_expires_at: '2026-11-26T20:00:00+00:00' },
      error: null,
    });
    await signInAs(ids.host, '/create-room');
    await press('Start room');
    await waitFor(() => expect(screen).toHavePathname(`/room/QD-${liveCode}`));
  });
});
