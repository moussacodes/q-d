import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import * as Linking from 'expo-linking';

import type { AuthErrorCode } from '@/domain/auth';
import { createFakeSupabase, type FakeSupabase } from '@/test/fakeSupabase';

import {
  authRedirectUrl,
  completeAuthRedirect,
  exchangeAuthCode,
  mapAuthError,
  onAuthChange,
  providerNameOf,
  resetCodeExchanges,
  signInWithGoogle,
} from './auth';
import { addLogSink, type LogEntry } from './logger';

jest.mock('expo-linking', () => ({ createURL: jest.fn((path: string) => `qd://${path}`) }));

// Google sign-in, the PKCE code exchange and redirect handling, with the
// Supabase client and the system sign-in sheet faked at the service boundary.

const apiError = (message: string, status: number, code?: string) =>
  new AuthApiError(message, status, code);

let fake: FakeSupabase;
let entries: LogEntry[];
let removeSink: () => void;

beforeEach(() => {
  fake = createFakeSupabase();
  resetCodeExchanges();
  entries = [];
  removeSink = addLogSink((entry) => entries.push(entry));
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, level).mockImplementation(() => {});
  }
});

afterEach(() => {
  removeSink();
  jest.restoreAllMocks();
});

describe('mapAuthError for redirects', () => {
  it.each<[string, unknown, AuthErrorCode]>([
    ['expired flow', apiError('Expired', 400, 'flow_state_expired'), 'link_expired'],
    ['expired email link', apiError('Expired', 403, 'otp_expired'), 'link_expired'],
    ['unknown flow', apiError('Not found', 404, 'flow_state_not_found'), 'link_invalid'],
    ['wrong verifier', apiError('Bad verifier', 400, 'bad_code_verifier'), 'link_invalid'],
    ['bad OAuth state', apiError('Bad state', 400, 'bad_oauth_state'), 'link_invalid'],
    ['bad OAuth callback', apiError('Bad callback', 400, 'bad_oauth_callback'), 'link_invalid'],
  ])('%s → %s', (_name, error, expected) => {
    expect(mapAuthError(error)).toBe(expected);
  });
});

describe('exchangeAuthCode', () => {
  it('swaps the code for a session once, even when the redirect arrives twice', async () => {
    const [first, second] = await Promise.all([
      exchangeAuthCode('code-1', fake.client),
      exchangeAuthCode('code-1', fake.client),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true, data: { id: 'user-1' } });
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('code-1');
  });

  it.each<[unknown, AuthErrorCode]>([
    [apiError('Expired', 400, 'flow_state_expired'), 'link_expired'],
    [apiError('Not found', 404, 'flow_state_not_found'), 'link_invalid'],
    [apiError('Bad verifier', 400, 'bad_code_verifier'), 'link_invalid'],
    [new AuthRetryableFetchError('Failed to fetch', 0), 'network'],
  ])('reports %p as %s, without the code in the logs', async (error, code) => {
    fake.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { user: null, session: null },
      error,
    } as never);
    await expect(exchangeAuthCode('secret-code-value', fake.client)).resolves.toEqual({
      ok: false,
      code,
    });
    expect(JSON.stringify(entries)).not.toContain('secret-code-value');
  });

  it('tries a failed code again, so a network failure isn’t final', async () => {
    fake.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    } as never);
    await expect(exchangeAuthCode('code-retry', fake.client)).resolves.toEqual({
      ok: false,
      code: 'network',
    });
    await expect(exchangeAuthCode('code-retry', fake.client)).resolves.toMatchObject({
      ok: true,
    });
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledTimes(2);
  });

  it('forgets a used code on sign-out, so reopening the link can’t fake a session', async () => {
    const stop = onAuthChange(() => {}, fake.client);
    await expect(exchangeAuthCode('code-used', fake.client)).resolves.toMatchObject({ ok: true });
    // Same session: the duplicate shares the first exchange.
    await exchangeAuthCode('code-used', fake.client);
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);

    fake.emit('SIGNED_OUT', null);
    fake.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: apiError('Not found', 404, 'flow_state_not_found'),
    } as never);
    await expect(exchangeAuthCode('code-used', fake.client)).resolves.toEqual({
      ok: false,
      code: 'link_invalid',
    });
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledTimes(2);
    stop();
  });

  it('turns a thrown error into an outcome, and needs a client', async () => {
    fake.auth.exchangeCodeForSession.mockRejectedValueOnce(new Error('boom'));
    await expect(exchangeAuthCode('code-2', fake.client)).resolves.toEqual({
      ok: false,
      code: 'unknown',
    });
    await expect(exchangeAuthCode('code-3', null)).resolves.toEqual({
      ok: false,
      code: 'not_configured',
    });
  });
});

