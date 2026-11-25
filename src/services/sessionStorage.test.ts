import { browserStorageOrMemory, createMemoryStorage } from './storageFallbacks';

const mockInstalled = {
  getItem: jest.fn(() => null),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};

// The real module installs a SQLite-backed localStorage through a native
// module. Tests stand in for it.
jest.mock('expo-sqlite/localStorage/install', () => {
  (globalThis as { localStorage?: unknown }).localStorage = mockInstalled;
});

describe('getSessionStorage on iOS', () => {
  afterAll(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('returns the SQLite-backed localStorage that expo-sqlite installs', () => {
    jest.isolateModules(() => {
      const { getSessionStorage } =
        jest.requireActual<typeof import('./sessionStorage.native')>('./sessionStorage.native');
      expect(getSessionStorage()).toBe(mockInstalled);
    });
  });
});

describe('createMemoryStorage', () => {
  it('stores, reads and removes values', () => {
    const storage = createMemoryStorage();
    expect(storage.getItem('k')).toBeNull();
    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');
    storage.setItem('k', 'w');
    expect(storage.getItem('k')).toBe('w');
    storage.removeItem('k');
    expect(storage.getItem('k')).toBeNull();
    expect(() => storage.removeItem('missing')).not.toThrow();
  });

  it('keeps separate stores apart', () => {
    const a = createMemoryStorage();
    const b = createMemoryStorage();
    a.setItem('k', 'v');
    expect(b.getItem('k')).toBeNull();
  });
});

describe('browserStorageOrMemory (web)', () => {
  it('uses working browser storage and leaves no probe behind', () => {
    const store = new Map<string, string>();
    const local = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    expect(browserStorageOrMemory(local)).toBe(local);
    expect(store.size).toBe(0);
  });

  it('falls back to memory when there is no localStorage (static rendering)', () => {
    const storage = browserStorageOrMemory(undefined);
    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');
  });

  it('falls back to memory when storage throws (private mode, blocked site data)', () => {
    const blocked = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    const storage = browserStorageOrMemory(blocked);
    expect(storage).not.toBe(blocked);
    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');
  });

  it('the web entry point uses it', () => {
    const { getSessionStorage } =
      jest.requireActual<typeof import('./sessionStorage')>('./sessionStorage.ts');
    const storage = getSessionStorage();
    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');
  });
});
