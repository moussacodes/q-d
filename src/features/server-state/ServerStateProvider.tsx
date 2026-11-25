import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';

import { connectQueryFocus, queryClient } from '@/services/queryClient';
import { startSessionAutoRefresh } from '@/services/supabase';

/**
 * Gives every screen the app's TanStack Query client and keeps server state
 * fresh: queries refetch when the app returns to the foreground, and the
 * Supabase session refreshes only while the app is in the foreground. In
 * mock mode (no Supabase settings) there's no session to refresh, and the
 * mock screens don't use queries yet, so this changes nothing on screen.
 */
export function ServerStateProvider({
  children,
  client = queryClient,
}: {
  children: ReactNode;
  client?: QueryClient;
}) {
  useEffect(() => connectQueryFocus(), []);
  useEffect(() => startSessionAutoRefresh(), []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
