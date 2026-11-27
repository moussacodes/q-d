/**
 * q’d sign-in rules that don't depend on Supabase or React: the error codes
 * the auth service reports, email/password form validation, and which part
 * of the app a person may see (docs/DECISIONS.md, "Auth and onboarding
 * navigation").
 */

/**
 * Where someone is in the sign-in flow.
 * - `signedOut`: Welcome, Sign in, Create account.
 * - `onboarding`: signed in, but name, color and 18+ aren't done yet.
 * - `ready`: everything else.
 */
export type AuthStatus = 'signedOut' | 'onboarding' | 'ready';

export type SignInMethod = 'apple' | 'google' | 'email';

/**
 * Why a sign-in step failed. The auth service maps every Supabase error to
 * one of these, and each has its own copy (features/auth/messages.ts).
 */
export type AuthErrorCode =
  /** Wrong email or password. Deliberately doesn't say which. */
  | 'invalid_credentials'
  /** The account exists but its email link hasn't been opened yet. */
  | 'email_not_confirmed'
  /** Creating an account with an email that already has one. */
  | 'email_taken'
  /** The server refused the password as too weak or too short. */
  | 'weak_password'
  /** The server refused the email address. */
  | 'invalid_email'
  /** Too many attempts or emails in a short time. */
  | 'rate_limited'
  /** New accounts or this sign-in method are switched off on the project. */
  | 'signups_disabled'
  /** This sign-in method isn't turned on, or isn't built yet. */
  | 'method_unavailable'
  /** The person closed the sign-in window or said no. Not shown as an error. */
  | 'cancelled'
  /** A sign-in or email link that's too old to use. */
  | 'link_expired'
  /** A sign-in or email link that can't be used: wrong device, used twice, or broken. */
  | 'link_invalid'
  /**
   * The sign-in provider's answer couldn't be verified: Sign in with Apple
   * returned no identity token, or one that doesn't match this request's
   * nonce, or Supabase refused the token.
   */
  | 'verification_failed'
  /** The device couldn't reach the server. */
  | 'network'
  /** This build has no Supabase settings. */
  | 'not_configured'
  /** Anything else. Logged with its code, shown as a generic retry. */
  | 'unknown';

/** At least this many characters for a new password (Supabase's own minimum is 6). */
export const MIN_PASSWORD_LENGTH = 8;

/** Longest password the form accepts. Supabase hashes with bcrypt, which reads 72 bytes. */
export const MAX_PASSWORD_LENGTH = 72;

export type EmailFieldError = 'email_missing' | 'email_invalid';
export type PasswordFieldError = 'password_missing' | 'password_short' | 'password_long';

export interface EmailFormErrors {
  email?: EmailFieldError;
  password?: PasswordFieldError;
}

export interface EmailForm {
  email: string;
  password: string;
}

/**
 * One `@`, something before it and a dot in the domain. Deliberately loose:
 * the server has the final say, and a strict pattern turns away real addresses.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims the email; the password is kept exactly as typed. */
export function normalizeEmail(email: string): string {
  return email.trim();
}

export function validateEmail(email: string): EmailFieldError | undefined {
  const trimmed = normalizeEmail(email);
  if (trimmed === '') return 'email_missing';
  if (!EMAIL_SHAPE.test(trimmed)) return 'email_invalid';
  return undefined;
}

/**
 * Checks the email/password form before anything is sent. Signing in only
 * needs a password; creating an account also checks its length.
 */
export function validateEmailForm(
  form: EmailForm,
  mode: 'sign-in' | 'create-account',
): EmailFormErrors {
  const errors: EmailFormErrors = {};
  const email = validateEmail(form.email);
  if (email) errors.email = email;
  if (form.password === '') {
    errors.password = 'password_missing';
  } else if (mode === 'create-account') {
    if (form.password.length < MIN_PASSWORD_LENGTH) errors.password = 'password_short';
    else if (new TextEncoder().encode(form.password).length > MAX_PASSWORD_LENGTH) {
      errors.password = 'password_long';
    }
  }
  return errors;
}

