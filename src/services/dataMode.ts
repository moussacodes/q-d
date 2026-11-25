import { env, envNames, envResult, type AppEnv } from './env';
import { log } from './logger';

/**
 * Where the app's data comes from.
 *
 * - `mock`: deterministic sample data and mock music providers. Runs on web,
 *   Windows and Expo Go with no Mac, backend or provider accounts.
 * - `live`: Supabase plus the real Apple Music and Spotify adapters. Reserved
 *   until those cards land, so asking for it falls back to `mock`.
 *
 * Choose with `EXPO_PUBLIC_DATA_MODE` (see README → Running locally).
 */
export type DataMode = 'mock' | 'live';

/**
 * Whether this build has a live data layer to switch to. It stays false until
 * the screens read rooms and queues from Supabase instead of the mock store.
 * Until then, `live` would show mock data without the mock label, which the
 * product rules forbid.
 */
export const LIVE_DATA_AVAILABLE = false;

export interface DataModeDecision {
  mode: DataMode;
  /** Why `live` was refused, when it was asked for. Names variables, never values. */
  fallbackReason: string | null;
}

/** Decides the data mode. Pure, so every path is testable. */
export function resolveDataMode(
  appEnv: Pick<AppEnv, 'requestedDataMode' | 'supabase'>,
  liveAvailable: boolean = LIVE_DATA_AVAILABLE,
): DataModeDecision {
  if (appEnv.requestedDataMode === 'mock') {
    return { mode: 'mock', fallbackReason: null };
  }
  if (appEnv.supabase === null) {
    return {
      mode: 'mock',
      fallbackReason: `${envNames.dataMode}=live needs ${envNames.supabaseUrl} and ${envNames.supabaseKey}. Using mock data; the app labels it as mock.`,
    };
  }
  if (!liveAvailable) {
    return {
      mode: 'mock',
      fallbackReason: `${envNames.dataMode}=live isn't available yet. Using mock data; the app labels it as mock.`,
    };
  }
  return { mode: 'live', fallbackReason: null };
}

const decision = resolveDataMode(env);

const envLog = log.child('env');
for (const message of [...envResult.problems, decision.fallbackReason]) {
  if (message) envLog.warn(message);
}

export const dataMode: DataMode = decision.mode;

export const isMockMode = dataMode === 'mock';
