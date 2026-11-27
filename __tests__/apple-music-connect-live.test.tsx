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
import { createFakeSupabaseData, type FakeSupabaseData } from '@/test/fakeSupabaseData';
import { ids, liveRoomTables } from '@/test/liveRoomFixture';

// Apple Music connection (Forge card), live auth mode with the
// `realAppleMusic` flag on. The qd-music-kit native module is a fake
// (src/test/fakeMusicKit.ts), standing in for the Swift side that only
// exists on the Mac; everything from Settings down to the
// provider_connections write is real.
jest.setTimeout(60_000);

let mockAuth: FakeSupabase;
let mockData: FakeSupabaseData;
let mockClient: unknown;
const mockKit: {
  fake: ReturnType<typeof import('@/test/fakeMusicKit').createFakeMusicKit> | null;
} = { fake: null };

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

jest.mock('@/services/flags', () => ({
  ...jest.requireActual('@/services/flags'),
  isEnabled: (flag: string) => flag === 'realAppleMusic',
}));

jest.mock('@/services/providerCredentials', () => {
  const actual = jest.requireActual('@/services/providerCredentials');
  const values = new Map<string, string>();
  return {
    ...actual,
    providerCredentials: actual.createProviderCredentialStore({
      persistent: true,
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => void values.set(key, value),
      deleteItem: async (key: string) => void values.delete(key),
    }),
  };
});

// The wrapper is real; only the Swift module under it is faked. With
// `mockKit.fake` null it's Expo Go: no native module.
jest.mock('../modules/qd-music-kit', () => {
  const actual = jest.requireActual('../modules/qd-music-kit');
  const methods = [
    'availability',
    'authorizationStatus',
    'requestAuthorization',
    'subscription',
    'storefront',
    'capabilities',
    'connect',
    'prepare',
    'play',
    'pause',
    'seek',
    'enqueue',
    'getState',
    'disconnect',
  ];
  const kit = () => actual.createQdMusicKit(mockKit.fake?.native ?? null, 'ios');
  return {
    ...actual,
    QdMusicKit: Object.fromEntries([
      ['provider', 'apple_music'],
      ...methods.map((name) => [name, (...args: unknown[]) => kit()[name](...args)]),
    ]),
  };
});

const { createFakeMusicKit } = jest.requireActual(
  '@/test/fakeMusicKit',
) as typeof import('@/test/fakeMusicKit');
const { providerCredentials } = jest.requireMock('@/services/providerCredentials') as {
  providerCredentials: import('@/services/providerCredentials').ProviderCredentialStore;
};

beforeEach(async () => {
  mockAuth = createFakeSupabase();
  mockData = createFakeSupabaseData(liveRoomTables());
  mockClient = { ...mockAuth.client, ...mockData.client };
  mockKit.fake = createFakeMusicKit();
  await providerCredentials.clearAll();
  forgetLiveInvites();
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => jest.restoreAllMocks());

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

const writes = (op: 'insert' | 'update' | 'delete') =>
  mockData.writes.filter((write) => write.table === 'provider_connections' && write.op === op);

async function signInAsHost() {
  mockAuth.setStoredSession(fakeSession(fakeUser({ id: ids.host })));
  await renderRouter('./app', { initialUrl: '/home' });
  await flushAuthEvents();
  await screen.findByText('Start a room or jump into one.');
}

it('Connect asks MusicKit and records the row with the storefront, never a token', async () => {
  await signInAsHost();
  await go('/settings');
  await press('Connect');
  await waitFor(() => expect(writes('insert')).toHaveLength(1));
  expect(writes('insert')[0].values).toEqual({
    user_id: ids.host,
    provider: 'apple_music',
    last_verified_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    storefront: 'us',
  });
  expect(mockKit.fake!.native.requestAuthorization).toHaveBeenCalledTimes(1);
  expect(await screen.findByLabelText('Disconnect Apple Music')).toBeVisible();
});

it('in Expo Go (no native module) Apple Music says it needs the q’d app build', async () => {
  mockKit.fake = null;
  await signInAsHost();
  await go('/settings');
  await press('Connect');
  expect(
    await screen.findByText(
      'Apple Music needs the q’d app build. It can’t connect in Expo Go or on the web.',
    ),
  ).toBeVisible();
  expect(screen.queryByLabelText('Disconnect Apple Music')).toBeNull();
  expect(writes('insert')).toEqual([]);
});

it('a refused permission points to iOS Settings and writes nothing', async () => {
  mockKit.fake = createFakeMusicKit({ authorization: 'denied' });
  await signInAsHost();
  await go('/settings');
  await press('Connect');
  expect(
    await screen.findByText(
      'q’d doesn’t have access to Apple Music. Turn it on in Settings › q’d, then try again.',
    ),
  ).toBeVisible();
  expect(writes('insert')).toEqual([]);
});

it('no subscription asks for one and writes nothing', async () => {
  mockKit.fake = createFakeMusicKit({ subscribed: false });
  await signInAsHost();
  await go('/settings');
  await press('Connect');
  expect(
    await screen.findByText('An Apple Music subscription is needed to play rooms.'),
  ).toBeVisible();
  expect(writes('insert')).toEqual([]);
});

it('startup: a phone that connected before shows Apple Music connected and marks the row checked', async () => {
  mockKit.fake = createFakeMusicKit({ authorization: 'authorized' });
  await providerCredentials.save('apple_music', {
    accessToken: 'musickit-authorized-on-this-phone',
  });
  await signInAsHost();
  await waitFor(() => expect(writes('insert')).toHaveLength(1));
  expect(writes('insert')[0].values).toMatchObject({ provider: 'apple_music', storefront: 'us' });
  expect(mockKit.fake.native.requestAuthorization).not.toHaveBeenCalled();
});

it('startup: iOS still authorized but no marker for this account deletes the stale row', async () => {
  mockKit.fake = createFakeMusicKit({ authorization: 'authorized' });
  await signInAsHost();
  await waitFor(() =>
    expect(writes('delete')).toEqual([
      expect.objectContaining({ filters: { user_id: ids.host, provider: 'apple_music' } }),
    ]),
  );
  expect(writes('insert')).toEqual([]);
});

it('Disconnect forgets the marker and deletes the row', async () => {
  await signInAsHost();
  await go('/settings');
  await press('Connect');
  await press('Disconnect Apple Music');
  await waitFor(() => expect(writes('delete').length).toBeGreaterThan(0));
  await waitFor(async () => expect(await providerCredentials.peek('apple_music')).toBe('none'));
});
