import * as SecureStore from 'expo-secure-store';

import type { MusicProvider } from '@/domain/music-provider';

import {
  createProviderCredentialStore,
  credentialKey,
  credentialsExpired,
  providerCredentials,
  ProviderCredentialsError,
  type ProviderCredentials,
} from './providerCredentials';
import type { SecureKeyValue } from './secureStore.types';
import { secureKeyValue as webSecureKeyValue } from './secureStore.web';

jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void values.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void values.delete(key)),
  };
});

const SPOTIFY: ProviderCredentials = {
  accessToken: 'access-secret-1',
  refreshToken: 'refresh-secret-1',
  expiresAt: 1_800_000_000_000,
  scope: 'user-modify-playback-state',
};

function fakeStorage(overrides: Partial<SecureKeyValue> = {}) {
  const values = new Map<string, string>();
  const storage: SecureKeyValue = {
    persistent: true,
    getItem: jest.fn(async (key) => values.get(key) ?? null),
    setItem: jest.fn(async (key, value) => void values.set(key, value)),
    deleteItem: jest.fn(async (key) => void values.delete(key)),
    ...overrides,
  };
  return { storage, values };
}

let logged: unknown[][];
beforeEach(() => {
  logged = [];
  for (const level of ['warn', 'error', 'debug', 'info'] as const) {
    jest.spyOn(console, level).mockImplementation((...args) => void logged.push(args));
  }
});
afterEach(() => jest.restoreAllMocks());

/** No credential value may ever reach the console. */
function expectNothingLogged(secrets: string[]) {
  const text = JSON.stringify(logged);
  for (const secret of secrets) expect(text).not.toContain(secret);
}

describe('credentialKey', () => {
  it('uses only characters SecureStore allows', () => {
    for (const provider of ['apple_music', 'spotify'] as const) {
      expect(credentialKey(provider)).toMatch(/^[A-Za-z0-9._-]+$/);
    }
    expect(credentialKey('spotify')).not.toBe(credentialKey('apple_music'));
  });
});

