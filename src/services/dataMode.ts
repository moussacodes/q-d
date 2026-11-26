import { env, envNames, envResult, type AppEnv } from './env';
import { log } from './logger';

/**
 * Where the app's data comes from.
 *
 * - `mock`: deterministic sample data and mock music providers. Runs on web,
 *   Windows and Expo Go with no Mac, backend or provider accounts.
 * - `live`: rooms, members and the queue from Supabase (RPCs, RLS reads and
 *   Realtime). Music services are still whatever each connection says it is
 *   (the real Spotify remote behind its flag, otherwise the labeled mock).
 *
 * Choose with `EXPO_PUBLIC_DATA_MODE` (see README → Running locally).
 */
export type DataMode = 'mock' | 'live';

/**
 * Whether this build has a live data layer to switch to. True since the live
 * room card: rooms, members and the queue are read from Supabase and changed
 * through the RPCs (features/room/liveRoom.ts). Music services stay labeled
 * per connection, so a mock connection still says it's the mock.
 */
export const LIVE_DATA_AVAILABLE = true;

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

/**
 * Where sign-in happens, decided separately from room data.
 *
 * - `mock`: the mock session. Any valid-looking email signs in, and nothing
 *   leaves the device. The default, and the only mode without Supabase.
 * - `live`: Supabase Auth. Used when `EXPO_PUBLIC_DATA_MODE=live` and both
 *   Supabase variables validate, even while rooms still fall back to mock
 *   data (the strip then says sign-in is live and the rest is mock).
 */
export type AuthMode = 'mock' | 'live';

/** Decides the auth mode. Pure, so every path is testable. */
export function resolveAuthMode(appEnv: Pick<AppEnv, 'requestedDataMode' | 'supabase'>): AuthMode {
  return appEnv.requestedDataMode === 'live' && appEnv.supabase !== null ? 'live' : 'mock';
}

export const authMode: AuthMode = resolveAuthMode(env);

export const isLiveAuth = authMode === 'live';
