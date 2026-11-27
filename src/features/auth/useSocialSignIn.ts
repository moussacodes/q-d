import { useEffect, useState } from 'react';

import type { AuthErrorCode } from '@/domain/auth';
import { useMockSession } from '@/features/session/MockSession';
import {
  authRedirectUrl,
  isAppleSignInAvailable,
  signInWithApple,
  signInWithGoogle,
} from '@/services/auth';
import { isLiveAuth } from '@/services/dataMode';

import { authErrorMessages, methodUnavailableMessage } from './messages';

export type SocialMethod = 'apple' | 'google';

/**
 * Which Apple button the screen shows.
 * - `mock`: mock auth mode's button, which starts a mock account.
 * - `apple`: Apple's own Sign in with Apple button (live mode, iOS with the
 *   module: Expo Go or a q’d build).
 * - `hidden`: live mode where Sign in with Apple can't run (web, Android),
 *   and while that's still being checked.
 */
export type AppleButtonKind = 'mock' | 'apple' | 'hidden';

/**
 * "Continue with Apple" and "Continue with Google". In mock auth mode they
 * start a mock account: a returning one from Sign in, a new one elsewhere.
 * In live auth mode Google signs in through Supabase Auth, and Apple through
 * Sign in with Apple and Supabase Auth, on iOS only. Supabase decides
 * whether an account is new or returning; AuthSync routes either way once
 * the session exists.
 */
export function useSocialSignIn(
  intent: 'sign-in' | 'create-account',
  options: { live?: boolean } = {},
) {
  const { live = isLiveAuth } = options;
  const { signIn, createAccount } = useMockSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<SocialMethod | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (!live) return;
    let current = true;
    void isAppleSignInAvailable().then((available) => {
      if (current) setAppleAvailable(available);
    });
    return () => {
      current = false;
    };
  }, [live]);

  const continueWith = async (method: SocialMethod) => {
    if (pending) return;
    setError(null);
    if (!live) {
      if (intent === 'sign-in') signIn(method);
      else createAccount(method);
      return;
    }
    setPending(method);
    const result =
      method === 'apple' ? await signInWithApple() : await signInWithGoogle(authRedirectUrl());
    if (result.ok) return; // AuthSync moves on to onboarding or Home.
    setPending(null);
    setError(socialErrorMessage(method, result.code));
  };

  const appleButton: AppleButtonKind = !live ? 'mock' : appleAvailable ? 'apple' : 'hidden';

  return { continueWith, pending, error, appleButton };
}

/** Cancelling is the person's own choice, so it isn't shown as a failure. */
function socialErrorMessage(method: SocialMethod, code: AuthErrorCode): string | null {
  if (code === 'cancelled') return null;
  if (code === 'method_unavailable') return methodUnavailableMessage(method);
  return authErrorMessages[code];
}
