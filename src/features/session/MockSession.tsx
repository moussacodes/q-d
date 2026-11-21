import { router, type Href } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { MusicProvider } from '@/domain/music-provider';
import { findRoom, mockUser, type MockRoom } from '@/providers/mock/data';

/**
 * Where someone is in the sign-in flow. Mock only; Supabase Auth and the
 * profile row decide this once the auth cards land.
 * - `signedOut`: Welcome, Sign in, Create account.
 * - `onboarding`: signed in, but name, color and 18+ aren't done yet.
 * - `ready`: everything else.
 */
export type AuthStatus = 'signedOut' | 'onboarding' | 'ready';

/** The screen each state starts on. Guarded routes redirect here. */
export const landingFor: Record<AuthStatus, Href> = {
  signedOut: '/',
  onboarding: '/onboarding/name',
  ready: '/home',
};

export type SignInMethod = 'apple' | 'google' | 'email';

export const signInMethodNames: Record<SignInMethod, string> = {
  apple: 'Apple',
  google: 'Google',
  email: 'Email',
};

/** What onboarding step 1 collects (plan.md §2). Stored in `profiles` later. */
export type Profile = { name: string; color: string };

/** The longest display name onboarding and Settings accept. */
export const MAX_NAME_LENGTH = 30;

export type User = Profile & { email: string; signedInWith: SignInMethod };

type Account = {
  id: number;
  returning: boolean;
  method: SignInMethod;
  /** Null until onboarding step 1 is done. */
  profile: Profile | null;
};

type MockSessionValue = {
  auth: AuthStatus;
  /**
   * Changes whenever a different account signs in or out, so per-account
   * state (like music-service connections) starts fresh.
   */
  accountId: number;
  /** A returning account has signed in before; a new one was just created. */
  returning: boolean;
  user: User;
  /** Apple and Google share a name; email sign-ups start blank. */
  suggestedName: string;
  saveProfile: (profile: Profile) => void;
  activeRoom: MockRoom | null;
  /** Returning user: straight to Home. */
  signIn: (method: SignInMethod) => void;
  /** New account (email sign-up, or Apple/Google for the first time): onboarding. */
  createAccount: (method: SignInMethod) => void;
  /** Ends onboarding on Home. */
  finishOnboarding: () => void;
  signOut: () => void;
  /** Development screen index: open a screen in the state it needs. */
  previewAs: (auth: AuthStatus, href: Href) => void;
  enterRoom: (code: string) => void;
  /** Start hosting: the room plays through `playsThrough` on this phone. */
  startRoom: (code: string, room: { name: string; playsThrough: MusicProvider }) => void;
  leaveRoom: () => void;
};

/**
 * Screens to open once a new auth state has rendered. `replace` swaps the
 * current screen for the first one; `push` opens all of them on top.
 */
type Trip = { mode: 'replace' | 'push'; hrefs: Href[] };

const MockSessionContext = createContext<MockSessionValue | null>(null);

export function MockSessionProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthStatus>('signedOut');
  const [account, setAccount] = useState<Account>({
    id: 0,
    returning: false,
    method: 'email',
    profile: null,
  });
  const [hosted, setHosted] = useState<Pick<MockRoom, 'code' | 'name' | 'playsThrough'> | null>(
    null,
  );
  const [trip, setTrip] = useState<Trip | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);

  // Navigating in an effect means the route guards already reflect the new
  // state, so the destination isn't redirected away.
  useEffect(() => {
    if (!trip) return;
    const [first, ...rest] = trip.hrefs;
    if (trip.mode === 'replace') {
      router.replace(first);
    } else {
      router.push(first);
    }
    // Each further screen waits a tick, after the previous navigation settles.
    const timers = rest.map((href, index) => setTimeout(() => router.push(href), index + 1));
    return () => timers.forEach(clearTimeout);
  }, [trip]);

  const value = useMemo<MockSessionValue>(() => {
    const go = (next: AuthStatus, hrefs: Href[] = [landingFor[next]]) => {
      setAuth(next);
      setTrip({ mode: 'replace', hrefs });
    };
    const switchAccount = (next: Omit<Account, 'id'>) =>
      setAccount((current) => ({ id: current.id + 1, ...next }));
    // Dev previews can open Home without onboarding; they show the sample profile.
    const profile = account.profile ?? { name: mockUser.name, color: mockUser.color };
    const room = activeCode ? findRoom(activeCode) : null;
    return {
      auth,
      accountId: account.id,
      returning: account.returning,
      user: { ...profile, email: mockUser.email, signedInWith: account.method },
      suggestedName: account.method === 'email' ? '' : mockUser.name,
      saveProfile: (next) => setAccount((current) => ({ ...current, profile: next })),
      activeRoom: room && hosted?.code === room.code ? { ...room, ...hosted } : room,
      signIn: (method) => {
        switchAccount({
          returning: true,
          method,
          profile: { name: mockUser.name, color: mockUser.color },
        });
        go('ready');
      },
      createAccount: (method) => {
        switchAccount({ returning: false, method, profile: null });
        go('onboarding');
      },
      finishOnboarding: () => go('ready'),
      signOut: () => {
        setActiveCode(null);
        setHosted(null);
        switchAccount({ returning: false, method: 'email', profile: null });
        go('signedOut');
      },
      previewAs: (next, href) => {
        setAuth(next);
        setTrip({ mode: 'push', hrefs: [href] });
      },
      enterRoom: setActiveCode,
      startRoom: (code, room) => {
        setHosted({ code, ...room });
        setActiveCode(code);
      },
      leaveRoom: () => setActiveCode(null),
    };
  }, [auth, account, activeCode, hosted]);

  return <MockSessionContext.Provider value={value}>{children}</MockSessionContext.Provider>;
}

export function useMockSession() {
  const value = useContext(MockSessionContext);
  if (!value) {
    throw new Error('useMockSession must be used inside <MockSessionProvider>');
  }
  return value;
}
