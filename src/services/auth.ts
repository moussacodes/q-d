import { isAuthRetryableFetchError, type SupabaseClient, type User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import {
  callbackErrorCode,
  isProfileComplete,
  loggableReason,
  parseAuthCallbackUrl,
  normalizeEmail,
  type AuthErrorCode,
  type EmailForm,
  type ProfileFields,
  type SignInMethod,
} from '@/domain/auth';
import {
  appleDisplayName,
  identityTokenMatchesNonce,
  toHex,
  type AppleFullName,
} from '@/domain/appleSignIn';

import { log } from './logger';
import { providerCredentials, type ProviderCredentialStore } from './providerCredentials';
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
  flow_state_expired: 'link_expired',
  otp_expired: 'link_expired',
  flow_state_not_found: 'link_invalid',
  bad_code_verifier: 'link_invalid',
  bad_oauth_state: 'link_invalid',
  bad_oauth_callback: 'link_invalid',
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
    // A thrown library error may put words in `code`; only a code-shaped one is kept.
    supabaseErrorCode: loggableReason(readString(error, 'code')),
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
  /** The name Google (or Apple) shared, offered on onboarding step 1. */
  name: string | null;
}

/** A name the sign-in provider shared, if any. Email accounts have none. */
export function providerNameOf(user: Pick<User, 'user_metadata'>): string | null {
  const metadata = user.user_metadata ?? {};
  for (const key of ['full_name', 'name']) {
    const value: unknown = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * The name Apple shared during the Sign in with Apple call that's running
 * now, if any. Apple sends it only in the credential (never in the identity
 * token) and only the first time, and Supabase announces the new session
 * before `signInWithIdToken` returns, so the `SIGNED_IN` event reads it from
 * here. Holds a name for the length of one call, never longer.
 */
let appleNameInFlight: string | null = null;

function summarize(user: User): SignedInUser {
  const method = signInMethodOf(user);
  return {
    id: user.id,
    email: user.email ?? null,
    method,
    name: providerNameOf(user) ?? (method === 'apple' ? appleNameInFlight : null),
  };
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
 * Codes already being exchanged, so a redirect that reaches the app twice
 * (the browser hands it back and the deep link also opens the callback
 * route) is exchanged once. A PKCE code works only once.
 *
 * A failed exchange is forgotten once it settles, so the link can be tried
 * again after a network failure. A successful one is remembered only until
 * the next sign-out: after that, reopening the same link must fail honestly
 * instead of reporting a session that no longer exists.
 */
const exchanges = new Map<string, Promise<AuthOutcome<SignedInUser>>>();

/** Forgets earlier exchanges. Tests only. */
export function resetCodeExchanges() {
  exchanges.clear();
}

/**
 * Finishes a PKCE sign-in: swaps the redirect's one-time `code` for a session.
 * The code verifier was stored on this device when the sign-in started, so a
 * link opened on another device (or after the app's storage was cleared)
 * fails with `link_invalid`.
 */
export function exchangeAuthCode(
  code: string,
  client: SupabaseClient | null = getSupabase(),
): Promise<AuthOutcome<SignedInUser>> {
  const running = exchanges.get(code);
  if (running) return running;
  const exchange = (async (): Promise<AuthOutcome<SignedInUser>> => {
    if (!client) return fail('not_configured');
    try {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error) return report('code_exchange', error);
      if (!data.user) return report('code_exchange', null);
      authLog.info('Signed in', { method: signInMethodOf(data.user) });
      return { ok: true, data: summarize(data.user) };
    } catch (error) {
      return report('code_exchange', error);
    }
  })();
  exchanges.set(code, exchange);
  void exchange.then((result) => {
    if (!result.ok && exchanges.get(code) === exchange) exchanges.delete(code);
  });
  return exchange;
}

/** Turns a redirect URL into a session, or the reason it can't. */
export async function completeAuthRedirect(
  url: string,
  client: SupabaseClient | null = getSupabase(),
): Promise<AuthOutcome<SignedInUser>> {
  const callback = parseAuthCallbackUrl(url);
  if (callback.kind === 'code') return exchangeAuthCode(callback.code, client);
  if (callback.kind === 'missing') {
    authLog.warn('Auth step failed', { step: 'redirect', errorCode: 'link_invalid' });
    return fail('link_invalid');
  }
  const errorCode = callbackErrorCode(callback.error, callback.errorCode);
  authLog.warn('Auth step failed', {
    step: 'redirect',
    errorCode,
    supabaseErrorCode: loggableReason(callback.errorCode ?? callback.error),
  });
  return fail(errorCode);
}

/**
 * Where Supabase sends people back after Google or an email link: the
 * `/auth/callback` route. `qd://auth/callback` in a development or store
 * build, `exp://…/--/auth/callback` in Expo Go. Each must be on the Supabase
 * project's list of redirect URLs.
 */
export function authRedirectUrl(): string {
  return Linking.createURL('auth/callback');
}

/** The part of expo-web-browser the Google sign-in uses, so tests can stand in. */
export interface AuthBrowser {
  openAuthSessionAsync(url: string, redirectUrl: string): Promise<{ type: string; url?: string }>;
}

/**
 * Sign in with Google through Supabase Auth (PKCE). Supabase gives the Google
 * page's address without leaving the app (`skipBrowserRedirect`); the system
 * sign-in sheet opens it and hands back the redirect to `redirectTo`, whose
 * `code` is exchanged for a session. Uses only Expo Go modules.
 *
 * Built, not yet tested on a device: it needs Google enabled on the Supabase
 * project and `redirectTo` on its list of redirect URLs.
 */
export async function signInWithGoogle(
  redirectTo: string,
  options: { client?: SupabaseClient | null; browser?: AuthBrowser; platform?: string } = {},
): Promise<AuthOutcome<SignedInUser>> {
  const { client = getSupabase(), browser = WebBrowser, platform = Platform.OS } = options;
  if (!client) return fail('not_configured');
  // The web build is for mock mode and guests; its popup flow isn't built.
  if (platform === 'web') return fail('method_unavailable');
  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) return report('google_start', error);
    if (!data.url) return report('google_start', null);

    const result = await browser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) {
      authLog.info('Sign-in cancelled', { method: 'google', result: result.type });
      return fail('cancelled');
    }
    return await completeAuthRedirect(result.url, client);
  } catch (error) {
    return report('google_start', error);
  }
}

