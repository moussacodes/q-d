import type { MusicProvider } from '@/domain/music-provider';
import {
  reconcileConnections,
  type LocalConnection,
  type ReconcilePlan,
} from '@/domain/provider-connection';
import type { ConnectionState } from '@/providers';
import { log } from '@/services/logger';
import type { ConnectionRowResult } from '@/services/providerConnections';

/**
 * Keeps `provider_connections` in step with what this phone really holds
 * (DECISIONS.md, "Record real provider connections"). Used by
 * ProviderConnections.tsx in live auth mode only; the I/O comes in as
 * `deps`, so the rules here are tested without Supabase or Spotify.
 */

export interface ConnectionRowDeps {
  record: (provider: MusicProvider) => Promise<ConnectionRowResult>;
  remove: (provider: MusicProvider) => Promise<ConnectionRowResult>;
  /** A real connection held on this phone, checked; null when this build can't tell. */
  stored: (provider: MusicProvider) => Promise<ConnectionState | null>;
}

/** Only a real `connected` state is a connection the server may trust. */
export function isRealConnection(state: ConnectionState | null | undefined): boolean {
  return state?.status === 'connected' && !state.isMock;
}

/**
 * What a stored-connection check says about the row. Offline or the service
 * failing is `unknown`, so a flaky network never deletes a good row. Only
 * "no tokens here" and refusals that need a new sign-in make it `unusable`.
 */
export function localConnectionOf(state: ConnectionState | null): LocalConnection {
  if (state === null || state.isMock) return 'unknown';
  if (state.status === 'connected') return 'usable';
  if (state.status === 'needs_authorization') return 'unusable';
  if (state.status === 'error' && state.code === 'not_approved_user') return 'unusable';
  return 'unknown';
}

export interface ReconcileOutcome {
  plan: ReconcilePlan;
  /** Real connections this phone holds, to show as connected. */
  connected: Partial<Record<MusicProvider, ConnectionState>>;
  /** Rows written now. A service missing here still needs its row. */
  recorded: MusicProvider[];
}

const rowsLog = log.child('connectionRows');

/**
 * Startup: checks each service this phone could hold for real, then deletes
 * the row of each one with nothing usable behind it and writes (or marks
 * checked) the row of each real connection, which also repairs a write that
 * failed earlier. A service this build can't check is left alone.
 */
export async function reconcileProviderRows(
  providers: readonly MusicProvider[],
  deps: ConnectionRowDeps,
): Promise<ReconcileOutcome> {
  const local: Partial<Record<MusicProvider, LocalConnection>> = {};
  const connected: Partial<Record<MusicProvider, ConnectionState>> = {};
  for (const provider of providers) {
    let state: ConnectionState | null;
    try {
      state = await deps.stored(provider);
    } catch {
      state = null;
    }
    local[provider] = localConnectionOf(state);
    if (state && isRealConnection(state)) connected[provider] = state;
  }

  const plan = reconcileConnections(local);
  for (const provider of plan.remove) {
    const removed = await deps.remove(provider);
    if (!removed.ok) rowsLog.warn('Stale connection row kept', { provider, result: removed.error });
  }
  const recorded: MusicProvider[] = [];
  for (const provider of plan.record) {
    if ((await deps.record(provider)).ok) recorded.push(provider);
  }
  if (plan.remove.length > 0 || plan.record.length > 0) {
    rowsLog.info('Connection rows reconciled', { removed: plan.remove, recorded });
  }
  return { plan, connected, recorded };
}
