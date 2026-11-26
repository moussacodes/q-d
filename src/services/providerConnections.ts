import type { SupabaseClient } from '@supabase/supabase-js';

import type { MusicProvider } from '@/domain/music-provider';

import { loggableDbCode } from './logFields';
import { log } from './logger';
import { getSupabase } from './supabase';

/**
 * The caller's own `provider_connections` rows (docs/API_CONTRACTS.md § 3,
 * "Own provider connections"). One of the three direct writes row level
 * security allows: insert, update (`last_verified_at`, `storefront`) and
 * delete, on rows whose `user_id` is the caller's.
 *
 * A row holds which service, when it was connected and last checked, and a
 * storefront. Never a token: the columns below are the only ones this file
 * can send, and the table has no column that could hold one (a schema test
 * fails if one is added).
 *
 * Logs carry the step, the service and a database error code only.
 */

export type ConnectionRowError = 'not_configured' | 'not_signed_in' | 'network' | 'unknown';

export type ConnectionRowResult<T = undefined> =
  { ok: true; value: T } | { ok: false; error: ConnectionRowError };

/** Everything the app may write to a row. No credential fits here. */
export interface ConnectionRowInput {
  /** A two-letter storefront / market (`us`), when the service told us one. */
  storefront?: string | null;
}

const rowsLog = log.child('providerConnections');

type DbError = { code?: string; message?: string };

function errorFrom(error: DbError): ConnectionRowError {
  if (
    !error.code &&
    /network|fetch|timed? ?out|abort|offline|connection|load failed/i.test(error.message ?? '')
  ) {
    return 'network';
  }
  // PGRST301 / PGRST303: the JWT is invalid or expired.
  if (['PGRST301', 'PGRST303', '42501'].includes(error.code ?? '')) return 'not_signed_in';
  return 'unknown';
}

function failed(step: string, provider: MusicProvider | null, error: DbError) {
  const result = errorFrom(error);
  const dbCode = loggableDbCode(error.code);
  rowsLog.warn('Connection row failed', { step, provider, result, dbCode });
  return { ok: false as const, error: result };
}

function threw(step: string, provider: MusicProvider | null) {
  rowsLog.warn('Connection row failed', { step, provider, result: 'network' });
  return { ok: false as const, error: 'network' as const };
}

const STOREFRONT = /^[a-z]{2}$/;

/** The storefront the table accepts, or nothing. */
function storefrontOf(input: ConnectionRowInput): { storefront: string } | Record<string, never> {
  const value = input.storefront?.toLowerCase();
  return value && STOREFRONT.test(value) ? { storefront: value } : {};
}

/**
 * After a real connect succeeds (or a startup check passes): makes sure the
 * row exists and marks it checked now. Inserts it; if it's already there
 * (`23505`), updates `last_verified_at` and the storefront instead. Not a
 * PostgREST upsert, because that would also write `user_id` and `provider`,
 * which the grant doesn't allow.
 */
export async function recordProviderConnection(
  userId: string,
  provider: MusicProvider,
  input: ConnectionRowInput = {},
  options: { client?: SupabaseClient | null; now?: () => Date } = {},
): Promise<ConnectionRowResult> {
  const { client = getSupabase(), now = () => new Date() } = options;
  if (!client) return { ok: false, error: 'not_configured' };
  const checked = { last_verified_at: now().toISOString(), ...storefrontOf(input) };
  try {
    const inserted = await client
      .from('provider_connections')
      .insert({ user_id: userId, provider, ...checked });
    if (!inserted.error) {
      rowsLog.info('Connection recorded', { provider, step: 'insert' });
      return { ok: true, value: undefined };
    }
    if (inserted.error.code !== '23505') return failed('insert', provider, inserted.error);

    const updated = await client
      .from('provider_connections')
      .update(checked)
      .eq('user_id', userId)
      .eq('provider', provider)
      .select('provider');
    if (updated.error) return failed('update', provider, updated.error);
    if (!updated.data || updated.data.length === 0) {
      // The row was there a moment ago: another phone on this account
      // deleted it in between (its startup reconcile, or Disconnect). Insert
      // once more; a duplicate now means another write put it back.
      const again = await client
        .from('provider_connections')
        .insert({ user_id: userId, provider, ...checked });
      if (!again.error || again.error.code === '23505') {
        rowsLog.info('Connection recorded', { provider, step: 'reinsert' });
        return { ok: true, value: undefined };
      }
      return failed('reinsert', provider, again.error);
    }
    rowsLog.info('Connection recorded', { provider, step: 'update' });
    return { ok: true, value: undefined };
  } catch {
    return threw('record', provider);
  }
}

/** After Disconnect, or when this phone has nothing usable behind the row. */
export async function removeProviderConnection(
  userId: string,
  provider: MusicProvider,
  client: SupabaseClient | null = getSupabase(),
): Promise<ConnectionRowResult> {
  if (!client) return { ok: false, error: 'not_configured' };
  try {
    const { error } = await client
      .from('provider_connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider);
    if (error) return failed('remove', provider, error);
    rowsLog.info('Connection removed', { provider });
    return { ok: true, value: undefined };
  } catch {
    return threw('remove', provider);
  }
}
