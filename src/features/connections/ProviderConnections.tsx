import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import type { MusicProvider } from '@/domain/music-provider';
import { useMockSession } from '@/features/session/MockSession';
import { connectProvider, disconnectProvider, type ConnectionState } from '@/providers';
import { log } from '@/services/logger';

/**
 * Music-service connections, kept apart from q’d sign-in (plan.md §2):
 * signing in never connects a service, and connecting one never signs
 * anyone in. A service is needed only on a phone that's going to play, which
 * in aux mode means the host's.
 *
 * Connections belong to the signed-in account. They start fresh for each
 * account and are gone after signing out. With the `realSpotify` flag on,
 * Spotify connects for real (tokens in SecureStore on this phone, never in
 * Supabase); everything else is the labeled mock. The `provider_connections`
 * rows (metadata only) come with the Supabase cards.
 */

/** Only connected services are kept. */
type Connected = Extract<ConnectionState, { status: 'connected' }>;
type Connections = Partial<Record<MusicProvider, Connected>>;
/** Why the last Connect didn't connect, per service, until the next attempt. */
export type ConnectionProblem = Exclude<ConnectionState, { status: 'connected' }>;
type Problems = Partial<Record<MusicProvider, ConnectionProblem>>;

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
  problems: Problems;
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
  problems: Problems;
  attempts: Partial<Record<MusicProvider, ConnectAttempt>>;
  preferred: MusicProvider | null;
};

/** A returning mock account connected Spotify before; a new one has nothing yet. */
function freshStore(accountId: number, returning: boolean): Store {
  const connections: Connections = returning
    ? { spotify: { status: 'connected', accountLabel: 'Mock account', isMock: true } }
    : {};
  return { accountId, connections, problems: {}, attempts: {}, preferred: null };
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
  // Connects in flight, read synchronously: two taps in the same frame both
  // see the old render's `attempts`, so that alone can't stop the second.
  const inFlight = useRef(new Set<string>());
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
      problems: store.problems,
      attempts: store.attempts,
      connected,
      playsThrough,
      connect: async (provider) => {
        // A second tap while the first connect runs does nothing.
        const key = `${accountId}:${provider}`;
        if (inFlight.current.has(key)) return;
        inFlight.current.add(key);
        update((current) => withAttempt(current, provider, 'connecting'));
        let connection: ConnectionState;
        try {
          connection = await connectProvider(provider);
        } catch (error) {
          log.child('connections').warn('Connect failed', { provider, error });
          // A throw is an unreachable service, never a crash or a raw error.
          connection = { status: 'error', code: 'provider_unavailable', isMock: false };
        } finally {
          inFlight.current.delete(key);
        }
        const result = connection;
        // Someone else may have signed in meanwhile; their services stay untouched.
        setSaved((current) => {
          if (current.accountId !== accountId) return current;
          const problems = { ...current.problems };
          delete problems[provider];
          if (result.status !== 'connected') {
            return withAttempt(
              { ...current, problems: { ...problems, [provider]: result } },
              provider,
              'failed',
            );
          }
          return withAttempt(
            { ...current, problems, connections: { ...current.connections, [provider]: result } },
            provider,
            null,
          );
        });
      },
      disconnect: (provider) => {
        disconnectProvider(provider).catch((error: unknown) =>
          log.child('connections').warn('Disconnect failed', { provider, error }),
        );
        update((current) => {
          const connections = { ...current.connections };
          delete connections[provider];
          return withAttempt({ ...current, connections }, provider, null);
        });
      },
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
