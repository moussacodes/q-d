import { router, type Href } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { resetLiveCatalog } from '@/features/search/liveCatalog';
import {
  createFakeSupabase,
  fakeSession,
  fakeUser,
  flushAuthEvents,
  type FakeSupabase,
} from '@/test/fakeSupabase';
import { createFakeSupabaseData, rpcError, type FakeSupabaseData } from '@/test/fakeSupabaseData';
import { ids, liveCode, liveRoomTables } from '@/test/liveRoomFixture';

// Add a song in a live room (Forge card "Wire search / add-song to canonical
// search"): search goes to the catalog-search Edge Function (fetch is faked),
// adding goes to enqueue_recording (rpc is faked). The screens, hooks,
// adapter and services are the real ones. No network.
jest.setTimeout(60_000);

let mockAuth: FakeSupabase;
let mockData: FakeSupabaseData;
let mockClient: unknown;

jest.mock('@/services/dataMode', () => ({
  ...jest.requireActual('@/services/dataMode'),
  dataMode: 'live',
  isMockMode: false,
  authMode: 'live',
  isLiveAuth: true,
}));

jest.mock('@/services/env', () => ({
  ...jest.requireActual('@/services/env'),
  env: {
    ...jest.requireActual('@/services/env').env,
    supabase: { url: 'https://example-project.supabase.co', publishableKey: 'sb_publishable_x' },
  },
}));

jest.mock('@/services/supabase', () => ({
  ...jest.requireActual('@/services/supabase'),
  getSupabase: () => mockClient,
  startSessionAutoRefresh: () => () => {},
}));

/** A canonical search result: Apple's song, saved as a recording. */
const song = (recordingId: string, title: string, providerTrackId: string) => ({
  recordingId,
  track: {
    provider: 'apple_music',
    providerTrackId,
    title,
    artists: ['The Paper Lanterns'],
    album: 'Low Tide',
    durationMs: 201_000,
    isrc: null,
    explicit: false,
    artworkUrl: null,
    artworkBackgroundColor: null,
  },
  availableOn: ['apple_music'],
});

const newRecording = 'c0000000-0000-4000-8000-0000000000aa';

const searchAnswer = {
  storefront: 'us',
  results: [
    // Glass Harbor is playing in the room (fixture), Static Bloom is queued.
    song(ids.recA, 'Glass Harbor', '1001'),
    song(ids.recC, 'Static Bloom', '1003'),
    song(newRecording, 'Paper Moons', '1009'),
  ],
};

const fetchMock = jest.fn();

beforeEach(() => {
  mockAuth = createFakeSupabase();
  mockData = createFakeSupabaseData(liveRoomTables());
  mockClient = { ...mockAuth.client, ...mockData.client };
  resetLiveCatalog();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ status: 200, json: async () => searchAnswer });
  global.fetch = fetchMock as unknown as typeof fetch;
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

const rpcCalls = (name: string) =>
  mockData.rpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args);

/** Signed in as Sam (a member), in the live room's Add a song sheet, with results showing. */
async function openAddSong(userId = ids.guest) {
  mockAuth.setStoredSession(fakeSession(fakeUser({ id: userId })));
  await renderRouter('./app', { initialUrl: '/home' });
  await flushAuthEvents();
  await screen.findByText('Start a room or jump into one.');
  await act(async () => {
    router.push(`/room/QD-${liveCode}/add-song` as Href);
  });
  expect(await screen.findByText('Paper Moons')).toBeVisible();
}

