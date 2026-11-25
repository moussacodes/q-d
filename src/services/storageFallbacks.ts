/** The storage Supabase Auth needs for its session (a subset of Web Storage). */
export interface SessionStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/** Keeps values in memory only. Used where no persistent storage exists. */
export function createMemoryStorage(): SessionStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

/**
 * The browser's `localStorage` if it works, otherwise memory. Static
 * rendering has none, and Safari's private mode or blocked site data throw
 * on first use.
 */
export function browserStorageOrMemory(
  candidate: SessionStorage | undefined = globalThis.localStorage,
): SessionStorage {
  try {
    if (candidate) {
      const probe = '__qd_storage_probe__';
      void candidate.setItem(probe, '1');
      void candidate.removeItem(probe);
      return candidate;
    }
  } catch {
    // Fall through to memory.
  }
  return createMemoryStorage();
}
