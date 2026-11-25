import { useState } from 'react';

import {
  hasFormErrors,
  validateEmailForm,
  type AuthErrorCode,
  type EmailFormErrors,
} from '@/domain/auth';
import { useMockSession } from '@/features/session/MockSession';
import { signInWithEmail, signUpWithEmail } from '@/services/auth';
import { isLiveAuth } from '@/services/dataMode';

import { authErrorMessages, checkEmailMessage, fieldErrorMessages } from './messages';

export type EmailAuthMode = 'sign-in' | 'create-account';

export interface EmailAuthOptions {
  /** Tests switch this; the app uses the build's auth mode. */
  live?: boolean;
  /** Where the confirmation email's link should open the app (auth callback). */
  emailRedirectTo?: () => string | undefined;
}

/**
 * The email/password form on Sign in and Create account. Checks the fields
 * before anything is sent, then signs in with the mock session or Supabase
 * Auth. In live mode a successful sign-in is routed by `AuthSync`, which
 * hears Supabase's auth event, so the button stays busy until the next
 * screen replaces this one.
 */
export function useEmailAuth(mode: EmailAuthMode, options: EmailAuthOptions = {}) {
  const { live = isLiveAuth, emailRedirectTo } = options;
  const { signIn, createAccount } = useMockSession();
  const [email, setEmailValue] = useState('');
  const [password, setPasswordValue] = useState('');
  const [fieldErrors, setFieldErrors] = useState<EmailFormErrors>({});
  const [formError, setFormError] = useState<AuthErrorCode | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const setEmail = (value: string) => {
    setEmailValue(value);
    setFieldErrors((current) => ({ ...current, email: undefined }));
    setFormError(null);
  };
  const setPassword = (value: string) => {
    setPasswordValue(value);
    setFieldErrors((current) => ({ ...current, password: undefined }));
    setFormError(null);
  };

  const submit = async () => {
    if (submitting) return;
    const errors = validateEmailForm({ email, password }, mode);
    setFieldErrors(errors);
    setFormError(null);
    setCheckEmail(false);
    if (hasFormErrors(errors)) return;

    if (!live) {
      if (mode === 'sign-in') signIn('email');
      else createAccount('email');
      return;
    }

    setSubmitting(true);
    if (mode === 'sign-in') {
      const result = await signInWithEmail({ email, password });
      if (!result.ok) {
        setFormError(result.code);
        setSubmitting(false);
      }
      return;
    }
    const result = await signUpWithEmail(
      { email, password },
      { emailRedirectTo: emailRedirectTo?.() },
    );
    if (!result.ok) {
      setFormError(result.code);
      setSubmitting(false);
    } else if (result.data.needsEmailConfirmation) {
      setCheckEmail(true);
      setPasswordValue('');
      setSubmitting(false);
    }
  };

  return {
    email,
    password,
    setEmail,
    setPassword,
    submit,
    submitting,
    emailError: fieldErrors.email ? fieldErrorMessages[fieldErrors.email] : null,
    passwordError: fieldErrors.password ? fieldErrorMessages[fieldErrors.password] : null,
    formError: formError ? authErrorMessages[formError] : null,
    formErrorCode: formError,
    notice: checkEmail ? checkEmailMessage : null,
  };
}