describe('createProviderCredentialStore', () => {
  it('saves and loads credentials per provider', async () => {
    const { storage } = fakeStorage();
    const store = createProviderCredentialStore(storage);
    await store.save('spotify', SPOTIFY);
    await store.save('apple_music', { accessToken: 'apple-user-token' });
    expect(await store.load('spotify')).toEqual(SPOTIFY);
    expect(await store.load('apple_music')).toEqual({ accessToken: 'apple-user-token' });
  });

  it('returns null when nothing is saved', async () => {
    const store = createProviderCredentialStore(fakeStorage().storage);
    expect(await store.load('spotify')).toBeNull();
  });

  it('overwrites on a second save', async () => {
    const store = createProviderCredentialStore(fakeStorage().storage);
    await store.save('spotify', SPOTIFY);
    await store.save('spotify', { accessToken: 'newer' });
    expect(await store.load('spotify')).toEqual({ accessToken: 'newer' });
  });

  it('drops fields that are not part of the schema', async () => {
    const { storage, values } = fakeStorage();
    const store = createProviderCredentialStore(storage);
    await store.save('spotify', { ...SPOTIFY, email: 'a@b.io' } as ProviderCredentials);
    expect(values.get(credentialKey('spotify'))).not.toContain('a@b.io');
  });

  it.each([
    ['an empty access token', { accessToken: '' }],
    ['a missing access token', {}],
    ['an empty refresh token', { accessToken: 'a', refreshToken: '' }],
    ['a negative expiry', { accessToken: 'a', expiresAt: -1 }],
    ['a fractional expiry', { accessToken: 'a', expiresAt: 1.5 }],
  ])('rejects %s', async (_label, credentials) => {
    const { storage } = fakeStorage();
    const store = createProviderCredentialStore(storage);
    await expect(store.save('spotify', credentials as ProviderCredentials)).rejects.toEqual(
      expect.objectContaining({ code: 'invalid_credentials' }),
    );
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('rejects credentials too large for SecureStore', async () => {
    const store = createProviderCredentialStore(fakeStorage().storage);
    await expect(store.save('spotify', { accessToken: 'x'.repeat(9000) })).rejects.toEqual(
      expect.objectContaining({ code: 'too_large' }),
    );
  });

  it('rejects providers other than Apple Music and Spotify', async () => {
    const store = createProviderCredentialStore(fakeStorage().storage);
    const tidal = 'tidal' as MusicProvider;
    await expect(store.save(tidal, SPOTIFY)).rejects.toBeInstanceOf(ProviderCredentialsError);
    await expect(store.load(tidal)).rejects.toEqual(
      expect.objectContaining({ code: 'unknown_provider' }),
    );
    await expect(store.clear(tidal)).rejects.toEqual(
      expect.objectContaining({ code: 'unknown_provider' }),
    );
  });

  it('clears one provider without touching the other', async () => {
    const store = createProviderCredentialStore(fakeStorage().storage);
    await store.save('spotify', SPOTIFY);
    await store.save('apple_music', { accessToken: 'apple' });
    await store.clear('spotify');
    expect(await store.load('spotify')).toBeNull();
    expect(await store.load('apple_music')).toEqual({ accessToken: 'apple' });
    await expect(store.clear('spotify')).resolves.toBeUndefined();
  });

  it('clears every provider', async () => {
    const { storage, values } = fakeStorage();
    const store = createProviderCredentialStore(storage);
    await store.save('spotify', SPOTIFY);
    await store.save('apple_music', { accessToken: 'apple' });
    await store.clearAll();
    expect(values.size).toBe(0);
  });

  it('reports when clearing every provider partly fails, after trying both', async () => {
    const { storage } = fakeStorage({
      deleteItem: jest.fn(async (key: string) => {
        if (key === credentialKey('spotify')) throw new Error('keychain locked');
      }),
    });
    const store = createProviderCredentialStore(storage);
    await expect(store.clearAll()).rejects.toEqual(
      expect.objectContaining({ code: 'storage_failed' }),
    );
    expect(storage.deleteItem).toHaveBeenCalledTimes(2);
  });

  it('discards unreadable values so the person can reconnect', async () => {
    const { storage, values } = fakeStorage();
    const store = createProviderCredentialStore(storage);
    for (const bad of ['not json', '{"accessToken":""}', '[]', 'null', '{"refreshToken":"r"}']) {
      values.set(credentialKey('spotify'), bad);
      expect(await store.load('spotify')).toBeNull();
      expect(values.has(credentialKey('spotify'))).toBe(false);
    }
  });

  it('treats a storage read failure as not connected, without logging values', async () => {
    const { storage } = fakeStorage({
      getItem: jest.fn(async () => {
        throw new Error('User interaction is not allowed (access-secret-1)');
      }),
    });
    const store = createProviderCredentialStore(storage);
    expect(await store.load('spotify')).toBeNull();
    expect(logged.length).toBeGreaterThan(0);
  });

  it('wraps a storage write failure and logs nothing secret', async () => {
    const { storage } = fakeStorage({
      setItem: jest.fn(async () => {
        throw new Error('write failed');
      }),
    });
    const store = createProviderCredentialStore(storage);
    await expect(store.save('spotify', SPOTIFY)).rejects.toEqual(
      expect.objectContaining({ code: 'storage_failed' }),
    );
    expectNothingLogged(['access-secret-1', 'refresh-secret-1']);
  });

  it('wraps a storage delete failure', async () => {
    const { storage } = fakeStorage({
      deleteItem: jest.fn(async () => {
        throw new Error('delete failed');
      }),
    });
    await expect(createProviderCredentialStore(storage).clear('spotify')).rejects.toEqual(
      expect.objectContaining({ code: 'storage_failed' }),
    );
  });

  it('never logs credential values during normal use', async () => {
    const store = createProviderCredentialStore(fakeStorage().storage);
    await store.save('spotify', SPOTIFY);
    await store.load('spotify');
    await store.clearAll();
    expectNothingLogged(['access-secret-1', 'refresh-secret-1']);
  });

  it('reports whether storage persists', () => {
    expect(createProviderCredentialStore(fakeStorage().storage).persistent).toBe(true);
  });
});

describe('credentialsExpired', () => {
  const now = 1_000_000;
  it.each([
    [undefined, false],
    [now + 120_000, false],
    [now + 60_001, false],
    [now + 60_000, true],
    [now + 1, true],
    [now - 1, true],
  ])('expiresAt %s gives %s', (expiresAt, expected) => {
    expect(credentialsExpired({ accessToken: 'a', expiresAt }, now)).toBe(expected);
  });

  it('accepts a custom margin', () => {
    expect(credentialsExpired({ accessToken: 'a', expiresAt: now + 10 }, now, 0)).toBe(false);
  });
});

describe('the app store on iOS', () => {
  it('uses SecureStore, readable after first unlock and never synced to another device', async () => {
    await providerCredentials.save('spotify', SPOTIFY);
    const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'qd.provider.spotify',
      JSON.stringify(SPOTIFY),
      options,
    );
    expect(await providerCredentials.load('spotify')).toEqual(SPOTIFY);
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('qd.provider.spotify', options);
    await providerCredentials.clear('spotify');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('qd.provider.spotify', options);
    expect(providerCredentials.persistent).toBe(true);
  });
});

describe('the web fallback', () => {
  it('keeps credentials in memory only', async () => {
    expect(webSecureKeyValue.persistent).toBe(false);
    const store = createProviderCredentialStore(webSecureKeyValue);
    expect(store.persistent).toBe(false);
    await store.save('apple_music', { accessToken: 'web-token' });
    expect(await store.load('apple_music')).toEqual({ accessToken: 'web-token' });
    await store.clearAll();
    expect(await store.load('apple_music')).toBeNull();
  });

  it('never writes to browser storage', async () => {
    const setItem = jest.fn();
    (globalThis as { localStorage?: unknown }).localStorage = { setItem, getItem: jest.fn() };
    try {
      await createProviderCredentialStore(webSecureKeyValue).save('spotify', SPOTIFY);
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
