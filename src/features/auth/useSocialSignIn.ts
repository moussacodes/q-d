import { useState } from 'react';

import type { AuthErrorCode } from '@/domain/auth';
import { useMockSession } from '@/features/session/MockSession';
import { authRedirectUrl, signInWithGoogle } from '@/services/auth';
import { isLiveAuth } from '@/services/dataMode';

import { authErrorMessages, methodUnavailableMessage } from './messages';

export type SocialMethod = 'apple' | 'google';

/**
 * "Continue with Apple" and "Continue with Google". In mock auth mode they
 * start a mock account: a returning one from Sign in, a new one elsewhere.
 * In live auth mode Google signs in through Supabase Auth, and Apple (the
 * Mac card) says it isn't available yet instead of pretending to sign in.
 * Supabase decides whether a Google account is new or returning; AuthSync
 * routes either way once the session exists.
 */
export function useSocialSignIn(
  intent: 'sign-in' | 'create-account',
  options: { live?: boolean } = {},
) {
  const { live = isLiveAuth } = options;
  const { signIn, createAccount } = useMockSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<SocialMethod | null>(null);

  const continueWith = async (method: SocialMethod) => {
    if (pending) return;
    setError(null);
    if (!live) {
      if (intent === 'sign-in') signIn(method);
      else createAccount(method);
      return;
    }
    if (method === 'apple') {
      setError(methodUnavailableMessage('apple'));
      return;
    }
    setPending('google');
    const result = await signInWithGoogle(authRedirectUrl());
    if (result.ok) return; // AuthSync moves on to onboarding or Home.
    setPending(null);
    setError(googleErrorMessage(result.code));
  };

  return { continueWith, pending, error };
}

/** Cancelling is the person's own choice, so it isn't shown as a failure. */
function googleErrorMessage(code: AuthErrorCode): string | null {
  if (code === 'cancelled') return null;
  if (code === 'method_unavailable') return methodUnavailableMessage('google');
  return authErrorMessages[code];
}
