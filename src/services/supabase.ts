import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { env, type SupabaseEnv } from './env';
import { log } from './logger';
import { getSessionStorage } from './sessionStorage';
import type { SessionStorage } from './storageFallbacks';

/**
 * The Supabase client (docs/ARCHITECTURE.md §4.7 and §4.10).
 *
 * It exists only when `EXPO_PUBLIC_SUPABASE_URL` and
 * `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are both set and valid. With no
 * environment, `getSupabase()` returns null and nothing touches the network
 * or device storage, so mock mode works on any machine.
 *
 * Feature code reads and changes room state through RPCs on this client
 * (`supabase.rpc(...)`) inside TanStack Query hooks. It never writes room
 * tables directly.
 */

export function createSupabaseClient(config: SupabaseEnv, storage: SessionStorage): SupabaseClient {
  return createClient(config.url, config.publishableKey, {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: true,
      // Native apps receive OAuth results through deep links, not the URL bar.
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
}

/** Whether this build has Supabase settings. */
export const isSupabaseConfigured = env.supabase !== null;

let client: SupabaseClient | null | undefined;

/**
 * The app's Supabase client, created on first use. Null when Supabase isn't
 * configured, so callers fall back to mock data.
 */
export function getSupabase(): SupabaseClient | null {
  if (client === undefined) {
    client = env.supabase ? createSupabaseClient(env.supabase, getSessionStorage()) : null;
    if (!client) log.child('supabase').debug('Supabase is not configured; using mock data');
  }
  return client;
}

interface AppStateLike {
  currentState?: string | null;
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
}

/**
 * Refreshes the session only while the app is in the foreground, as Supabase
 * recommends for React Native (timers don't run reliably in the background).
 * The web handles this itself. Returns a function that stops listening.
 */
export function startSessionAutoRefresh(
  supabase: SupabaseClient | null = getSupabase(),
  appState: AppStateLike = AppState,
  platform: string = Platform.OS,
): () => void {
  if (!supabase || platform === 'web') return () => {};
  const apply = (state: string | null | undefined) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  };
  apply(appState.currentState);
  const subscription = appState.addEventListener('change', apply);
  return () => {
    subscription.remove();
    void supabase.auth.stopAutoRefresh();
  };
}