describe('search, live', () => {
  it('searches the canonical catalog through the Edge Function', async () => {
    await openAddSong();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example-project.supabase.co/functions/v1/catalog-search',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.queryByText('Rain Down')).toBeNull();
  });

  it('says a song isn’t matched on Spotify yet, never "Not on Spotify"', async () => {
    await openAddSong();
    expect(screen.getAllByText('Spotify version not matched yet')).toHaveLength(3);
    expect(screen.queryByText('Not on Spotify')).toBeNull();
  });

  it('keeps unmatched songs under the Spotify filter: they aren’t ruled out', async () => {
    await openAddSong();
    await act(async () => {
      fireEvent.press(screen.getByText('Spotify'));
    });
    expect(screen.getByText('Paper Moons')).toBeVisible();
  });

  it('marks songs already in the room by their recording', async () => {
    await openAddSong();
    expect(screen.getByText('Playing')).toBeVisible();
    expect(screen.getByText('In queue')).toBeVisible();
  });

  it('says search isn’t working when the function fails, never showing a raw error', async () => {
    fetchMock.mockResolvedValue({
      status: 502,
      json: async () => ({ code: 'provider_unavailable', message: 'apple said 500' }),
    });
    mockAuth.setStoredSession(fakeSession(fakeUser({ id: ids.guest })));
    await renderRouter('./app', { initialUrl: '/home' });
    await flushAuthEvents();
    await screen.findByText('Start a room or jump into one.');
    await act(async () => {
      router.push(`/room/QD-${liveCode}/add-song` as Href);
    });
    expect(
      await screen.findByText('Search isn’t working right now. Try again in a moment.'),
    ).toBeVisible();
    expect(screen.queryByText(/apple said/)).toBeNull();
  });
});

