import { useState } from 'react';

import { useMockSession } from '@/features/session/MockSession';
import { isLiveAuth } from '@/services/dataMode';

import { methodUnavailableMessage } from './messages';

export type SocialMethod = 'apple' | 'google';

/**
 * "Continue with Apple" and "Continue with Google". In mock auth mode they
 * start a mock account: a returning one from Sign in, a new one elsewhere.
 * In live auth mode a method that isn't built yet says so instead of
 * pretending to sign in.
 */
export function useSocialSignIn(
  intent: 'sign-in' | 'create-account',
  options: { live?: boolean } = {},
) {
  const { live = isLiveAuth } = options;
  const { signIn, createAccount } = useMockSession();
  const [error, setError] = useState<string | null>(null);

  const continueWith = (method: SocialMethod) => {
    setError(null);
    if (!live) {
      if (intent === 'sign-in') signIn(method);
      else createAccount(method);
      return;
    }
    setError(methodUnavailableMessage(method));
  };

  return { continueWith, pending: null as SocialMethod | null, error };
}