/**
 * The part of expo-apple-authentication that Sign in with Apple uses, so
 * tests can stand in for it.
 */
export interface AppleAuthenticationModule {
  isAvailableAsync(): Promise<boolean>;
  signInAsync(options: {
    requestedScopes: AppleAuthentication.AppleAuthenticationScope[];
    nonce: string;
  }): Promise<{ identityToken: string | null; fullName: AppleFullName | null }>;
}

/** Random bytes and SHA-256 for the nonce. expo-crypto in the app, Node's in tests. */
export interface NonceCrypto {
  randomBytes(count: number): Uint8Array;
  /** Lowercase hex SHA-256 of the UTF-8 text. */
  sha256Hex(text: string): Promise<string>;
}

const expoNonceCrypto: NonceCrypto = {
  randomBytes: (count) => Crypto.getRandomBytes(count),
  sha256Hex: async (text) =>
    (
      await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, {
        encoding: Crypto.CryptoEncoding.HEX,
      })
    ).toLowerCase(),
};

type AppleOptions = {
  client?: SupabaseClient | null;
  apple?: AppleAuthenticationModule;
  crypto?: NonceCrypto;
  platform?: string;
};

/**
 * Whether this phone can show Sign in with Apple: iOS 13 or later with the
 * module present. Expo Go on an iPhone has it; the web and Android don't,
 * and there the button is hidden.
 */
export async function isAppleSignInAvailable(
  options: Pick<AppleOptions, 'apple' | 'platform'> = {},
): Promise<boolean> {
  const { apple = AppleAuthentication, platform = Platform.OS } = options;
  if (platform !== 'ios') return false;
  try {
    return (await apple.isAvailableAsync()) === true;
  } catch {
    return false;
  }
}

/** expo-apple-authentication's error codes, by what the person can do. */
const APPLE_CODE_MAP: Record<string, AuthErrorCode> = {
  ERR_REQUEST_CANCELED: 'cancelled',
  // The build has no Sign in with Apple entitlement, or iOS can't show the sheet.
  ERR_REQUEST_NOT_HANDLED: 'method_unavailable',
  ERR_REQUEST_NOT_INTERACTIVE: 'method_unavailable',
  ERR_INVALID_OPERATION: 'method_unavailable',
  ERR_UNAVAILABLE: 'method_unavailable',
  // The sheet answered without an identity token, or with a broken response.
  ERR_REQUEST_FAILED: 'verification_failed',
  ERR_INVALID_RESPONSE: 'verification_failed',
};

/**
 * What Supabase says when it refuses an Apple identity token. GoTrue
 * reports most of these without a specific code, so the message decides;
 * only the mapped code is ever logged, never the message.
 */
export function mapAppleTokenError(error: unknown): AuthErrorCode {
  if (readString(error, 'code') === 'bad_jwt') return 'verification_failed';
  const message = readString(error, 'message') ?? '';
  // The token's audience isn't a client ID the project lists (for example
  // `host.exp.Exponent` missing for Expo Go): a setup gap, not the person's.
  if (readStatus(error) === 400 && /audience/i.test(message)) return 'method_unavailable';
  if (readStatus(error) === 400 && /nonce|id[ _]?token|signature|expired/i.test(message)) {
    return 'verification_failed';
  }
  return mapAuthError(error);
}

function reportApple(step: string, errorCode: AuthErrorCode, error: unknown) {
  const context = { step, ...failureContext(error, errorCode) };
  if (errorCode === 'unknown') authLog.error('Auth step failed', undefined, context);
  else authLog.warn('Auth step failed', context);
  return fail(errorCode);
}

