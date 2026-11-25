import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import {
  completeProfile,
  createFakeSupabase,
  fakeSession,
  fakeUser,
  flushAuthEvents,
  type FakeSupabase,
} from '@/test/fakeSupabase';
import { providerCredentials } from '@/services/providerCredentials';

// Email/password sign-in and account creation through Supabase Auth (Forge
// card "Email/password sign-in and account creation"). Supabase is faked at
// the service boundary: the screens, hooks, auth service and AuthSync are
// the real ones.
jest.setTimeout(60_000);

let mockSupabase: FakeSupabase;

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

beforeEach(() => {
  mockSupabase = createFakeSupabase();
  // A sign-in event follows every successful sign-in, as in supabase-js.
  mockSupabase.auth.signInWithPassword.mockImplementation(async () => {
    const session = fakeSession();
    queueMicrotask(() => mockSupabase.emit('SIGNED_IN', session));
    return { data: { user: session.user, session }, error: null };
  });
  mockSupabase.auth.signUp.mockImplementation(async () => {
    const session = fakeSession(fakeUser({ id: 'user-new' }));
    queueMicrotask(() => mockSupabase.emit('SIGNED_IN', session));
    return { data: { user: session.user, session }, error: null };
  });
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const type = async (label: string, text: string) => {
  await act(async () => {
    fireEvent.changeText(await screen.findByLabelText(label), text);
  });
};

const fill = async (email = 'someone@example.com', password = 'correct-horse') => {
  await type('Email', email);
  await type('Password', password);
};

describe('signing in', () => {
  it('lands on Home with the saved profile when onboarding is done', async () => {
    mockSupabase.setProfile(completeProfile);
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await flushAuthEvents();
    expect(await screen.findByText('Mock data · only sign-in is live')).toBeVisible();
    await fill();
    await press('Sign in');

    expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
    expect(screen).toHavePathname('/home');
    expect(screen.getByText(/, Sam\./)).toBeVisible();
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'someone@example.com',
      password: 'correct-horse',
    });
  });

  it('goes to onboarding when the profile isn’t finished, with no sample name', async () => {
    mockSupabase.setProfile(null);
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await flushAuthEvents();
    await fill();
    await press('Sign in');

    expect(await screen.findByText('What should we call you?')).toBeVisible();
    expect(screen).toHavePathname('/onboarding/name');
    expect(screen.getByLabelText('Display name')).toHaveDisplayValue('');
  });

  it('shows the button as busy while it waits, and ignores more taps', async () => {
    let finish: (value: unknown) => void = () => {};
    mockSupabase.auth.signInWithPassword.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)) as never,
    );
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await flushAuthEvents();
    await fill();
    await press('Sign in');

    const busy = await screen.findByLabelText('Signing in…');
    expect(busy).toBeDisabled();
    expect(screen.getByLabelText('Continue with Google')).toBeDisabled();
    await act(async () => {
      fireEvent.press(busy);
    });
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({
        data: { user: null, session: null },
        error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
      });
    });
    expect(await screen.findByLabelText('Sign in')).toBeEnabled();
  });

  it.each([
    [
      new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
      'That email and password don’t match an account. Check both and try again.',
    ],
    [
      new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'),
      'Confirm your email first. Open the link we sent you, then sign in.',
    ],
    [
      new AuthApiError('Too many', 429, 'over_request_rate_limit'),
      'Too many tries. Wait a minute, then try again.',
    ],
    [
      new AuthRetryableFetchError('Failed to fetch', 0),
      'Couldn’t reach q’d. Check your connection and try again.',
    ],
    [new AuthApiError('Boom', 500, 'unexpected_failure'), 'Something went wrong. Try again.'],
  ])('stays on Sign in and explains %p', async (error, message) => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSupabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error,
    } as never);
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await flushAuthEvents();
    await fill();
    await press('Sign in');

    expect(await screen.findByText(message)).toBeVisible();
    expect(screen).toHavePathname('/sign-in');
    expect(screen.getByLabelText('Sign in')).toBeEnabled();

    // Editing the form clears the message.
    await type('Password', 'another-try');
    expect(screen.queryByText(message)).toBeNull();
  });

  it('checks the form before sending anything', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await flushAuthEvents();
    await type('Email', 'someone@');
    await press('Sign in');
    expect(await screen.findByText('Enter an email address like you@example.com.')).toBeVisible();
    expect(screen.getByText('Enter your password.')).toBeVisible();
    expect(mockSupabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe('creating an account', () => {
  it('starts onboarding once the account exists', async () => {
    await renderRouter('./app', { initialUrl: '/create-account' });
    await flushAuthEvents();
    await fill();
    await press('Create account');

    expect(await screen.findByText('What should we call you?')).toBeVisible();
    expect(screen.getByLabelText('Display name')).toHaveDisplayValue('');
    expect(mockSupabase.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'someone@example.com', password: 'correct-horse' }),
    );
  });

  it('asks the person to confirm their email when the project requires it', async () => {
    mockSupabase.auth.signUp.mockResolvedValueOnce({
      data: { user: fakeUser(), session: null },
      error: null,
    });
    await renderRouter('./app', { initialUrl: '/create-account' });
    await flushAuthEvents();
    await fill();
    await press('Create account');

    expect(
      await screen.findByText(
        'Check your email. Open the link we sent to finish creating your account, then sign in.',
      ),
    ).toBeVisible();
    expect(screen).toHavePathname('/create-account');
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('');
    expect(screen.getByLabelText('Create account')).toBeEnabled();
  });

  it.each([
    [
      { data: { user: fakeUser({ identities: [] }), session: null }, error: null },
      'There’s already an account with this email. Sign in instead.',
    ],
    [
      {
        data: { user: null, session: null },
        error: new AuthApiError('User already registered', 422, 'user_already_exists'),
      },
      'There’s already an account with this email. Sign in instead.',
    ],
    [
      {
        data: { user: null, session: null },
        error: new AuthApiError('Password is too weak', 422, 'weak_password'),
      },
      'Choose a stronger password: longer, and harder to guess.',
    ],
    [
      {
        data: { user: null, session: null },
        error: new AuthApiError('Signups not allowed', 422, 'signup_disabled'),
      },
      'New accounts can’t be created this way right now. Try again later.',
    ],
  ])('explains a refusal (%#)', async (reply, message) => {
    mockSupabase.auth.signUp.mockResolvedValueOnce(reply as never);
    await renderRouter('./app', { initialUrl: '/create-account' });
    await flushAuthEvents();
    await fill();
    await press('Create account');
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen).toHavePathname('/create-account');
  });

  it('needs a password of at least 8 characters', async () => {
    await renderRouter('./app', { initialUrl: '/create-account' });
    await flushAuthEvents();
    await fill('someone@example.com', 'short');
    await press('Create account');
    expect(await screen.findByText('Use at least 8 characters.')).toBeVisible();
    expect(mockSupabase.auth.signUp).not.toHaveBeenCalled();
  });
});

