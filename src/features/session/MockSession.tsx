import { router, type Href } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

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

type MockSessionValue = {
  auth: AuthStatus;
  user: typeof mockUser;
  activeRoom: MockRoom | null;
  /** Returning user: straight to Home. */
  signIn: () => void;
  /** New account (email sign-up, or Apple/Google for the first time): onboarding. */
  createAccount: () => void;
  /** Ends onboarding on Home, or on `next` with Home underneath it. */
  finishOnboarding: (next?: Href) => void;
  signOut: () => void;
  /** Development screen index: open a screen in the state it needs. */
  previewAs: (auth: AuthStatus, href: Href) => void;
  enterRoom: (code: string) => void;
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
    return {
      auth,
      user: mockUser,
      activeRoom: activeCode ? findRoom(activeCode) : null,
      signIn: () => go('ready'),
      createAccount: () => go('onboarding'),
      finishOnboarding: (next) => go('ready', next ? [landingFor.ready, next] : undefined),
      signOut: () => {
        setActiveCode(null);
        go('signedOut');
      },
      previewAs: (next, href) => {
        setAuth(next);
        setTrip({ mode: 'push', hrefs: [href] });
      },
      enterRoom: setActiveCode,
      leaveRoom: () => setActiveCode(null),
    };
  }, [auth, activeCode]);

  return <MockSessionContext.Provider value={value}>{children}</MockSessionContext.Provider>;
}

export function useMockSession() {
  const value = useContext(MockSessionContext);
  if (!value) {
    throw new Error('useMockSession must be used inside <MockSessionProvider>');
  }
  return value;
}
