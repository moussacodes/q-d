import type { SupabaseClient } from '@supabase/supabase-js';

import type { OnboardingProfile, ProfileChange } from '@/domain/profile';

import { loggableDbCode } from './logFields';
import { log } from './logger';
import { getSupabase } from './supabase';

/**
 * Writes the caller's own `profiles` row (docs/API_CONTRACTS.md § 3.1). One
 * of the three direct writes row level security allows (DECISIONS 2026-11-24
 * · Row level security): `update` on `display_name`, `color` and
 * `adult_confirmed_at` of the row whose id is the caller's. Nothing else on
 * the row can be written, and no other row.
 *
 * Callers validate first (src/domain/profile.ts). The database checks the
 * same rules again, so a write that slips past the app still fails.
 *
 * Logs carry the step and a database error code only, never the name or
 * the color.
 */

export type ProfileWriteError =
  /** No Supabase settings in this build. */
  | 'not_configured'
  /** No row was updated: the session ended, or the row isn't the caller's. */
  | 'not_signed_in'
  /** The request never got an answer. Nothing may have been saved. */
  | 'network'
  /** The database refused the values (a check or a permission). */
  | 'rejected'
  | 'unknown';

export type ProfileWriteResult = { ok: true } | { ok: false; error: ProfileWriteError };

/** Columns a client may write (the grant in 20261124000300_row_level_security.sql). */
type ProfileColumns = {
  display_name?: string;
  color?: string;
  adult_confirmed_at?: string;
};

const profilesLog = log.child('profiles');

function isNetworkFailure(error: { message?: string; code?: string }): boolean {
  return (
    !error.code &&
    /network|fetch|timed? ?out|abort|offline|connection|load failed/i.test(error.message ?? '')
  );
}

function errorFrom(error: { message?: string; code?: string }): ProfileWriteError {
  if (isNetworkFailure(error)) return 'network';
  // 23514 check_violation, 22001 too long, 42501 permission denied,
  // 23502 not null, 22P02 bad input.
  if (['23514', '22001', '42501', '23502', '22P02'].includes(error.code ?? '')) return 'rejected';
  // PGRST301 / PGRST303: the JWT is invalid or expired (PostgREST 12 reports
  // an expired one as PGRST303).
  if (error.code === 'PGRST301' || error.code === 'PGRST303') return 'not_signed_in';
  return 'unknown';
}

async function writeOwnProfile(
  step: 'onboarding' | 'settings',
  userId: string,
  columns: ProfileColumns,
  client: SupabaseClient | null,
): Promise<ProfileWriteResult> {
  if (!client) return { ok: false, error: 'not_configured' };
  try {
    const { data, error } = await client
      .from('profiles')
      .update(columns)
      .eq('id', userId)
      .select('id');
    if (error) {
      const result = errorFrom(error);
      const dbCode = loggableDbCode(error.code);
      profilesLog.warn('Profile save failed', { step, result, dbCode });
      return { ok: false, error: result };
    }
    // RLS hides other people's rows, so an update that matched nothing means
    // the session isn't this user's any more.
    if (!data || data.length === 0) {
      profilesLog.warn('Profile save failed', { step, result: 'not_signed_in' });
      return { ok: false, error: 'not_signed_in' };
    }
    profilesLog.info('Profile saved', { step, fields: Object.keys(columns).sort() });
    return { ok: true };
  } catch {
    // supabase-js reports fetch failures in `error`, but a thrown one is the
    // same thing: no answer.
    profilesLog.warn('Profile save failed', { step, result: 'network' });
    return { ok: false, error: 'network' };
  }
}

/**
 * Onboarding step 1: saves the name, the color and when the person confirmed
 * they're 18 or older. After this the profile is finished
 * (`isProfileComplete`), so the next sign-in goes straight Home.
 */
export function saveOnboardingProfile(
  userId: string,
  profile: OnboardingProfile,
  options: { client?: SupabaseClient | null; now?: () => Date } = {},
): Promise<ProfileWriteResult> {
  const { client = getSupabase(), now = () => new Date() } = options;
  return writeOwnProfile(
    'onboarding',
    userId,
    {
      display_name: profile.displayName,
      color: profile.color,
      adult_confirmed_at: now().toISOString(),
    },
    client,
  );
}

/** Settings → Account: a new name or color. The 18+ confirmation isn't touched. */
export function updateProfile(
  userId: string,
  change: ProfileChange,
  client: SupabaseClient | null = getSupabase(),
): Promise<ProfileWriteResult> {
  const columns: ProfileColumns = {};
  if (change.displayName !== undefined) columns.display_name = change.displayName;
  if (change.color !== undefined) columns.color = change.color;
  if (Object.keys(columns).length === 0) return Promise.resolve({ ok: true });
  return writeOwnProfile('settings', userId, columns, client);
}
