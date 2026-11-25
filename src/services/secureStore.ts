import * as SecureStore from 'expo-secure-store';

import type { SecureKeyValue } from './secureStore.types';

/**
 * iOS Keychain (and Android Keystore) through expo-secure-store, which ships
 * in Expo Go. Entries are readable after the first unlock, so the host's
 * phone can refresh a provider token while it plays with the screen locked,
 * and they never move to another device through a backup.
 */
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const secureKeyValue: SecureKeyValue = {
  persistent: true,
  getItem: (key) => SecureStore.getItemAsync(key, options),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, options),
};
