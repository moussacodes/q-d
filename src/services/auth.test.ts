import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthWeakPasswordError,
} from '@supabase/supabase-js';

import type { AuthErrorCode } from '@/domain/auth';
import {
  completeProfile,
  createFakeSupabase,
  fakeSession,
  fakeUser,
  type FakeSupabase,
} from '@/test/fakeSupabase';

import {
  clearProviderCredentials,
  fetchSavedProfile,
  mapAuthError,
  onAuthChange,
  signInMethodOf,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  type AuthChange,
} from './auth';
import { addLogSink, type LogEntry } from './logger';

const form = { email: '  someone@example.com ', password: 'correct-horse-battery' };
const apiError = (message: string, status: number, code?: string) =>
  new AuthApiError(message, status, code);

let fake: FakeSupabase;
let entries: LogEntry[];
let removeSink: () => void;

beforeEach(() => {
  fake = createFakeSupabase();
  entries = [];
  removeSink = addLogSink((entry) => entries.push(entry));
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  removeSink();
  jest.restoreAllMocks();
});

/** Nothing logged may hold the email, the password or a token. */
function expectNothingSensitiveLogged() {
  const logged = JSON.stringify(entries);
  expect(logged).not.toContain('someone@example.com');
  expect(logged).not.toContain('someone');
  expect(logged).not.toContain(form.password);
  expect(logged).not.toContain(fakeSession().access_token);
  expect(logged).not.toContain(fakeSession().refresh_token);
  expect(logged).not.toContain('user-1');
}

describe('mapAuthError', () => {
  it.each<[string, unknown, AuthErrorCode]>([
    [
      'wrong password',
      apiError('Invalid login credentials', 400, 'invalid_credentials'),
      'invalid_credentials',
    ],
    [
      'wrong password from an older server',
      apiError('Invalid login credentials', 400),
      'invalid_credentials',
    ],
    [
      'unconfirmed email',
      apiError('Email not confirmed', 400, 'email_not_confirmed'),
      'email_not_confirmed',
    ],
    [
      'existing user',
      apiError('User already registered', 422, 'user_already_exists'),
      'email_taken',
    ],
    ['existing email', apiError('Email exists', 422, 'email_exists'), 'email_taken'],
    [
      'existing identity',
      apiError('Identity exists', 422, 'identity_already_exists'),
      'email_taken',
    ],
    [
      'weak password',
      new AuthWeakPasswordError('Password is too weak', 422, ['length']),
      'weak_password',
    ],
    [
      'invalid email',
      apiError('Email address is invalid', 400, 'email_address_invalid'),
      'invalid_email',
    ],
    [
      'email not allowed',
      apiError('Not authorized', 400, 'email_address_not_authorized'),
      'invalid_email',
    ],
    ['request rate limit', apiError('Too many', 429, 'over_request_rate_limit'), 'rate_limited'],
    [
      'email rate limit',
      apiError('Too many emails', 429, 'over_email_send_rate_limit'),
      'rate_limited',
    ],
    ['bare 429', apiError('Slow down', 429), 'rate_limited'],
    ['sign-ups off', apiError('Signups not allowed', 422, 'signup_disabled'), 'signups_disabled'],
    [
      'email provider off',
      apiError('Email logins are disabled', 422, 'email_provider_disabled'),
      'signups_disabled',
    ],
    [
      'provider off',
      apiError('Provider is not enabled', 400, 'provider_disabled'),
      'method_unavailable',
    ],
    [
      'provider unsupported',
      apiError('Unsupported', 400, 'oauth_provider_not_supported'),
      'method_unavailable',
    ],
    ['timeout', apiError('Timed out', 504, 'request_timeout'), 'network'],
    ['offline', new AuthRetryableFetchError('Failed to fetch', 0), 'network'],
    ['fetch failed', new TypeError('Network request failed'), 'network'],
    ['unexpected code', apiError('Boom', 500, 'unexpected_failure'), 'unknown'],
    ['plain error', new Error('nope'), 'unknown'],
    ['null', null, 'unknown'],
    ['a string', 'bad', 'unknown'],
  ])('%s → %s', (_name, error, expected) => {
    expect(mapAuthError(error)).toBe(expected);
  });
});

