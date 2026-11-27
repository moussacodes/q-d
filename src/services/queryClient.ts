import { focusManager, MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { log } from './logger';

/**
 * Server state (docs/ARCHITECTURE.md §4.12). TanStack Query caches everything
 * that comes from Supabase: rooms, members, the queue, search results.
 * Realtime events invalidate those queries, and Postgres stays the source of
 * truth. Small, short-lived UI state stays out of it.
 */

/** Errors that retrying can't fix, e.g. the RPC error codes in API_CONTRACTS.md. */
function isPermanent(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const { status, code, hint } = error as { status?: unknown; code?: unknown; hint?: unknown };
  // A q’d RPC error as supabase-js reports it, unmapped: SQLSTATE `P0001`,
  // our code as the message and the hint `qd` (the RPC foundation migration).
  if (hint === 'qd') return true;
  if (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  ) {
    return true;
  }
  // RPC errors are snake_case words (`not_allowed`, `room_full`); network
  // and Postgres errors aren't.
  return typeof code === 'string' && /^[a-z]+(_[a-z]+)+$/.test(code);
}

export const MAX_QUERY_RETRIES = 2;

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_QUERY_RETRIES && !isPermanent(error);
}

const queryLog = log.child('query');

export function createQueryClient(): QueryClient {
  return new QueryClient({
    // Query keys can hold room codes, so they're never logged.
    queryCache: new QueryCache({
      onError: (error, query) => queryLog.warn('Query failed', { error, scope: query.meta?.scope }),
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) =>
        queryLog.warn('Mutation failed', { error, scope: mutation.meta?.scope }),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
      },
      mutations: {
        // RPCs carry an idempotency key, but whether to retry is each
        // mutation's call: it has to reuse the same key.
        retry: false,
      },
    },
  });
}

interface AppStateLike {
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
}

/**
 * Tells TanStack Query when the app comes to the foreground, so stale
 * queries refetch then (the web uses window focus already). Returns a
 * function that stops listening.
 */
export function connectQueryFocus(
  appState: AppStateLike = AppState,
  platform: string = Platform.OS,
): () => void {
  if (platform === 'web') return () => {};
  const subscription = appState.addEventListener('change', (state) => {
    focusManager.setFocused(state === 'active');
  });
  return () => subscription.remove();
}

declare module '@tanstack/react-query' {
  interface Register {
    /** `scope` names the feature for logs, e.g. `room.queue`. Never put data in it. */
    queryMeta: { scope?: string };
    mutationMeta: { scope?: string };
  }
}

/** The app's query client. */
export const queryClient = createQueryClient();
