import { browserStorageOrMemory, type SessionStorage } from './storageFallbacks';

/**
 * Web version (iOS uses sessionStorage.native.ts). The browser's own
 * `localStorage` holds the Supabase session, as supabase-js does by default.
 * Where there's none, the session lives in memory and ends with the page.
 */
export function getSessionStorage(): SessionStorage {
  return browserStorageOrMemory();
}