describe('signInWithEmail', () => {
  it('signs in with the trimmed email and the password as typed', async () => {
    const result = await signInWithEmail(form, fake.client);
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'someone@example.com',
      password: form.password,
    });
    expect(result).toEqual({
      ok: true,
      data: { id: 'user-1', email: 'someone@example.com', method: 'email', name: null },
    });
    expectNothingSensitiveLogged();
  });

  it.each<[unknown, AuthErrorCode]>([
    [apiError('Invalid login credentials', 400, 'invalid_credentials'), 'invalid_credentials'],
    [apiError('Email not confirmed', 400, 'email_not_confirmed'), 'email_not_confirmed'],
    [apiError('Too many', 429, 'over_request_rate_limit'), 'rate_limited'],
    [new AuthRetryableFetchError('Failed to fetch', 0), 'network'],
  ])('reports %p as %s, and logs codes only', async (error, code) => {
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error,
    } as never);
    await expect(signInWithEmail(form, fake.client)).resolves.toEqual({ ok: false, code });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'warn',
      message: 'Auth step failed',
      context: { step: 'email_sign_in', errorCode: code },
    });
    expectNothingSensitiveLogged();
  });

  it('logs an unknown failure as an error, without its message', async () => {
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: apiError('Database error for someone@example.com', 500, 'unexpected_failure'),
    } as never);
    await expect(signInWithEmail(form, fake.client)).resolves.toEqual({
      ok: false,
      code: 'unknown',
    });
    expect(entries[0]).toMatchObject({
      level: 'error',
      context: { supabaseErrorCode: 'unexpected_failure', status: 500 },
    });
    expectNothingSensitiveLogged();
  });

  it('turns a thrown error into an outcome', async () => {
    fake.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(signInWithEmail(form, fake.client)).resolves.toEqual({
      ok: false,
      code: 'network',
    });
  });

  it('treats a reply with no user as unknown', async () => {
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: null,
    } as never);
    await expect(signInWithEmail(form, fake.client)).resolves.toEqual({
      ok: false,
      code: 'unknown',
    });
  });

  it('says not_configured without a client, and sends nothing', async () => {
    await expect(signInWithEmail(form, null)).resolves.toEqual({
      ok: false,
      code: 'not_configured',
    });
  });
});

describe('signUpWithEmail', () => {
  it('creates an account that is signed in straight away', async () => {
    const result = await signUpWithEmail(form, {}, fake.client);
    expect(fake.auth.signUp).toHaveBeenCalledWith({
      email: 'someone@example.com',
      password: form.password,
      options: undefined,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        id: 'user-1',
        email: 'someone@example.com',
        method: 'email',
        name: null,
        needsEmailConfirmation: false,
      },
    });
    expectNothingSensitiveLogged();
  });

  it('asks for email confirmation when there is no session yet, with the callback link', async () => {
    fake.auth.signUp.mockResolvedValueOnce({
      data: { user: fakeUser(), session: null },
      error: null,
    });
    const result = await signUpWithEmail(
      form,
      { emailRedirectTo: 'qd://auth/callback' },
      fake.client,
    );
    expect(fake.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ options: { emailRedirectTo: 'qd://auth/callback' } }),
    );
    expect(result).toMatchObject({ ok: true, data: { needsEmailConfirmation: true } });
  });

  it('reports an existing email that Supabase hides behind an empty identity list', async () => {
    fake.auth.signUp.mockResolvedValueOnce({
      data: { user: fakeUser({ identities: [] }), session: null },
      error: null,
    });
    await expect(signUpWithEmail(form, {}, fake.client)).resolves.toEqual({
      ok: false,
      code: 'email_taken',
    });
    expectNothingSensitiveLogged();
  });

  it.each<[unknown, AuthErrorCode]>([
    [apiError('User already registered', 422, 'user_already_exists'), 'email_taken'],
    [new AuthWeakPasswordError('Password is too weak', 422, ['length']), 'weak_password'],
    [apiError('Email address is invalid', 400, 'email_address_invalid'), 'invalid_email'],
    [apiError('Signups not allowed', 422, 'signup_disabled'), 'signups_disabled'],
    [apiError('Too many emails', 429, 'over_email_send_rate_limit'), 'rate_limited'],
  ])('reports %p as %s', async (error, code) => {
    fake.auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error } as never);
    await expect(signUpWithEmail(form, {}, fake.client)).resolves.toEqual({ ok: false, code });
    expectNothingSensitiveLogged();
  });

  it('turns a thrown error into an outcome', async () => {
    fake.auth.signUp.mockRejectedValueOnce(new AuthRetryableFetchError('Failed to fetch', 0));
    await expect(signUpWithEmail(form, {}, fake.client)).resolves.toEqual({
      ok: false,
      code: 'network',
    });
  });

  it('says not_configured without a client', async () => {
    await expect(signUpWithEmail(form, {}, null)).resolves.toEqual({
      ok: false,
      code: 'not_configured',
    });
  });
});

