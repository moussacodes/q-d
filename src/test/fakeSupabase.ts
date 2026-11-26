import type { SupabaseClient } from '@supabase/supabase-js';
import { act } from 'expo-router/testing-library';

/**
 * A stand-in for the Supabase client at the service boundary: just the auth
 * calls, the `profiles` read that services/auth.ts makes and the own-row
 * `profiles` update that services/profiles.ts makes (it changes the profile
 * the next read returns, like the real table). Each method is a
 * jest.fn, so tests set results and check calls. `emit` plays an auth event
 * to every `onAuthStateChange` listener, the way supabase-js does.
 */

export type FakeAuthEvent =
  'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED';

export interface FakeUser {
  id: string;
  email?: string;
  app_metadata: { provider?: string };
  user_metadata?: Record<string, unknown>;
  identities?: unknown[];
}

export interface FakeSession {
  access_token: string;
  refresh_token: string;
  user: FakeUser;
}

export const fakeUser = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  id: 'user-1',
  email: 'someone@example.com',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  identities: [{ id: 'identity-1' }],
  ...overrides,
});

export const fakeSession = (user: FakeUser = fakeUser()): FakeSession => ({
  access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXZhbHVl',
  refresh_token: 'refresh-token-value-abcdefghijklmnop',
  user,
});

type ProfileRow = {
  display_name: string | null;
  color: string | null;
  adult_confirmed_at: string | null;
};

export const completeProfile: ProfileRow = {
  display_name: 'Sam',
  color: '#ff8a5b',
  adult_confirmed_at: '2026-11-20T12:00:00Z',
};

export function createFakeSupabase() {
  const listeners = new Set<(event: FakeAuthEvent, session: FakeSession | null) => void>();
  let initialSession: FakeSession | null = null;
  let profile: { data: ProfileRow | null; error: { code: string } | null } = {
    data: null,
    error: null,
  };

  const maybeSingle = jest.fn(async () => profile);
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));

  type WriteAnswer = {
    data: { id: string }[] | null;
    error: { code?: string; message?: string } | null;
  };
  /** Answers the next profile writes; by default each one succeeds and is kept. */
  const writeProfile = jest.fn(
    async (columns: Partial<ProfileRow>, userId: string): Promise<WriteAnswer> => {
      profile = {
        data: {
          ...(profile.data ?? { display_name: null, color: null, adult_confirmed_at: null }),
          ...columns,
        },
        error: null,
      };
      return { data: [{ id: userId }], error: null };
    },
  );
  const update = jest.fn((columns: Partial<ProfileRow>) => ({
    eq: (_column: string, userId: string) => ({
      select: () => writeProfile(columns, userId),
    }),
  }));
  const from = jest.fn(() => ({ select, update }));

  const auth = {
    signInWithPassword: jest.fn(async () => ({
      data: { user: fakeUser(), session: fakeSession() },
      error: null as unknown,
    })),
    signUp: jest.fn(async () => ({
      data: { user: fakeUser(), session: fakeSession() as FakeSession | null },
      error: null as unknown,
    })),
    signOut: jest.fn(async () => ({ error: null as unknown })),
    signInWithOAuth: jest.fn(async () => ({
      data: {
        provider: 'google',
        url: 'https://abcd.supabase.co/auth/v1/authorize?provider=google',
      },
      error: null as unknown,
    })),
    exchangeCodeForSession: jest.fn(async () => ({
      data: { user: fakeUser(), session: fakeSession() },
      error: null as unknown,
    })),
    getSession: jest.fn(async () => ({ data: { session: initialSession }, error: null })),
    startAutoRefresh: jest.fn(async () => {}),
    stopAutoRefresh: jest.fn(async () => {}),
    onAuthStateChange: jest.fn(
      (listener: (event: FakeAuthEvent, session: FakeSession | null) => void) => {
        listeners.add(listener);
        // supabase-js reports the stored session to each new listener.
        queueMicrotask(() => listener('INITIAL_SESSION', initialSession));
        return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
      },
    ),
  };

  return {
    client: { auth, from } as unknown as SupabaseClient,
    auth,
    from,
    profileQuery: { select, eq, maybeSingle },
    /** The own-row profile update: `update` gets the columns, `writeProfile` answers. */
    profileWrite: { update, writeProfile },
    /** The profile row as the fake table holds it now. */
    currentProfile: () => profile.data,
    listenerCount: () => listeners.size,
    /** The session supabase-js finds in storage when a listener subscribes. */
    setStoredSession(session: FakeSession | null) {
      initialSession = session;
    },
    setProfile(data: ProfileRow | null, error: { code: string } | null = null) {
      profile = { data, error };
    },
    emit(event: FakeAuthEvent, session: FakeSession | null) {
      for (const listener of [...listeners]) listener(event, session);
    },
  };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;

/**
 * Lets queued auth events reach the app inside `act`. The service hands each
 * event over on a timer (see `onAuthChange`), and the startup restore waits
 * for the first one, so route tests call this after rendering. Works with
 * the fake timers `renderRouter` turns on, and with real ones.
 */
export async function flushAuthEvents(rounds = 3) {
  const fakeTimers = 'clock' in setTimeout;
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      if (fakeTimers) jest.advanceTimersByTime(1);
      else await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  }
}