type AppleCredential = Awaited<ReturnType<AppleAuthenticationModule['signInAsync']>>;

/**
 * Sign in with Apple through Supabase Auth, using Apple's native sheet
 * (expo-apple-authentication, which ships in Expo Go on iOS).
 *
 * 1. A random nonce is made on the phone; Apple gets its SHA-256.
 * 2. Apple's identity token must carry that hash, or nothing is sent on.
 * 3. Supabase gets the token and the raw nonce (`signInWithIdToken`), checks
 *    both, and starts the session.
 *
 * Apple shares the person's name only the first time, in the credential.
 * It's offered on onboarding step 1 (through the `SIGNED_IN` event) and
 * saved to the account's metadata so a restart before onboarding keeps it;
 * that save is best effort.
 *
 * Cancelling is reported as `cancelled` and never shown as a failure. Logs
 * hold codes only: never the token, nonce, name or email.
 *
 * Built, not yet tested on a device: it needs Apple enabled on the Supabase
 * project with `host.exp.Exponent` (Expo Go) and `app.qd.mobile` (builds)
 * as client IDs.
 */
export async function signInWithApple(
  options: AppleOptions = {},
): Promise<AuthOutcome<SignedInUser>> {
  const {
    client = getSupabase(),
    apple = AppleAuthentication,
    crypto = expoNonceCrypto,
    platform = Platform.OS,
  } = options;
  if (!client) return fail('not_configured');
  if (!(await isAppleSignInAvailable({ apple, platform }))) {
    authLog.warn('Auth step failed', { step: 'apple_start', errorCode: 'method_unavailable' });
    return fail('method_unavailable');
  }

  let rawNonce: string;
  let hashedNonce: string;
  try {
    rawNonce = toHex(crypto.randomBytes(32));
    hashedNonce = await crypto.sha256Hex(rawNonce);
  } catch (error) {
    return reportApple('apple_nonce', 'unknown', error);
  }

  let credential: AppleCredential;
  try {
    credential = await apple.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (error) {
    const appleCode = readString(error, 'code');
    const errorCode = (appleCode && APPLE_CODE_MAP[appleCode]) || 'unknown';
    if (errorCode === 'cancelled') {
      authLog.info('Sign-in cancelled', { method: 'apple' });
      return fail('cancelled');
    }
    return reportApple('apple_sheet', errorCode, error);
  }

  const token = credential?.identityToken;
  if (!token) {
    authLog.warn('Auth step failed', { step: 'apple_sheet', errorCode: 'verification_failed' });
    return fail('verification_failed');
  }
  if (!identityTokenMatchesNonce(token, hashedNonce)) {
    authLog.warn('Auth step failed', { step: 'apple_nonce', errorCode: 'verification_failed' });
    return fail('verification_failed');
  }

  const sharedName = appleDisplayName(credential.fullName);
  appleNameInFlight = sharedName;
  try {
    const { data, error } = await client.auth.signInWithIdToken({
      provider: 'apple',
      token,
      nonce: rawNonce,
    });
    if (error) return reportApple('apple_id_token', mapAppleTokenError(error), error);
    if (!data.user) return report('apple_id_token', null);
    const user = summarize(data.user);
    if (sharedName && !providerNameOf(data.user)) await saveAppleName(client, sharedName);
    authLog.info('Signed in', { method: 'apple' });
    return { ok: true, data: user };
  } catch (error) {
    return reportApple('apple_id_token', mapAppleTokenError(error), error);
  } finally {
    appleNameInFlight = null;
  }
}

/**
 * Keeps Apple's one-time name on the account (`user_metadata.full_name`),
 * where `providerNameOf` finds it after a restart. Never fails the sign-in.
 */
async function saveAppleName(client: SupabaseClient, fullName: string): Promise<void> {
  try {
    const { error } = await client.auth.updateUser({ data: { full_name: fullName } });
    if (error) {
      authLog.warn('Could not save the Apple name', failureContext(error, mapAuthError(error)));
    }
  } catch (error) {
    authLog.warn('Could not save the Apple name', failureContext(error, mapAuthError(error)));
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

/**
 * Removes every music-service credential saved on this device. Called
 * whenever the device returns to signed out (Sign out, or Supabase ending the
 * session), so the next person to sign in here never inherits someone
 * else's Apple Music or Spotify tokens. Never throws; a failure is logged
 * without the credentials.
 */
export async function clearProviderCredentials(
  store: Pick<ProviderCredentialStore, 'clearAll'> = providerCredentials,
): Promise<void> {
  try {
    await store.clearAll();
  } catch (error) {
    authLog.warn('Could not clear provider credentials', failureContext(error, 'unknown'));
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
      authLog.warn('Profile check failed', { supabaseErrorCode: loggableReason(error.code) });
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
    // A code exchanged for the session that just ended can't sign in again.
    if (event === 'SIGNED_OUT') exchanges.clear();
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