describe('completeAuthRedirect', () => {
  it('exchanges a code from the query', async () => {
    await expect(
      completeAuthRedirect('qd://auth/callback?code=abc', fake.client),
    ).resolves.toMatchObject({ ok: true });
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
  });

  it.each<[string, AuthErrorCode]>([
    ['qd://auth/callback?error=access_denied&error_description=denied', 'cancelled'],
    ['qd://auth/callback#error=access_denied&error_code=otp_expired', 'link_expired'],
    ['qd://auth/callback?error=server_error&error_code=bad_oauth_state', 'link_invalid'],
    ['qd://auth/callback', 'link_invalid'],
  ])('%s → %s, without exchanging anything', async (url, code) => {
    await expect(completeAuthRedirect(url, fake.client)).resolves.toEqual({ ok: false, code });
    expect(fake.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe('signInWithGoogle', () => {
  const redirect = 'qd://auth/callback';
  const browser = (result: { type: string; url?: string }) => ({
    openAuthSessionAsync: jest.fn(async () => result),
  });

  it('opens Google in the sign-in sheet and exchanges the returned code', async () => {
    const sheet = browser({ type: 'success', url: `${redirect}?code=google-code` });
    const result = await signInWithGoogle(redirect, {
      client: fake.client,
      browser: sheet,
      platform: 'ios',
    });
    expect(fake.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: redirect, skipBrowserRedirect: true },
    });
    expect(sheet.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://abcd.supabase.co/auth/v1/authorize?provider=google',
      redirect,
    );
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('google-code');
    expect(result).toMatchObject({ ok: true, data: { id: 'user-1' } });
    expect(JSON.stringify(entries)).not.toContain('google-code');
  });

  it.each(['cancel', 'dismiss', 'locked'])(
    'is cancelled when the sheet ends with %s',
    async (type) => {
      const result = await signInWithGoogle(redirect, {
        client: fake.client,
        browser: browser({ type }),
        platform: 'ios',
      });
      expect(result).toEqual({ ok: false, code: 'cancelled' });
      expect(fake.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    },
  );

  it('is cancelled when the person says no on Google’s page', async () => {
    const result = await signInWithGoogle(redirect, {
      client: fake.client,
      browser: browser({ type: 'success', url: `${redirect}?error=access_denied` }),
      platform: 'ios',
    });
    expect(result).toEqual({ ok: false, code: 'cancelled' });
  });

  it('reports Google switched off on the project, without opening the sheet', async () => {
    fake.auth.signInWithOAuth.mockResolvedValueOnce({
      data: { provider: 'google', url: null },
      error: apiError('Provider is not enabled', 400, 'provider_disabled'),
    } as never);
    const sheet = browser({ type: 'success' });
    await expect(
      signInWithGoogle(redirect, { client: fake.client, browser: sheet, platform: 'ios' }),
    ).resolves.toEqual({ ok: false, code: 'method_unavailable' });
    expect(sheet.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('reports a sheet that fails to open', async () => {
    const sheet = { openAuthSessionAsync: jest.fn(() => Promise.reject(new Error('x'))) };
    await expect(
      signInWithGoogle(redirect, { client: fake.client, browser: sheet, platform: 'ios' }),
    ).resolves.toEqual({ ok: false, code: 'unknown' });
  });

  it('isn’t offered on the web or without Supabase', async () => {
    await expect(
      signInWithGoogle(redirect, {
        client: fake.client,
        browser: browser({ type: 'x' }),
        platform: 'web',
      }),
    ).resolves.toEqual({ ok: false, code: 'method_unavailable' });
    await expect(signInWithGoogle(redirect, { client: null, platform: 'ios' })).resolves.toEqual({
      ok: false,
      code: 'not_configured',
    });
    expect(fake.auth.signInWithOAuth).not.toHaveBeenCalled();
  });
});

describe('providerNameOf', () => {
  it('uses the name Google shared, and nothing for email accounts', () => {
    expect(providerNameOf({ user_metadata: { full_name: ' Sam Lee ' } })).toBe('Sam Lee');
    expect(providerNameOf({ user_metadata: { name: 'Sam' } })).toBe('Sam');
    expect(providerNameOf({ user_metadata: { full_name: '  ' } })).toBeNull();
    expect(providerNameOf({ user_metadata: {} })).toBeNull();
  });
});

describe('authRedirectUrl', () => {
  it('points at the /auth/callback route, in the app’s own scheme', () => {
    expect(authRedirectUrl()).toBe('qd://auth/callback');
    expect(Linking.createURL).toHaveBeenCalledWith('auth/callback');
  });
});
