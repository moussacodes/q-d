import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { callbackErrorCode, parseAuthCallbackParams, type AuthErrorCode } from '@/domain/auth';
import { landingFor, useMockSession } from '@/features/session/MockSession';
import { exchangeAuthCode } from '@/services/auth';
import { isLiveAuth } from '@/services/dataMode';
import { log } from '@/services/logger';

import { authErrorMessages } from './messages';

export type AuthCallbackState =
  | { status: 'working' }
  | { status: 'signedIn' }
  | { status: 'failed'; code: AuthErrorCode; message: string };

const callbackLog = log.child('auth.callback');

/** What the callback screen says for each failure. */
function callbackMessage(code: AuthErrorCode): string {
  if (code === 'cancelled') return 'Sign-in was cancelled. You can try again.';
  return authErrorMessages[code];
}

/**
 * The `/auth/callback` route: where Google and email links return (PKCE). It
 * exchanges the one-time `code` for a session, or explains why it can't:
 * an expired link, a link opened on another device, a provider error or a
 * link with nothing in it. Once a session exists, the person moves on to
 * onboarding or Home, so a link opened twice still ends up in the right place.
 */
export function useAuthCallback(
  params: Record<string, string | string[] | undefined>,
  options: { live?: boolean } = {},
): AuthCallbackState {
  const { live = isLiveAuth } = options;
  const { auth } = useMockSession();
  const [state, setState] = useState<AuthCallbackState>({ status: 'working' });
  // params is a new object on every render; its contents decide the outcome.
  const serialized = JSON.stringify(params);

  useEffect(() => {
    let active = true;
    const callback = parseAuthCallbackParams(JSON.parse(serialized));
    const failWith = (code: AuthErrorCode, reason: string | null) => {
      callbackLog.warn('Sign-in link failed', { errorCode: code, reason });
      setState({ status: 'failed', code, message: callbackMessage(code) });
    };

    if (!live) {
      failWith('not_configured', null);
      return;
    }
    if (callback.kind === 'missing') {
      failWith('link_invalid', 'missing');
      return;
    }
    if (callback.kind === 'error') {
      failWith(
        callbackErrorCode(callback.error, callback.errorCode),
        callback.errorCode ?? callback.error,
      );
      return;
    }
    void exchangeAuthCode(callback.code).then((result) => {
      if (!active) return;
      if (result.ok) setState({ status: 'signedIn' });
      else setState({ status: 'failed', code: result.code, message: callbackMessage(result.code) });
    });
    return () => {
      active = false;
    };
  }, [serialized, live]);

  // AuthSync sets the state from the new session; then leave this screen.
  useEffect(() => {
    if (state.status === 'signedIn' && auth !== 'signedOut') router.replace(landingFor[auth]);
  }, [state.status, auth]);

  return state;
}
