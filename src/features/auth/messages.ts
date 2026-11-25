import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type AuthErrorCode,
  type EmailFieldError,
  type PasswordFieldError,
  type SignInMethod,
} from '@/domain/auth';

/**
 * What the sign-in screens say when something goes wrong. Each message says
 * what happened and what to do next, and never claims more than we know: a
 * wrong password doesn't say whether the email has an account.
 */
export const authErrorMessages: Record<AuthErrorCode, string> = {
  invalid_credentials: 'That email and password don’t match an account. Check both and try again.',
  email_not_confirmed: 'Confirm your email first. Open the link we sent you, then sign in.',
  email_taken: 'There’s already an account with this email. Sign in instead.',
  weak_password: 'Choose a stronger password: longer, and harder to guess.',
  invalid_email: 'That email address can’t be used. Check it, or try another one.',
  rate_limited: 'Too many tries. Wait a minute, then try again.',
  signups_disabled: 'New accounts can’t be created this way right now. Try again later.',
  method_unavailable: 'This sign-in option isn’t available yet. Use email instead.',
  network: 'Couldn’t reach q’d. Check your connection and try again.',
  not_configured: 'Sign-in isn’t set up in this build of q’d.',
  unknown: 'Something went wrong. Try again.',
};

export const fieldErrorMessages: Record<EmailFieldError | PasswordFieldError, string> = {
  email_missing: 'Enter your email.',
  email_invalid: 'Enter an email address like you@example.com.',
  password_missing: 'Enter your password.',
  password_short: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  password_long: `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
};

const methodNames: Record<SignInMethod, string> = {
  apple: 'Sign in with Apple',
  google: 'Sign in with Google',
  email: 'Email sign-in',
};

/** For a button whose sign-in method isn't built or turned on in this build. */
export function methodUnavailableMessage(method: SignInMethod): string {
  return `${methodNames[method]} isn’t available yet. Use email instead.`;
}

export const checkEmailMessage =
  'Check your email. Open the link we sent to finish creating your account, then sign in.';
