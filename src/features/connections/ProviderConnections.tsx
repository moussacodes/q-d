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

/** Only connected services are kept. */
type Connected = Extract<ConnectionState, { status: 'connected' }>;
type Connections = Partial<Record<MusicProvider, Connected>>;

/** Display order. Only Apple Music and Spotify are supported (plan.md §2). */
export const supportedProviders: readonly MusicProvider[] = ['spotify', 'apple_music'];

type ProviderConnectionsValue = {
  connections: Connections;
  /** Connected services, in display order. */
  connected: MusicProvider[];
  /** The service this phone plays rooms through, or null with none connected. */
  playsThrough: MusicProvider | null;
  connect: (provider: MusicProvider) => Promise<void>;
  disconnect: (provider: MusicProvider) => void;
  /** Pick which connected service rooms play through. */
  choose: (provider: MusicProvider) => void;
};

type Store = { accountId: number; connections: Connections; preferred: MusicProvider | null };

/** A returning mock account connected Spotify before; a new one has nothing yet. */
function freshStore(accountId: number, returning: boolean): Store {
  const connections: Connections = returning
    ? { spotify: { status: 'connected', accountLabel: 'Mock account', isMock: true } }
    : {};
  return { accountId, connections, preferred: null };
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
      connected,
      playsThrough,
      connect: async (provider) => {
        const connection = await createPlayback(provider).connect();
        if (connection.status !== 'connected') return;
        update((current) => ({
          ...current,
          connections: { ...current.connections, [provider]: connection },
        }));
      },
      disconnect: (provider) =>
        update((current) => {
          const connections = { ...current.connections };
          delete connections[provider];
          return { ...current, connections };
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
