// Supabase's recommended Expo session storage: a `localStorage` backed by
// SQLite (expo-sqlite ships in Expo Go). Importing this file installs it.
import 'expo-sqlite/localStorage/install';

import type { SessionStorage } from './storageFallbacks';

/**
 * Where Supabase Auth keeps the q’d session on iOS (and later Android).
 * Holds only the Supabase session. Music-service credentials go to
 * SecureStore instead (providerCredentials.ts).
 */
export function getSessionStorage(): SessionStorage {
  return globalThis.localStorage;
}
