import type { SecureKeyValue } from './secureStore.types';

/**
 * The web has no secure storage (expo-secure-store doesn't support it), and
 * browser storage is readable by any script on the page. So on the web,
 * provider credentials are kept in memory only and are gone after a reload.
 * The web build is for mock mode and guests, who never need them.
 */
const values = new Map<string, string>();

export const secureKeyValue: SecureKeyValue = {
  persistent: false,
  getItem: async (key) => values.get(key) ?? null,
  setItem: async (key, value) => {
    values.set(key, value);
  },
  deleteItem: async (key) => {
    values.delete(key);
  },
};
