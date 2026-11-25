import { useEffect, useRef } from 'react';

import { useMockSession } from '@/features/session/MockSession';
import { fetchSavedProfile, onAuthChange, type AuthChange } from '@/services/auth';
import { isLiveAuth } from '@/services/dataMode';

/**
 * Live auth only: keeps the session in step with Supabase Auth. Every sign-in
 * and sign-out, from any screen or a token that stops refreshing, arrives
 * here as an auth event, and the session's state decides the route group
 * (app/_layout.tsx). In mock auth mode it does nothing.
 */
export function AuthSync({ live = isLiveAuth }: { live?: boolean }) {
  const { applyAuth } = useMockSession();
  // The session object changes on every state change; the subscription
  // must not, so it reads the latest `applyAuth` through a ref.
  const apply = useRef(applyAuth);
  useEffect(() => {
    apply.current = applyAuth;
  });

  useEffect(() => {
    if (!live) return;
    let currentUserId: string | null = null;
    // Each sign-in looks up a profile; only the newest lookup may apply.
    let generation = 0;

    const handle = async ({ user }: AuthChange) => {
      if (!user) {
        generation += 1;
        currentUserId = null;
        apply.current(null);
        return;
      }
      // Token refreshes, user updates and repeated SIGNED_IN for the same
      // person change nothing the routes care about, and mustn't undo
      // onboarding progress made since the profile was read.
      if (user.id === currentUserId) return;
      currentUserId = user.id;
      const mine = ++generation;
      const profile = await fetchSavedProfile(user.id);
      if (mine !== generation) return;
      apply.current({
        status: profile ? 'ready' : 'onboarding',
        userId: user.id,
        email: user.email,
        method: user.method,
        profile,
      });
    };

    return onAuthChange((change) => void handle(change));
  }, [live]);

  return null;
}
