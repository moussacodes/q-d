import { router, type Href } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { AuthStatus, SignInMethod } from '@/domain/auth';
import { MAX_DISPLAY_NAME_LENGTH } from '@/domain/profile';
import type { MusicProvider } from '@/domain/music-provider';
import { findRoom, mockUser, type MockRoom } from '@/providers/mock/data';
import { clearProviderCredentials, signOut as signOutOfSupabase } from '@/services/auth';
import { isLiveAuth } from '@/services/dataMode';
import { log } from '@/services/logger';

/**
 * Where someone is in the sign-in flow (see `AuthStatus` in domain/auth.ts).
 * In mock auth mode the mock buttons decide it. In live auth mode Supabase
 * Auth and the profile row decide it, through `applyAuth`
 * (features/auth/AuthSync.tsx).
 */
export type { AuthStatus, SignInMethod };

/** The screen each state starts on. Guarded routes redirect here. */
export const landingFor: Record<AuthStatus, Href> = {
  signedOut: '/',
  onboarding: '/onboarding/name',
  ready: '/home',
};

export const signInMethodNames: Record<SignInMethod, string> = {
  apple: 'Apple',
  google: 'Google',
  email: 'Email',
};

/**
 * What onboarding step 1 collects (plan.md §2). In live auth mode it's saved
 * to the person's `profiles` row first (useProfileSave.ts).
 */
export type Profile = { name: string; color: string };

/** The longest display name onboarding and Settings accept. */
export const MAX_NAME_LENGTH = MAX_DISPLAY_NAME_LENGTH;

export type User = Profile & { email: string; signedInWith: SignInMethod };

type Account = {
  id: number;
  returning: boolean;
  method: SignInMethod;
  /** Null until onboarding step 1 is done. */
  profile: Profile | null;
  /** Live auth only: the Supabase user's id, email and provider name. */
  userId?: string;
  email?: string | null;
  suggestedName?: string;
};

/** A signed-in Supabase user, as live auth reports it to the session. */
export type LiveAccount = {
  status: Exclude<AuthStatus, 'signedOut'>;
  userId: string;
  email: string | null;
  method: SignInMethod;
  /** The saved profile, when onboarding is done. */
  profile: Profile | null;
  /** A name from the sign-in provider, offered on onboarding step 1. */
  suggestedName?: string;
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
  /** Ends onboarding on Home, or on `next` with Home underneath it. */
  finishOnboarding: (next?: Href) => void;
  signOut: () => void;
  /**
   * Live auth: moves the session to what Supabase reports. Null means signed
   * out. Does nothing when the state and user haven't changed.
   */
  applyAuth: (next: LiveAccount | null) => void;
  /** Live auth: the signed-in Supabase user's id, or null. */
  liveUserId: string | null;
  /**
   * Live auth: true until the stored session has been read at startup, so
   * the app doesn't flash Welcome before restoring a signed-in person.
   */
  restoring: boolean;
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

/**
 * The longest the splash waits for the stored session at startup. A slow or
 * hanging network (a token refresh, the profile read) mustn't keep the app
 * on its splash forever.
 */
export const RESTORE_TIMEOUT_MS = 10_000;

const sessionLog = log.child('session');

export function MockSessionProvider({
  children,
  liveAuth = isLiveAuth,
  restoreTimeoutMs = RESTORE_TIMEOUT_MS,
}: {
  children: ReactNode;
  liveAuth?: boolean;
  /** Tests shorten it. */
  restoreTimeoutMs?: number;
}) {
  const [auth, setAuth] = useState<AuthStatus>('signedOut');
  const [restoring, setRestoring] = useState(liveAuth);

  // Past the limit, show Welcome. If the session turns up later, applyAuth
  // still moves the person on to onboarding or Home.
  useEffect(() => {
    if (!restoring) return;
    const timer = setTimeout(() => {
      sessionLog.warn('Session restore timed out', { afterMs: restoreTimeoutMs });
      setRestoring(false);
    }, restoreTimeoutMs);
    return () => clearTimeout(timer);
  }, [restoring, restoreTimeoutMs]);
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
    const resetToSignedOut = () => {
      setActiveCode(null);
      setHosted(null);
      switchAccount({ returning: false, method: 'email', profile: null });
      go('signedOut');
      // Music-service tokens belong to the account that saved them.
      void clearProviderCredentials();
    };
    // Dev previews can open Home without onboarding; they show the sample profile.
    const profile = account.profile ?? { name: mockUser.name, color: mockUser.color };
    const room = activeCode ? findRoom(activeCode) : null;
    return {
      auth,
      accountId: account.id,
      returning: account.returning,
      user: {
        ...profile,
        email: account.userId ? (account.email ?? '') : mockUser.email,
        signedInWith: account.method,
      },
      suggestedName: account.userId
        ? (account.suggestedName ?? '')
        : account.method === 'email'
          ? ''
          : mockUser.name,
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
      finishOnboarding: (next) => go('ready', next ? [landingFor.ready, next] : undefined),
      signOut: () => {
        resetToSignedOut();
        // The local session is removed before the network call, so this
        // can't leave the device signed in (services/auth.ts).
        if (liveAuth) void signOutOfSupabase();
      },
      applyAuth: (next) => {
        if (restoring) {
          // Startup: nothing is on screen yet, so set the state and let the
          // route guards send the first screen to the right place.
          setRestoring(false);
          setAuth(next?.status ?? 'signedOut');
          if (next) {
            switchAccount({
              returning: next.status === 'ready',
              method: next.method,
              profile: next.profile,
              userId: next.userId,
              email: next.email,
              suggestedName: next.suggestedName,
            });
          }
          return;
        }
        if (!next) {
          if (auth !== 'signedOut' || account.userId) resetToSignedOut();
          return;
        }
        if (next.userId === account.userId && next.status === auth) return;
        if (next.userId !== account.userId) {
          switchAccount({
            returning: next.status === 'ready',
            method: next.method,
            profile: next.profile,
            userId: next.userId,
            email: next.email,
            suggestedName: next.suggestedName,
          });
        }
        go(next.status);
      },
      liveUserId: account.userId ?? null,
      restoring,
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
  }, [auth, account, activeCode, hosted, restoring, liveAuth]);

  return <MockSessionContext.Provider value={value}>{children}</MockSessionContext.Provider>;
}

export function useMockSession() {
  const value = useContext(MockSessionContext);
  if (!value) {
    throw new Error('useMockSession must be used inside <MockSessionProvider>');
  }
  return value;
}
