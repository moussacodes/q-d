import { AuthApiError } from '@supabase/supabase-js';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import {
  completeProfile,
  createFakeSupabase,
  fakeSession,
  fakeUser,
  flushAuthEvents,
  type FakeSupabase,
} from '@/test/fakeSupabase';

// Auth callback and session restore (Forge card "Auth callback and session
// refresh"): sign-in survives redirects and app restarts. Live auth mode,
// with Supabase faked at the service boundary.
jest.setTimeout(60_000);

let mockSupabase: FakeSupabase;
// A PKCE code works once, and the service remembers codes it exchanged.
let attempt = 0;
const nextCode = () => `callback-code-${++attempt}`;

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

let warnings: jest.SpyInstance;

beforeEach(() => {
  mockSupabase = createFakeSupabase();
  mockSupabase.auth.exchangeCodeForSession.mockImplementation(async () => {
    const session = fakeSession();
    queueMicrotask(() => mockSupabase.emit('SIGNED_IN', session));
    return { data: { user: session.user, session }, error: null } as never;
  });
  warnings = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

describe('restarting the app', () => {
  it('restores a stored session straight to Home, with the saved profile', async () => {
    mockSupabase.setStoredSession(fakeSession());
    mockSupabase.setProfile(completeProfile);
    await renderRouter('./app', { initialUrl: '/' });
    await flushAuthEvents();

    expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
    expect(screen).toHavePathname('/home');
    expect(screen.getByText(/, Sam\./)).toBeVisible();
  });

  it('restores an account that hasn’t finished onboarding to onboarding', async () => {
    mockSupabase.setStoredSession(fakeSession());
    mockSupabase.setProfile(null);
    await renderRouter('./app', { initialUrl: '/home' });
    await flushAuthEvents();

    expect(await screen.findByText('What should we call you?')).toBeVisible();
    expect(screen).toHavePathname('/onboarding/name');
  });

  it('shows nothing, not Welcome, until the session is restored', async () => {
    let answer: (value: unknown) => void = () => {};
    mockSupabase.setStoredSession(fakeSession());
    mockSupabase.profileQuery.maybeSingle.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)) as never,
    );
    await renderRouter('./app', { initialUrl: '/' });
    await flushAuthEvents();
    await act(async () => {});
    const welcome = screen.queryByText('Different apps. One aux.');
    if (welcome) expect(welcome).not.toBeVisible();

    await act(async () => answer({ data: completeProfile, error: null }));
    expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
  });

  it('starts on Welcome with no stored session', async () => {
    await renderRouter('./app', { initialUrl: '/home' });
    await flushAuthEvents();
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
    expect(screen).toHavePathname('/');
  });

  it('goes to Welcome when the stored refresh token has expired', async () => {
    // supabase-js drops a session it can't refresh and reports SIGNED_OUT.
    mockSupabase.setStoredSession(null);
    await renderRouter('./app', { initialUrl: '/home' });
    await flushAuthEvents();
    await act(async () => {
      mockSupabase.emit('SIGNED_OUT', null);
    });
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
  });

  it('signs out when a refresh fails later, while the app is open', async () => {
    mockSupabase.setStoredSession(fakeSession());
    mockSupabase.setProfile(completeProfile);
    await renderRouter('./app', { initialUrl: '/' });
    await flushAuthEvents();
    await screen.findByText('Start a room or jump into one.');

    await act(async () => {
      mockSupabase.emit('SIGNED_OUT', null);
    });
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
    expect(screen).toHavePathname('/');
  });
});

describe('the callback link', () => {
  it('exchanges the code and starts onboarding for a new account', async () => {
    const code = nextCode();
    await renderRouter('./app', { initialUrl: `/auth/callback?code=${code}` });
    await flushAuthEvents();

    expect(await screen.findByText('What should we call you?')).toBeVisible();
    expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledWith(code);
    expect(JSON.stringify(warnings.mock.calls)).not.toContain(code);
  });

  it('lands a finished account on Home', async () => {
    mockSupabase.setProfile(completeProfile);
    await renderRouter('./app', { initialUrl: `/auth/callback?code=${nextCode()}` });
    await flushAuthEvents();
    expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
    expect(screen).toHavePathname('/home');
  });

  it('opened again once signed in, still ends up Home', async () => {
    mockSupabase.setStoredSession(fakeSession());
    mockSupabase.setProfile(completeProfile);
    await renderRouter('./app', { initialUrl: `/auth/callback?code=${nextCode()}` });
    await flushAuthEvents();
    expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
  });

  it('shows “Signing you in…” while it works', async () => {
    mockSupabase.auth.exchangeCodeForSession.mockImplementationOnce(
      () => new Promise(() => {}) as never,
    );
    await renderRouter('./app', { initialUrl: `/auth/callback?code=${nextCode()}` });
    await flushAuthEvents();
    expect(await screen.findByText('Signing you in…')).toBeVisible();
  });

  it.each([
    [
      '?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      'That link has expired. Sign in again to get a new one.',
    ],
    [
      '?error=invalid_request&error_code=flow_state_expired',
      'That link has expired. Sign in again to get a new one.',
    ],
    ['?error=access_denied', 'Sign-in was cancelled. You can try again.'],
    [
      '?error=invalid_request&error_code=bad_oauth_state',
      'That link didn’t work. It may have been used already or opened on another device. Sign in again.',
    ],
    [
      '',
      'That link didn’t work. It may have been used already or opened on another device. Sign in again.',
    ],
    [
      '?state=only',
      'That link didn’t work. It may have been used already or opened on another device. Sign in again.',
    ],
  ])('explains %p without exchanging anything', async (query, message) => {
    await renderRouter('./app', { initialUrl: `/auth/callback${query}` });
    await flushAuthEvents();
    expect(await screen.findByText('That didn’t work.')).toBeVisible();
    expect(screen.getByText(message)).toBeVisible();
    expect(mockSupabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it.each([
    [
      new AuthApiError('Not found', 404, 'flow_state_not_found'),
      'That link didn’t work. It may have been used already or opened on another device. Sign in again.',
    ],
    [
      new AuthApiError('Expired', 400, 'flow_state_expired'),
      'That link has expired. Sign in again to get a new one.',
    ],
  ])('explains a failed exchange: %p', async (error, message) => {
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { user: null, session: null },
      error,
    } as never);
    await renderRouter('./app', { initialUrl: `/auth/callback?code=${nextCode()}` });
    await flushAuthEvents();
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen).toHavePathname('/auth/callback');
  });

  it('offers a way back to Sign in', async () => {
    await renderRouter('./app', { initialUrl: '/auth/callback?error=access_denied' });
    await flushAuthEvents();
    await press('Back to sign in');
    expect(await screen.findByText('Welcome back.')).toBeVisible();
    expect(screen).toHavePathname('/sign-in');
  });

  it('sends a confirmation email that opens the callback', async () => {
    mockSupabase.auth.signUp.mockResolvedValueOnce({
      data: { user: fakeUser(), session: null },
      error: null,
    });
    await renderRouter('./app', { initialUrl: '/create-account' });
    await flushAuthEvents();
    await act(async () => {
      fireEvent.changeText(await screen.findByLabelText('Email'), 'someone@example.com');
    });
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Password'), 'correct-horse');
    });
    await press('Create account');
    expect(mockSupabase.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { emailRedirectTo: expect.stringMatching(/auth\/callback$/) },
      }),
    );
  });
});
