import { router, type Href } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { forgetLiveInvites } from '@/features/room/liveRoom';
import type { ConnectionState } from '@/providers';
import { addLogSink, type LogEntry } from '@/services/logger';
import {
  createFakeSupabase,
  fakeSession,
  fakeUser,
  flushAuthEvents,
  type FakeSupabase,
} from '@/test/fakeSupabase';
import { createFakeSupabaseData, rpcError, type FakeSupabaseData } from '@/test/fakeSupabaseData';
import { ids, liveCode, liveRoomTables } from '@/test/liveRoomFixture';

// Record real provider connections in provider_connections (Forge card).
// Supabase is faked at the service boundary and the provider calls are
// mocked (`connectProvider` and `storedConnection` stand in for real Spotify
// with the `realSpotify` flag on). The screens, ProviderConnections, the
// reconcile logic and services/providerConnections.ts are the real ones.
// `create_room` is answered the way the server decides: only with a
// `provider_connections` row for the host and the room's service.
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

jest.mock('@/services/supabase', () => ({
  ...jest.requireActual('@/services/supabase'),
  getSupabase: () => mockClient,
  startSessionAutoRefresh: () => () => {},
}));

jest.mock('@/providers', () => {
  const actual = jest.requireActual('@/providers');
  return {
    ...actual,
    connectProvider: jest.fn(actual.connectProvider),
    disconnectProvider: jest.fn(async () => {}),
    storedConnection: jest.fn(async () => null),
  };
});

const providers = jest.requireMock('@/providers') as {
  connectProvider: jest.Mock<Promise<ConnectionState>, [string]>;
  disconnectProvider: jest.Mock<Promise<void>, [string]>;
  storedConnection: jest.Mock<Promise<ConnectionState | null>, [string]>;
};

const REAL: ConnectionState = { status: 'connected', isMock: false };

let entries: LogEntry[];
let consoleOutput: unknown[][];
let removeSink: () => void;

beforeEach(() => {
  mockAuth = createFakeSupabase();
  mockData = createFakeSupabaseData(liveRoomTables());
  mockClient = { ...mockAuth.client, ...mockData.client };
  forgetLiveInvites();
  providers.storedConnection.mockImplementation(async () => null);
  entries = [];
  consoleOutput = [];
  removeSink = addLogSink((entry) => entries.push(entry));
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation((...args) => void consoleOutput.push(args));
  }
  // The server's rule: a room plays only through a service the host has a row for.
  mockData.rpc.mockImplementation(async (name, args) => {
    if (name !== 'create_room') return rpcError('x');
    const recorded = mockData
      .rows('provider_connections')
      .some((row) => row.user_id === ids.host && row.provider === args.playback_provider);
    return recorded
      ? {
          data: { room_id: ids.room, code: liveCode, code_expires_at: '2026-11-26T20:00:00+00:00' },
          error: null,
        }
      : rpcError('provider_required', { provider: args.playback_provider });
  });
});

afterEach(() => {
  removeSink();
  jest.restoreAllMocks();
  providers.connectProvider.mockClear();
  providers.disconnectProvider.mockClear();
  providers.storedConnection.mockClear();
});

const press = async (label: string | RegExp, index = 0) => {
  await act(async () => {
    fireEvent.press((await screen.findAllByLabelText(label))[index]);
  });
};

const go = async (href: Href) => {
  await act(async () => {
    router.push(href);
  });
};

async function signInAsHost() {
  mockAuth.setStoredSession(fakeSession(fakeUser({ id: ids.host })));
  await renderRouter('./app', { initialUrl: '/home' });
  await flushAuthEvents();
  await screen.findByText('Start a room or jump into one.');
}

const connectionRows = () => mockData.rows('provider_connections');
const writes = (op: 'insert' | 'update' | 'delete') =>
  mockData.writes.filter((write) => write.table === 'provider_connections' && write.op === op);

/** Settings → Music services: swap the returning account's mock Spotify for a real one. */
async function connectRealSpotify() {
  providers.connectProvider.mockResolvedValueOnce(REAL);
  await go('/settings');
  await press('Disconnect Spotify');
  await press('Connect');
  await waitFor(() => expect(providers.connectProvider).toHaveBeenCalledWith('spotify'));
  await waitFor(() => expect(writes('insert')).toHaveLength(1));
}

