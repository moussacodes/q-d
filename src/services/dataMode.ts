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

const requested = process.env.EXPO_PUBLIC_DATA_MODE;

if (__DEV__ && requested !== undefined && requested !== 'mock') {
  console.warn(
    `EXPO_PUBLIC_DATA_MODE=${requested} isn't available yet. Using mock data; the app labels it as mock.`,
  );
}

export const dataMode: DataMode = 'mock';

export const isMockMode = dataMode === 'mock';