describe('Apple', () => {
  it('says it isn’t available yet instead of pretending to sign in', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await flushAuthEvents();
    await press('Continue with Apple');
    expect(
      await screen.findByText('Sign in with Apple isn’t available yet. Use email instead.'),
    ).toBeVisible();
    expect(screen).toHavePathname('/sign-in');
  });
});

describe('once signed in', () => {
  const signInToHome = async () => {
    mockSupabase.setProfile(completeProfile);
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await flushAuthEvents();
    await fill();
    await press('Sign in');
    await screen.findByText('Start a room or jump into one.');
  };

  it('Settings shows the account’s real email', async () => {
    await signInToHome();
    await press('Settings');
    await act(async () => {
      fireEvent.press(await screen.findByText('Account'));
    });
    expect(screen.getByLabelText('Email')).toHaveDisplayValue('someone@example.com');
  });

  it('signs out of this device from Settings', async () => {
    await signInToHome();
    await press('Settings');
    await act(async () => {
      fireEvent.press(await screen.findByText('Account'));
    });
    const clearAll = jest.spyOn(providerCredentials, 'clearAll');
    await press('Sign out');
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
    expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    // The next person to sign in on this phone never inherits music-service tokens.
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it('still signs out when the music-service tokens can’t be removed', async () => {
    await signInToHome();
    jest
      .spyOn(providerCredentials, 'clearAll')
      .mockRejectedValueOnce(new Error('Keychain unavailable'));
    await press('Settings');
    await act(async () => {
      fireEvent.press(await screen.findByText('Account'));
    });
    await press('Sign out');
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
    expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('returns to Welcome when Supabase ends the session', async () => {
    await signInToHome();
    const clearAll = jest.spyOn(providerCredentials, 'clearAll');
    await act(async () => {
      mockSupabase.emit('SIGNED_OUT', null);
    });
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
    expect(screen).toHavePathname('/');
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it('a token refresh changes nothing', async () => {
    await signInToHome();
    const profileReads = mockSupabase.profileQuery.maybeSingle.mock.calls.length;
    await act(async () => {
      mockSupabase.emit('TOKEN_REFRESHED', fakeSession());
    });
    await waitFor(() => expect(screen).toHavePathname('/home'));
    expect(mockSupabase.profileQuery.maybeSingle).toHaveBeenCalledTimes(profileReads);
  });
});