export function hasFormErrors(errors: EmailFormErrors): boolean {
  return errors.email !== undefined || errors.password !== undefined;
}

/** The onboarding fields of a `profiles` row (supabase/migrations, initial schema). */
export interface ProfileFields {
  display_name: string | null;
  color: string | null;
  adult_confirmed_at: string | null;
}

/** Onboarding step 1 is done when the name, color and 18+ confirmation are all saved. */
export function isProfileComplete(profile: ProfileFields | null | undefined): boolean {
  return Boolean(
    profile && profile.display_name?.trim() && profile.color && profile.adult_confirmed_at,
  );
}

/** Signed out → Welcome; signed in without a finished profile → onboarding; else Home. */
export function resolveAuthStatus(signedIn: boolean, profileComplete: boolean): AuthStatus {
  if (!signedIn) return 'signedOut';
  return profileComplete ? 'ready' : 'onboarding';
}

/**
 * What a sign-in redirect (`…/auth/callback`) carries. Supabase's PKCE flow
 * returns `?code=…`; a failure returns `error`, `error_code` and
 * `error_description`, in the query or the fragment.
 */
export type AuthCallback =
  | { kind: 'code'; code: string }
  | { kind: 'error'; error: string; errorCode: string | null }
  | { kind: 'missing' };

function paramsOf(url: string): URLSearchParams {
  const params = new URLSearchParams();
  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = beforeHash.indexOf('?');
  const parts = [
    queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1),
    hashIndex === -1 ? '' : url.slice(hashIndex + 1),
  ];
  for (const part of parts) {
    new URLSearchParams(part).forEach((value, key) => {
      if (!params.has(key)) params.set(key, value);
    });
  }
  return params;
}

/** Reads a sign-in redirect URL. An error wins over a code. */
export function parseAuthCallbackUrl(url: string): AuthCallback {
  return parseAuthCallbackParams(Object.fromEntries(paramsOf(url)));
}

/** The same, from route params (Expo Router hands the query over as params). */
export function parseAuthCallbackParams(
  params: Record<string, string | string[] | undefined>,
): AuthCallback {
  const first = (key: string) => {
    const value = params[key];
    const text = Array.isArray(value) ? value[0] : value;
    return text && text.trim() !== '' ? text.trim() : undefined;
  };
  const error = first('error') ?? first('error_code');
  if (error) return { kind: 'error', error, errorCode: first('error_code') ?? null };
  const code = first('code');
  return code ? { kind: 'code', code } : { kind: 'missing' };
}

/** Maps a redirect's `error` / `error_code` to an `AuthErrorCode`. */
export function callbackErrorCode(error: string, errorCode: string | null): AuthErrorCode {
  const reason = errorCode ?? error;
  if (error === 'access_denied' && (!errorCode || errorCode === 'access_denied')) {
    return 'cancelled';
  }
  if (reason === 'otp_expired' || reason === 'flow_state_expired') return 'link_expired';
  if (reason === 'provider_disabled' || reason === 'oauth_provider_not_supported') {
    return 'method_unavailable';
  }
  if (reason === 'signup_disabled') return 'signups_disabled';
  if (reason === 'over_request_rate_limit') return 'rate_limited';
  if (errorCode) return 'link_invalid';
  if (error === 'server_error' || error === 'temporarily_unavailable') return 'unknown';
  return 'link_invalid';
}

/**
 * A redirect's `error` / `error_code`, safe to log. Anyone can craft a link,
 * so only short machine codes like `otp_expired` pass; anything else (free
 * text, an email address, a token) is logged as `other`.
 */
export function loggableReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) return null;
  return /^[a-z0-9_]{1,64}$/i.test(reason) ? reason : 'other';
}