describe('adding, live', () => {
  it('adds with enqueue_recording and the recording the server saved, then says its place', async () => {
    mockData.rpc.mockImplementation(async (name, args) => {
      if (name !== 'enqueue_recording') return rpcError('x');
      mockData.insert('queue_entries', {
        id: 'e0000000-0000-4000-8000-0000000000aa',
        room_id: ids.room,
        recording_id: args.recording_id,
        position: 3,
        added_by: ids.guest,
        status: 'queued',
      });
      mockData.insert('recordings', {
        id: newRecording,
        title: 'Paper Moons',
        primary_artist: 'The Paper Lanterns',
        artists: ['The Paper Lanterns'],
        album: 'Low Tide',
        duration_ms: 201_000,
        explicit: false,
      });
      return {
        data: { entry_id: 'e0000000-0000-4000-8000-0000000000aa', position: 3, queue_length: 3 },
        error: null,
      };
    });
    await openAddSong();
    await press('Add Paper Moons');
    expect(rpcCalls('enqueue_recording')).toEqual([
      {
        room_id: ids.room,
        recording_id: newRecording,
        allow_duplicate: false,
        idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    ]);
    expect(await screen.findByText(/Paper Moons added · 3rd in line/)).toBeVisible();
    await waitFor(() => expect(screen.getByText('Added')).toBeVisible());
  });

  it('asks before adding a song that’s already queued, then sends allow_duplicate', async () => {
    mockData.rpc
      .mockResolvedValueOnce(rpcError('already_in_queue', { status: 'queued' }))
      .mockResolvedValueOnce({
        data: { entry_id: 'e0000000-0000-4000-8000-0000000000ab', position: 3, queue_length: 3 },
        error: null,
      });
    await openAddSong();
    await press('Add Static Bloom');
    expect(await screen.findByText('Already in queue. Add it again?')).toBeVisible();
    await press('Add Static Bloom again');
    const [first, second] = rpcCalls('enqueue_recording');
    expect(first.allow_duplicate).toBe(false);
    expect(second).toMatchObject({ recording_id: ids.recC, allow_duplicate: true });
    // A confirmed add is a new intent, with its own key.
    expect(second.idempotency_key).not.toBe(first.idempotency_key);
    expect(await screen.findByText(/Static Bloom added/)).toBeVisible();
  });

  it('asks "Playing now" for the song that’s up', async () => {
    mockData.rpc.mockResolvedValue(rpcError('already_in_queue', { status: 'playing' }));
    await openAddSong();
    await press('Add Glass Harbor');
    expect(await screen.findByText('Playing now. Add it again?')).toBeVisible();
  });

  it('says "up now", not "playing now", for a song that starts an empty live room', async () => {
    mockData.tables.set('queue_entries', []);
    mockData.rpc.mockResolvedValue({
      data: { entry_id: 'e0000000-0000-4000-8000-0000000000ac', position: 0, queue_length: 0 },
      error: null,
    });
    await openAddSong();
    await press('Add Paper Moons');
    // On Spotify it isn't matched yet, and q’d doesn't play live rooms from here yet.
    expect(
      await screen.findByText(/Paper Moons added · up now · waiting for a Spotify match/),
    ).toBeVisible();
    expect(screen.queryByText(/playing now/)).toBeNull();
  });

  it.each([
    ['not_allowed', 'The room’s rules don’t let you add songs.'],
    ['room_ended', 'This room has ended.'],
    ['not_member', 'You’re not in this room any more.'],
  ])('shows the copy for %s', async (code, words) => {
    mockData.rpc.mockResolvedValue(rpcError(code));
    await openAddSong();
    await press('Add Paper Moons');
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it('says it can’t reach q’d when the add gets no answer', async () => {
    mockData.rpc.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await openAddSong();
    await press('Add Paper Moons');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Can’t reach q’d. Check your connection, then try again.',
    );
  });

  it('tries an add that got no answer again with the same key, so it can’t be queued twice', async () => {
    const added = {
      data: { entry_id: 'e0000000-0000-4000-8000-0000000000ac', position: 3, queue_length: 3 },
      error: null,
    };
    mockData.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } })
      .mockResolvedValueOnce(added)
      .mockResolvedValueOnce(added);
    await openAddSong();
    await press('Add Paper Moons');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Can’t reach q’d/);
    await press('Add Paper Moons');
    expect(await screen.findByText(/Paper Moons added · 3rd in line/)).toBeVisible();
    // Another song is another intent.
    await press('Add Static Bloom');
    const [first, retry, other] = rpcCalls('enqueue_recording');
    expect(retry).toEqual(first);
    expect(other.idempotency_key).not.toBe(first.idempotency_key);
  });

  it('keeps the key of an Add again that got no answer, with allow_duplicate still on', async () => {
    mockData.rpc
      .mockResolvedValueOnce(rpcError('already_in_queue', { status: 'queued' }))
      .mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } })
      .mockResolvedValueOnce({
        data: { entry_id: 'e0000000-0000-4000-8000-0000000000ab', position: 3, queue_length: 3 },
        error: null,
      });
    await openAddSong();
    await press('Add Static Bloom');
    await press('Add Static Bloom again');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Can’t reach q’d/);
    await press('Add Static Bloom again');
    const [ask, again, retry] = rpcCalls('enqueue_recording');
    expect(again).toMatchObject({ allow_duplicate: true });
    expect(again.idempotency_key).not.toBe(ask.idempotency_key);
    expect(retry).toEqual(again);
    expect(await screen.findByText(/Static Bloom added/)).toBeVisible();
  });

  it('takes the song back with remove_queue_entry on Undo', async () => {
    mockData.rpc.mockImplementation(async (name, args) => {
      if (name === 'enqueue_recording') {
        mockData.insert('queue_entries', {
          id: 'e0000000-0000-4000-8000-0000000000ad',
          room_id: ids.room,
          recording_id: ids.recA,
          position: 3,
          added_by: ids.guest,
          status: 'queued',
        });
        return {
          data: { entry_id: 'e0000000-0000-4000-8000-0000000000ad', position: 3, queue_length: 3 },
          error: null,
        };
      }
      if (name === 'remove_queue_entry') {
        return { data: { entry_id: args.entry_id, queue_length: 2 }, error: null };
      }
      return rpcError('x');
    });
    await openAddSong();
    await press('Add Glass Harbor');
    await press('Undo adding Glass Harbor');
    expect(rpcCalls('remove_queue_entry')).toEqual([
      {
        room_id: ids.room,
        entry_id: 'e0000000-0000-4000-8000-0000000000ad',
        idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    ]);
  });
});