describe('a real Connect', () => {
  it('records the host’s row, metadata only, and then a live room starts', async () => {
    await signInAsHost();
    await connectRealSpotify();
    expect(writes('insert')[0].values).toEqual({
      user_id: ids.host,
      provider: 'spotify',
      last_verified_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(connectionRows()).toEqual([expect.objectContaining({ user_id: ids.host })]);

    await go('/create-room');
    await press('Start room');
    await waitFor(() => expect(screen).toHavePathname(`/room/QD-${liveCode}`));
    expect(
      mockData.rpc.mock.calls.filter(([called]) => called === 'create_room').map(([, a]) => a),
    ).toEqual([expect.objectContaining({ playback_provider: 'spotify', mode: 'aux' })]);
  });

  it('a row write that failed is retried before hosting', async () => {
    mockData.failWrites('provider_connections', { message: 'Network request failed' });
    await signInAsHost();
    await connectRealSpotify();
    expect(connectionRows()).toEqual([]);
    // Still connected on this phone: the tokens are here.
    expect(await screen.findByLabelText('Disconnect Spotify')).toBeVisible();

    mockData.failWrites('provider_connections', null);
    await go('/create-room');
    await press('Start room');
    await waitFor(() => expect(screen).toHavePathname(`/room/QD-${liveCode}`));
    expect(writes('insert')).toHaveLength(2);
  });

  it('Disconnect deletes the row, and Start room asks for a service again', async () => {
    await signInAsHost();
    await connectRealSpotify();
    await press('Disconnect Spotify');
    await waitFor(() =>
      expect(writes('delete')).toEqual([
        expect.objectContaining({ filters: { user_id: ids.host, provider: 'spotify' } }),
      ]),
    );
    expect(connectionRows()).toEqual([]);
    expect(providers.disconnectProvider).toHaveBeenCalledWith('spotify');
  });
});

describe('a mock connection', () => {
  it('never writes a row, and the server’s provider_required is explained honestly', async () => {
    await signInAsHost();
    // The returning account's labeled mock Spotify.
    await go('/create-room');
    await press('Start room');
    expect(
      await screen.findByText(
        'Spotify is connected only as the mock on this phone. A live room needs a real Spotify connection.',
      ),
    ).toBeVisible();
    expect(screen).toHavePathname('/create-room');
    expect(mockData.writes.filter((write) => write.table === 'provider_connections')).toEqual([]);
  });

  it('connecting the mock writes nothing either', async () => {
    await signInAsHost();
    await go('/settings');
    await press('Connect'); // Apple Music, the mock
    expect(await screen.findByText('Mock connection · no Apple Music account used')).toBeVisible();
    await press('Disconnect Apple Music');
    expect(mockData.writes.filter((write) => write.table === 'provider_connections')).toEqual([]);
  });

  it('with no service at all, Start room stays off and says what’s needed', async () => {
    await signInAsHost();
    await go('/settings');
    await press('Disconnect Spotify');
    await go('/create-room');
    expect(await screen.findByText('Connect a music service to host')).toBeVisible();
    expect(screen.getByLabelText('Start room')).toBeDisabled();
    expect(mockData.rpc).not.toHaveBeenCalledWith('create_room', expect.anything());
  });
});

describe('startup reconcile', () => {
  it('no tokens on this phone but a row exists: the row is deleted', async () => {
    mockData.insert('provider_connections', { user_id: ids.host, provider: 'spotify' });
    providers.storedConnection.mockImplementation(async (provider) =>
      provider === 'spotify' ? { status: 'needs_authorization', isMock: false } : null,
    );
    await signInAsHost();
    await waitFor(() => expect(connectionRows()).toEqual([]));
    expect(writes('delete')).toHaveLength(1);
    expect(writes('insert')).toEqual([]);
  });

  it('real tokens that check out: the row is written and Spotify shows as really connected', async () => {
    providers.storedConnection.mockImplementation(async (provider) =>
      provider === 'spotify' ? REAL : null,
    );
    await signInAsHost();
    await waitFor(() => expect(connectionRows()).toHaveLength(1));
    await go('/create-room');
    await press('Start room');
    await waitFor(() => expect(screen).toHavePathname(`/room/QD-${liveCode}`));
    // Recorded once at startup; hosting didn't need to write again.
    expect(writes('insert')).toHaveLength(1);
  });

  it('an existing row is only marked checked', async () => {
    mockData.insert('provider_connections', {
      user_id: ids.host,
      provider: 'spotify',
      connected_at: '2026-11-01T00:00:00Z',
    });
    providers.storedConnection.mockImplementation(async (provider) =>
      provider === 'spotify' ? REAL : null,
    );
    await signInAsHost();
    await waitFor(() => expect(writes('update')).toHaveLength(1));
    expect(connectionRows()).toEqual([
      expect.objectContaining({
        connected_at: '2026-11-01T00:00:00Z',
        last_verified_at: expect.any(String),
      }),
    ]);
  });

  it('offline at startup: the row is kept', async () => {
    mockData.insert('provider_connections', { user_id: ids.host, provider: 'spotify' });
    providers.storedConnection.mockImplementation(async (provider) =>
      provider === 'spotify'
        ? { status: 'error', code: 'provider_unavailable', isMock: false }
        : null,
    );
    await signInAsHost();
    await waitFor(() => expect(providers.storedConnection).toHaveBeenCalledWith('spotify'));
    await act(async () => {});
    expect(connectionRows()).toHaveLength(1);
    expect(mockData.writes).toEqual([]);
  });

  it('a build that can’t check any service (flag off, no Apple path) touches nothing', async () => {
    mockData.insert('provider_connections', { user_id: ids.host, provider: 'apple_music' });
    await signInAsHost();
    await waitFor(() => expect(providers.storedConnection).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(mockData.writes).toEqual([]);
    expect(connectionRows()).toHaveLength(1);
  });
});

it('logs never hold the user id or a token', async () => {
  providers.storedConnection.mockImplementation(async (provider) =>
    provider === 'spotify' ? REAL : null,
  );
  mockData.failWrites('provider_connections', {
    code: '42501',
    message: `permission denied for ${ids.host} access_token=BQDcanarytoken`,
  });
  await signInAsHost();
  await waitFor(() => expect(writes('insert')).toHaveLength(1));
  await act(async () => {});
  const text = JSON.stringify({ entries, consoleOutput });
  expect(text).toContain('Connection row failed');
  expect(text).not.toContain(ids.host);
  expect(text).not.toContain('BQDcanarytoken');
});
