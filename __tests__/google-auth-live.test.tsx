import { AuthApiError } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import {
  createFakeSupabase,
  fakeSession,
  fakeUser,
  flushAuthEvents,
  type FakeSupabase,
} from '@/test/fakeSupabase';

// Sign in with Google (Forge card "Sign in with Google"), live auth mode.
// Supabase and the system sign-in sheet are faked; everything between the
// button and the route change is real.
jest.setTimeout(60_000);

let mockSupabase: FakeSupabase;
// A PKCE code works once, and the service remembers codes it exchanged.
let attempt = 0;

jest.mock('@/services/dataMode', () => ({
  ...jest.requireActual('@/services/dataMode'),
  authMode: 'live',
  isLiveAuth: true,
}));

jest.mock('@/services/supabase', () => ({
  ...jest.requireActual('@/services/supabase'),
  getSupabase: () => mockSupabase.client,
  startSessionAutoRefresh: () => () => {},
}));

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const openSheet = WebBrowser.openAuthSessionAsync as jest.Mock;

beforeEach(() => {
  mockSupabase = createFakeSupabase();
  const googleUser = fakeUser({
    id: 'google-user',
    app_metadata: { provider: 'google' },
    user_metadata: { full_name: 'Sam Lee' },
  });
  mockSupabase.auth.exchangeCodeForSession.mockImplementation(async () => {
    const session = fakeSession(googleUser);
    queueMicrotask(() => mockSupabase.emit('SIGNED_IN', session));
    return { data: { user: googleUser, session }, error: null } as never;
  });
  openSheet.mockReset();
  openSheet.mockImplementation(async (_url: string, redirect: string) => ({
    type: 'success',
    url: `${redirect}?code=google-code-${++attempt}`,
  }));
  for (const level of ['info', 'warn', 'debug'] as const) {
    jest.spyOn(console, level).mockImplementation(() => {});
  }
});

afterEach(() => jest.restoreAllMocks());

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

it('a new Google account starts onboarding with the name Google shared', async () => {
  await renderRouter('./app', { initialUrl: '/' });
  await flushAuthEvents();
  await press('Continue with Google');

  expect(await screen.findByText('What should we call you?')).toBeVisible();
  expect(screen.getByLabelText('Display name')).toHaveDisplayValue('Sam Lee');
  expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: { redirectTo: expect.stringMatching(/auth\/callback$/), skipBrowserRedirect: true },
  });
  expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledWith(`google-code-${attempt}`);
});

it('a returning Google account with a finished profile goes Home', async () => {
  mockSupabase.setProfile({
    display_name: 'Sam',
    color: '#ff8a5b',
    adult_confirmed_at: '2026-11-20T12:00:00Z',
  });
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await flushAuthEvents();
  await press('Continue with Google');
  expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
  expect(screen).toHavePathname('/home');
});

it('closing the sheet leaves you where you were, with no error', async () => {
  openSheet.mockResolvedValueOnce({ type: 'cancel' });
  await renderRouter('./app', { initialUrl: '/' });
  await flushAuthEvents();
  await press('Continue with Google');

  expect(await screen.findByLabelText('Continue with Google')).toBeEnabled();
  expect(screen).toHavePathname('/');
  expect(screen.queryByText(/cancelled|went wrong/)).toBeNull();
  expect(mockSupabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
});

it('says so while the sheet is open, and allows one sign-in at a time', async () => {
  let close: (value: unknown) => void = () => {};
  openSheet.mockImplementationOnce(() => new Promise((resolve) => (close = resolve)));
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await flushAuthEvents();
  await press('Continue with Google');

  expect(await screen.findByLabelText('Opening Google…')).toBeDisabled();
  expect(screen.getByLabelText('Sign in')).toBeDisabled();
  // Sign in with Apple can't run in Jest (no native module), so it's hidden;
  // __tests__/apple-auth-live.test.tsx covers it next to Google.
  expect(screen.queryByLabelText('Continue with Apple')).toBeNull();

  await act(async () => close({ type: 'dismiss' }));
  expect(await screen.findByLabelText('Continue with Google')).toBeEnabled();
});

it.each([
  [
    new AuthApiError('Provider is not enabled', 400, 'provider_disabled'),
    'Sign in with Google isn’t available yet. Use email instead.',
  ],
  [
    new AuthApiError('Too many', 429, 'over_request_rate_limit'),
    'Too many tries. Wait a minute, then try again.',
  ],
])('explains a failure to start: %p', async (error, message) => {
  mockSupabase.auth.signInWithOAuth.mockResolvedValueOnce({
    data: { provider: 'google', url: null },
    error,
  } as never);
  await renderRouter('./app', { initialUrl: '/' });
  await flushAuthEvents();
  await press('Continue with Google');
  expect(await screen.findByText(message)).toBeVisible();
  expect(openSheet).not.toHaveBeenCalled();
});

it('explains a link that can’t be used', async () => {
  mockSupabase.auth.exchangeCodeForSession.mockResolvedValueOnce({
    data: { user: null, session: null },
    error: new AuthApiError('Bad verifier', 400, 'bad_code_verifier'),
  } as never);
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await flushAuthEvents();
  await press('Continue with Google');
  expect(
    await screen.findByText(
      'That link didn’t work. It may have been used already or opened on another device. Sign in again.',
    ),
  ).toBeVisible();
  expect(screen).toHavePathname('/sign-in');
});

it('clears an earlier failure when the person tries again', async () => {
  mockSupabase.auth.signInWithOAuth.mockRejectedValueOnce(new TypeError('Network request failed'));
  await renderRouter('./app', { initialUrl: '/' });
  await flushAuthEvents();
  await press('Continue with Google');
  const network = 'Couldn’t reach q’d. Check your connection and try again.';
  expect(await screen.findByText(network)).toBeVisible();

  openSheet.mockResolvedValueOnce({ type: 'cancel' });
  await press('Continue with Google');
  expect(screen.queryByText(network)).toBeNull();
  expect(screen).toHavePathname('/');
});

it('never logs the code Google returned', async () => {
  const logged: unknown[] = [];
  for (const level of ['info', 'warn', 'debug', 'error'] as const) {
    jest.spyOn(console, level).mockImplementation((...args) => void logged.push(args));
  }
  mockSupabase.auth.exchangeCodeForSession.mockResolvedValueOnce({
    data: { user: null, session: null },
    error: new AuthApiError('Expired', 400, 'flow_state_expired'),
  } as never);
  await renderRouter('./app', { initialUrl: '/' });
  await flushAuthEvents();
  await press('Continue with Google');
  expect(
    await screen.findByText('That link has expired. Sign in again to get a new one.'),
  ).toBeVisible();
  expect(JSON.stringify(logged)).not.toContain(`google-code-${attempt}`);
  expect(JSON.stringify(logged)).toContain('link_expired');
});
