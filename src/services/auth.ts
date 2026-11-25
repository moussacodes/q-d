import { isAuthRetryableFetchError, type SupabaseClient, type User } from '@supabase/supabase-js';

import {
  isProfileComplete,
  normalizeEmail,
  type AuthErrorCode,
  type EmailForm,
  type ProfileFields,
  type SignInMethod,
} from '@/domain/auth';

import { log } from './logger';
import { getSupabase } from './supabase';

/**
 * q’d sign-in through Supabase Auth (docs/ARCHITECTURE.md §4.11). The only
 * code that calls `supabase.auth`. Feature hooks call these functions; routes
 * never do.
 *
 * Every function returns an outcome instead of throwing, and every Supabase
 * error becomes an `AuthErrorCode` with its own copy, so a screen can always
 * say something honest. Logs carry the error codes and HTTP status only:
 * never the email, password, tokens or the person's id.
 */

export type AuthOutcome<T = undefined> = { ok: true; data: T } | { ok: false; code: AuthErrorCode };

const authLog = log.child('auth');

const fail = (code: AuthErrorCode): { ok: false; code: AuthErrorCode } => ({ ok: false, code });

/** Supabase error codes, grouped by what the person can do about them. */
const CODE_MAP: Record<string, AuthErrorCode> = {
  invalid_credentials: 'invalid_credentials',
  email_not_confirmed: 'email_not_confirmed',
  user_already_exists: 'email_taken',
  email_exists: 'email_taken',
  identity_already_exists: 'email_taken',
  weak_password: 'weak_password',
  email_address_invalid: 'invalid_email',
  email_address_not_authorized: 'invalid_email',
  over_request_rate_limit: 'rate_limited',
  over_email_send_rate_limit: 'rate_limited',
  signup_disabled: 'signups_disabled',
  email_provider_disabled: 'signups_disabled',
  provider_disabled: 'method_unavailable',
  oauth_provider_not_supported: 'method_unavailable',
  request_timeout: 'network',
};

function readString(value: unknown, key: string): string | undefined {
  if (value && typeof value === 'object' && key in value) {
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'string' ? field : undefined;
  }
  return undefined;
}

function readStatus(value: unknown): number | undefined {
  if (value && typeof value === 'object' && 'status' in value) {
    const status = (value as { status: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

/** Maps anything Supabase Auth returned or threw to an `AuthErrorCode`. */
export function mapAuthError(error: unknown): AuthErrorCode {
  if (isAuthRetryableFetchError(error)) return 'network';
  // fetch() itself failed: React Native says "Network request failed".
  if (error instanceof TypeError && /network|fetch/i.test(error.message)) return 'network';

  const code = readString(error, 'code');
  if (code && code in CODE_MAP) return CODE_MAP[code];

  const status = readStatus(error);
  if (status === 429) return 'rate_limited';
  // Older Auth servers send no code for a wrong password, only this message.
  if (status === 400 && /invalid login credentials/i.test(readString(error, 'message') ?? '')) {
    return 'invalid_credentials';
  }
  return 'unknown';
}

/** What gets logged about a failure: codes and status, never the message (it can echo input). */
function failureContext(error: unknown, errorCode: AuthErrorCode) {
  return {
    errorCode,
    supabaseErrorCode: readString(error, 'code') ?? null,
    status: readStatus(error) ?? null,
  };
}

function report(step: string, error: unknown): { ok: false; code: AuthErrorCode } {
  const errorCode = mapAuthError(error);
  const context = { step, ...failureContext(error, errorCode) };
  if (errorCode === 'unknown') authLog.error('Auth step failed', undefined, context);
  else authLog.warn('Auth step failed', context);
  return fail(errorCode);
}

/** The sign-in method Supabase recorded for this user. */
export function signInMethodOf(user: Pick<User, 'app_metadata'>): SignInMethod {
  const provider = user.app_metadata?.provider;
  return provider === 'google' || provider === 'apple' ? provider : 'email';
}

export interface SignedInUser {
  id: string;
  email: string | null;
  method: SignInMethod;
}

function summarize(user: User): SignedInUser {
  return { id: user.id, email: user.email ?? null, method: signInMethodOf(user) };
}

export async function signInWithEmail(
  form: EmailForm,
  client: SupabaseClient | null = getSupabase(),
): Promise<AuthOutcome<SignedInUser>> {
  if (!client) return fail('not_configured');
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: normalizeEmail(form.email),
      password: form.password,
    });
    if (error) return report('email_sign_in', error);
    if (!data.user) return report('email_sign_in', null);
    authLog.info('Signed in', { method: 'email' });
    return { ok: true, data: summarize(data.user) };
  } catch (error) {
    return report('email_sign_in', error);
  }
}

export interface SignUpResult extends SignedInUser {
  /**
   * True when the project asks new accounts to confirm their email first.
   * There's no session yet; the person opens the link in the email.
   */
  needsEmailConfirmation: boolean;
}

export async function signUpWithEmail(
  form: EmailForm,
  options: { emailRedirectTo?: string } = {},
  client: SupabaseClient | null = getSupabase(),
): Promise<AuthOutcome<SignUpResult>> {
  if (!client) return fail('not_configured');
  try {
    const { data, error } = await client.auth.signUp({
      email: normalizeEmail(form.email),
      password: form.password,
      options: options.emailRedirectTo ? { emailRedirectTo: options.emailRedirectTo } : undefined,
    });
    if (error) return report('email_sign_up', error);
    if (!data.user) return report('email_sign_up', null);
    // With email confirmation on, Supabase answers a sign-up for an existing
    // address with a user that has no identities instead of an error.
    if (!data.session && data.user.identities?.length === 0) {
      authLog.warn('Auth step failed', { step: 'email_sign_up', errorCode: 'email_taken' });
      return fail('email_taken');
    }
    authLog.info('Account created', { method: 'email', confirmed: Boolean(data.session) });
    return {
      ok: true,
      data: { ...summarize(data.user), needsEmailConfirmation: data.session === null },
    };
  } catch (error) {
    return report('email_sign_up', error);
  }
}

/**
 * Signs out of this device. The session is removed locally before the
 * server is told, so signing out never depends on the network.
 */
export async function signOut(client: SupabaseClient | null = getSupabase()): Promise<AuthOutcome> {
  if (!client) return { ok: true, data: undefined };
  try {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) return report('sign_out', error);
    authLog.info('Signed out');
    return { ok: true, data: undefined };
  } catch (error) {
    return report('sign_out', error);
  }
}