describe('signOut', () => {
  it('signs out of this device only, so it never waits on the network', async () => {
    await expect(signOut(fake.client)).resolves.toEqual({ ok: true, data: undefined });
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('reports a failure', async () => {
    fake.auth.signOut.mockResolvedValueOnce({
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    });
    await expect(signOut(fake.client)).resolves.toEqual({ ok: false, code: 'network' });
    fake.auth.signOut.mockRejectedValueOnce(new Error('storage'));
    await expect(signOut(fake.client)).resolves.toEqual({ ok: false, code: 'unknown' });
  });

  it('has nothing to do without a client', async () => {
    await expect(signOut(null)).resolves.toEqual({ ok: true, data: undefined });
  });
});

describe('clearProviderCredentials', () => {
  it('removes every music-service credential on this device', async () => {
    const store = { clearAll: jest.fn().mockResolvedValue(undefined) };
    await expect(clearProviderCredentials(store)).resolves.toBeUndefined();
    expect(store.clearAll).toHaveBeenCalledTimes(1);
    expect(entries).toEqual([]);
  });

  it('never throws, and logs a failure without its message', async () => {
    const store = {
      clearAll: jest
        .fn()
        .mockRejectedValue(new Error('Keychain refused token-abc for someone@example.com')),
    };
    await expect(clearProviderCredentials(store)).resolves.toBeUndefined();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'warn',
      message: 'Could not clear provider credentials',
    });
    expect(JSON.stringify(entries)).not.toContain('token-abc');
    expectNothingSensitiveLogged();
  });
});

describe('fetchSavedProfile', () => {
  it('returns the saved name and color when step 1 is finished', async () => {
    fake.setProfile({ ...completeProfile, display_name: ' Sam ' });
    await expect(fetchSavedProfile('user-1', fake.client)).resolves.toEqual({
      name: 'Sam',
      color: completeProfile.color,
    });
    expect(fake.from).toHaveBeenCalledWith('profiles');
    expect(fake.profileQuery.select).toHaveBeenCalledWith(
      'display_name, color, adult_confirmed_at',
    );
    expect(fake.profileQuery.eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it.each([
    ['no row', null],
    ['no name', { ...completeProfile, display_name: null }],
    ['a blank name', { ...completeProfile, display_name: '  ' }],
    ['no color', { ...completeProfile, color: null }],
    ['no 18+ confirmation', { ...completeProfile, adult_confirmed_at: null }],
  ])('is null with %s', async (_name, row) => {
    fake.setProfile(row);
    await expect(fetchSavedProfile('user-1', fake.client)).resolves.toBeNull();
  });

  it('is null, with a warning, when the read fails or throws', async () => {
    fake.setProfile(null, { code: '42P01' });
    await expect(fetchSavedProfile('user-1', fake.client)).resolves.toBeNull();
    expect(entries[0]).toMatchObject({
      level: 'warn',
      context: { supabaseErrorCode: '42P01' },
    });
    fake.profileQuery.maybeSingle.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(fetchSavedProfile('user-1', fake.client)).resolves.toBeNull();
    expectNothingSensitiveLogged();
  });

  it('is null without a client', async () => {
    await expect(fetchSavedProfile('user-1', null)).resolves.toBeNull();
  });
});

describe('onAuthChange', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('reports the stored session first, then each change, without tokens', async () => {
    fake.setStoredSession(fakeSession(fakeUser({ app_metadata: { provider: 'google' } })));
    const changes: AuthChange[] = [];
    const stop = onAuthChange((change) => changes.push(change), fake.client);
    await flush();
    await flush();
    fake.emit('SIGNED_OUT', null);
    await flush();
    expect(changes).toEqual([
      {
        event: 'INITIAL_SESSION',
        user: { id: 'user-1', email: 'someone@example.com', method: 'google', name: null },
      },
      { event: 'SIGNED_OUT', user: null },
    ]);
    expect(JSON.stringify(changes)).not.toContain('token');
    stop();
  });

  it('calls the listener after Supabase returns, never inside its callback', () => {
    const listener = jest.fn();
    onAuthChange(listener, fake.client);
    fake.emit('SIGNED_IN', fakeSession());
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops, including changes already queued', async () => {
    const listener = jest.fn();
    const stop = onAuthChange(listener, fake.client);
    fake.emit('SIGNED_IN', fakeSession());
    stop();
    await flush();
    await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(fake.listenerCount()).toBe(0);
  });

  it('does nothing without a client', () => {
    expect(() => onAuthChange(jest.fn(), null)()).not.toThrow();
  });
});

describe('signInMethodOf', () => {
  it.each([
    ['email', 'email'],
    ['google', 'google'],
    ['apple', 'apple'],
    [undefined, 'email'],
    ['github', 'email'],
  ])('%s → %s', (provider, method) => {
    expect(signInMethodOf({ app_metadata: { provider } })).toBe(method);
  });
});
