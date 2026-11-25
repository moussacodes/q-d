import { createClient } from '@supabase/supabase-js';

import { createMemoryStorage } from './storageFallbacks';
import {
  createSupabaseClient,
  getSupabase,
  isSupabaseConfigured,
  startSessionAutoRefresh,
} from './supabase';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() },
  })),
}));

// Stands in for the SQLite-backed localStorage that expo-sqlite installs.
jest.mock('expo-sqlite/localStorage/install', () => {
  (globalThis as { localStorage?: unknown }).localStorage = { sqlite: true };
});

const mockedCreateClient = createClient as jest.Mock;
const config = { url: 'https://abcd.supabase.co', publishableKey: 'sb_publishable_abc' };

type FakeClient = { auth: { startAutoRefresh: jest.Mock; stopAutoRefresh: jest.Mock } };

function fakeClient(): FakeClient {
  return { auth: { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() } };
}

function fakeAppState(currentState: string | null = 'active') {
  let listener: ((state: string) => void) | undefined;
  const remove = jest.fn();
  return {
    currentState,
    addEventListener: jest.fn((_type: 'change', next: (state: string) => void) => {
      listener = next;
      return { remove };
    }),
    emit: (state: string) => listener?.(state),
    remove,
  };
}

beforeEach(() => mockedCreateClient.mockClear());

describe('with no environment (mock mode)', () => {
  it('has no client and never creates one', () => {
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    expect(isSupabaseConfigured).toBe(false);
    expect(getSupabase()).toBeNull();
    expect(getSupabase()).toBeNull();
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it('does nothing about session refresh', () => {
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    const appState = fakeAppState();
    const stop = startSessionAutoRefresh(undefined, appState, 'ios');
    expect(appState.addEventListener).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});

describe('with a valid environment', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('creates one client, lazily, with the SQLite session storage', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = config.url;
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = config.publishableKey;
    jest.isolateModules(() => {
      const isolated = jest.requireActual<typeof import('./supabase')>('./supabase');
      const { createClient: isolatedCreate } = jest.requireMock<{ createClient: jest.Mock }>(
        '@supabase/supabase-js',
      );
      isolatedCreate.mockClear();
      expect(isolated.isSupabaseConfigured).toBe(true);
      expect(isolatedCreate).not.toHaveBeenCalled();
      const first = isolated.getSupabase();
      const second = isolated.getSupabase();
      expect(first).not.toBeNull();
      expect(second).toBe(first);
      expect(isolatedCreate).toHaveBeenCalledTimes(1);
      expect(isolatedCreate).toHaveBeenCalledWith(
        config.url,
        config.publishableKey,
        expect.objectContaining({
          auth: expect.objectContaining({ storage: { sqlite: true } }),
        }),
      );
    });
  });

  it('stays off when the key is a secret key', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    process.env.EXPO_PUBLIC_SUPABASE_URL = config.url;
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_secret_abc';
    jest.isolateModules(() => {
      const isolated = jest.requireActual<typeof import('./supabase')>('./supabase');
      expect(isolated.isSupabaseConfigured).toBe(false);
      expect(isolated.getSupabase()).toBeNull();
    });
  });
});

describe('createSupabaseClient', () => {
  it('persists and refreshes the session in the given storage, with PKCE', () => {
    const storage = createMemoryStorage();
    createSupabaseClient(config, storage);
    expect(mockedCreateClient).toHaveBeenCalledWith(config.url, config.publishableKey, {
      auth: {
        storage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
  });
});

describe('startSessionAutoRefresh', () => {
  it('refreshes while active and stops in the background', () => {
    const client = fakeClient();
    const appState = fakeAppState('active');
    const stop = startSessionAutoRefresh(client as never, appState, 'ios');
    expect(client.auth.startAutoRefresh).toHaveBeenCalledTimes(1);

    appState.emit('background');
    expect(client.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    appState.emit('inactive');
    expect(client.auth.stopAutoRefresh).toHaveBeenCalledTimes(2);
    appState.emit('active');
    expect(client.auth.startAutoRefresh).toHaveBeenCalledTimes(2);

    stop();
    expect(appState.remove).toHaveBeenCalled();
    expect(client.auth.stopAutoRefresh).toHaveBeenCalledTimes(3);
  });

  it('does not start when the app launches in the background', () => {
    const client = fakeClient();
    startSessionAutoRefresh(client as never, fakeAppState('background'), 'ios');
    expect(client.auth.startAutoRefresh).not.toHaveBeenCalled();
    expect(client.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('leaves the web to supabase-js', () => {
    const client = fakeClient();
    const appState = fakeAppState();
    startSessionAutoRefresh(client as never, appState, 'web')();
    expect(appState.addEventListener).not.toHaveBeenCalled();
    expect(client.auth.startAutoRefresh).not.toHaveBeenCalled();
  });
});