/** The saved onboarding profile, when step 1 is finished. */
export interface SavedProfile {
  name: string;
  color: string;
}

/**
 * The signed-in person's finished profile, or null when onboarding step 1
 * isn't done. Reads their own `profiles` row (RLS allows only their own and
 * roommates'). Any failure counts as not finished, so the person lands on
 * onboarding, never on Home with a half-made profile.
 */
export async function fetchSavedProfile(
  userId: string,
  client: SupabaseClient | null = getSupabase(),
): Promise<SavedProfile | null> {
  if (!client) return null;
  try {
    const { data, error } = await client
      .from('profiles')
      .select('display_name, color, adult_confirmed_at')
      .eq('id', userId)
      .maybeSingle<ProfileFields>();
    if (error) {
      authLog.warn('Profile check failed', { supabaseErrorCode: error.code ?? null });
      return null;
    }
    if (!data || !isProfileComplete(data)) return null;
    return { name: (data.display_name ?? '').trim(), color: data.color ?? '' };
  } catch (error) {
    authLog.warn('Profile check failed', failureContext(error, mapAuthError(error)));
    return null;
  }
}

export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY'
  | 'MFA_CHALLENGE_VERIFIED';

export interface AuthChange {
  event: AuthChangeEvent;
  /** Null when signed out. Never holds tokens. */
  user: SignedInUser | null;
}

/**
 * Calls `listener` whenever the session changes, starting with the stored
 * session (`INITIAL_SESSION`). The listener runs on the next tick: Supabase
 * holds its auth lock while it notifies, and a listener that calls Supabase
 * straight away would wait on that lock forever. Returns an unsubscribe.
 */
export function onAuthChange(
  listener: (change: AuthChange) => void,
  client: SupabaseClient | null = getSupabase(),
): () => void {
  if (!client) return () => {};
  let active = true;
  const { data } = client.auth.onAuthStateChange((event, session) => {
    const change: AuthChange = {
      event: event as AuthChangeEvent,
      user: session?.user ? summarize(session.user) : null,
    };
    setTimeout(() => {
      if (active) listener(change);
    }, 0);
  });
  return () => {
    active = false;
    data.subscription.unsubscribe();
  };
}
