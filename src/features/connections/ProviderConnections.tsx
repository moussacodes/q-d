import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { MusicProvider } from '@/domain/music-provider';
import { useMockSession } from '@/features/session/MockSession';
import { createPlayback, type ConnectionState } from '@/providers';

/**
 * Music-service connections, kept apart from q’d sign-in (plan.md §2):
 * signing in never connects a service, and connecting one never signs
 * anyone in. A service is needed only on a phone that's going to play, which
 * in aux mode means the host's.
 *
 * Connections belong to the signed-in account. They start fresh for each
 * account and are gone after signing out. Mock mode only: the real
 * `provider_connections` rows and secure storage replace this state.
 */

type Connections = Partial<Record<MusicProvider, ConnectionState>>;

/**
 * A connect that hasn't finished, or didn't work. A service only counts as
 * connected once its adapter says `connected`; anything else is a failure
 * the card shows, never a silent "Connected".
 */
export type ConnectAttempt = 'connecting' | 'failed';

/** Display order. Only Apple Music and Spotify are supported (plan.md §2). */
export const supportedProviders: readonly MusicProvider[] = ['spotify', 'apple_music'];

type ProviderConnectionsValue = {
  connections: Connections;
  /** Connects in progress or that failed, by service. Cleared once one connects. */
  attempts: Partial<Record<MusicProvider, ConnectAttempt>>;
  /** Connected services, in display order. */
  connected: MusicProvider[];
  /** The service this phone plays rooms through, or null with none connected. */
  playsThrough: MusicProvider | null;
  connect: (provider: MusicProvider) => Promise<void>;
  disconnect: (provider: MusicProvider) => void;
  /** Pick which connected service rooms play through. */
  choose: (provider: MusicProvider) => void;
};

type Store = {
  accountId: number;
  connections: Connections;
  attempts: Partial<Record<MusicProvider, ConnectAttempt>>;
  preferred: MusicProvider | null;
};

/** A returning mock account connected Spotify before; a new one has nothing yet. */
function freshStore(accountId: number, returning: boolean): Store {
  const connections: Connections = returning
    ? { spotify: { status: 'connected', accountLabel: 'Mock account', isMock: true } }
    : {};
  return { accountId, connections, attempts: {}, preferred: null };
}

function withAttempt(store: Store, provider: MusicProvider, attempt: ConnectAttempt | null): Store {
  const attempts = { ...store.attempts };
  if (attempt) attempts[provider] = attempt;
  else delete attempts[provider];
  return { ...store, attempts };
}

const ProviderConnectionsContext = createContext<ProviderConnectionsValue | null>(null);

export function ProviderConnectionsProvider({ children }: { children: ReactNode }) {
  const { accountId, returning } = useMockSession();
  const [saved, setSaved] = useState<Store>(() => freshStore(accountId, returning));
  // A store saved for another account is never shown.
  const store = useMemo(
    () => (saved.accountId === accountId ? saved : freshStore(accountId, returning)),
    [saved, accountId, returning],
  );

  const value = useMemo<ProviderConnectionsValue>(() => {
    // A change made for an account that has since signed out is dropped.
    const update = (change: (current: Store) => Store) =>
      setSaved((current) =>
        change(current.accountId === accountId ? current : freshStore(accountId, returning)),
      );
    const connected = supportedProviders.filter((provider) => store.connections[provider]);
    const playsThrough =
      store.preferred && store.connections[store.preferred]
        ? store.preferred
        : (connected[0] ?? null);
    return {
      connections: store.connections,
      attempts: store.attempts,
      connected,
      playsThrough,
      connect: async (provider) => {
        // A second tap while the first connect runs does nothing.
        if (store.attempts[provider] === 'connecting') return;
        update((current) => withAttempt(current, provider, 'connecting'));
        let connection: ConnectionState | null = null;
        try {
          connection = await createPlayback(provider).connect();
        } catch {
          connection = null;
        }
        const result = connection;
        // Someone else may have signed in meanwhile; their services stay untouched.
        setSaved((current) => {
          if (current.accountId !== accountId) return current;
          if (result?.status !== 'connected') return withAttempt(current, provider, 'failed');
          return withAttempt(
            { ...current, connections: { ...current.connections, [provider]: result } },
            provider,
            null,
          );
        });
      },
      disconnect: (provider) =>
        update((current) => {
          const connections = { ...current.connections };
          delete connections[provider];
          return withAttempt({ ...current, connections }, provider, null);
        }),
      choose: (provider) => update((current) => ({ ...current, preferred: provider })),
    };
  }, [store, accountId, returning]);

  return (
    <ProviderConnectionsContext.Provider value={value}>
      {children}
    </ProviderConnectionsContext.Provider>
  );
}

export function useProviderConnections() {
  const value = useContext(ProviderConnectionsContext);
  if (!value) {
    throw new Error('useProviderConnections must be used inside <ProviderConnectionsProvider>');
  }
  return value;
}
