import { AuthApiError } from '@supabase/supabase-js';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { addLogSink, type LogEntry } from '@/services/logger';
import { fakeIdentityToken } from '@/test/fakeAppleAuth';
import {
  completeProfile,
  createFakeSupabase,
  fakeSession,
  fakeUser,
  flushAuthEvents,
  type FakeSupabase,
} from '@/test/fakeSupabase';

// Sign in with Apple (Forge card "Sign in with Apple"), live auth mode on
// iOS. Apple's sheet and button and Supabase are faked; everything between
// the button and the route change is real.
jest.setTimeout(60_000);

let mockSupabase: FakeSupabase;
const mockApple = {
  available: true,
  signInAsync: jest.fn(),
};

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

jest.mock('expo-crypto', () => {
  const crypto = jest.requireActual('crypto');
  return {
    getRandomBytes: (count: number) => new Uint8Array(crypto.randomBytes(count)),
    digestStringAsync: async (_algorithm: string, text: string) =>
      crypto.createHash('sha256').update(text).digest('hex'),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { HEX: 'hex', BASE64: 'base64' },
  };
});

jest.mock('expo-apple-authentication', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    isAvailableAsync: async () => mockApple.available,
    signInAsync: (options: unknown) => mockApple.signInAsync(options),
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    // Stands in for the native button; records the props it was given.
    AppleAuthenticationButton: (props: {
      onPress: () => void;
      buttonType: number;
      buttonStyle: number;
      cornerRadius: number;
    }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue with Apple"
        testID={`apple-native-button-type${props.buttonType}-style${props.buttonStyle}-r${props.cornerRadius}`}
        onPress={props.onPress}
      >
        <Text>Continue with Apple</Text>
      </Pressable>
    ),
  };
});

const appleUser = fakeUser({
  id: 'apple-user',
  email: 'relay@privaterelay.appleid.com',
  app_metadata: { provider: 'apple' },
});

let entries: LogEntry[];
let removeSink: () => void;

beforeEach(() => {
  mockSupabase = createFakeSupabase();
  mockApple.available = true;
  mockApple.signInAsync.mockReset();
  mockApple.signInAsync.mockImplementation(async ({ nonce }: { nonce: string }) => ({
    identityToken: fakeIdentityToken({ sub: 'apple-sub', nonce }),
    fullName: { givenName: 'Robin', familyName: 'Canary' },
  }));
  mockSupabase.auth.signInWithIdToken.mockImplementation(async () => {
    const session = fakeSession(appleUser);
    // supabase-js announces the session before the call returns.
    mockSupabase.emit('SIGNED_IN', session);
    return { data: { user: appleUser, session }, error: null } as never;
  });
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

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

it('shows Apple’s own Continue with Apple button, white, rounded like the other options', async () => {
  await renderRouter('./app', { initialUrl: '/' });
  await flushAuthEvents();
  expect(await screen.findByTestId('apple-native-button-type1-style0-r26')).toBeVisible();
});

it('a new Apple account starts onboarding with the name Apple shared', async () => {
  await renderRouter('./app', { initialUrl: '/' });
  await flushAuthEvents();
  await press('Continue with Apple');

  expect(await screen.findByText('What should we call you?')).toBeVisible();
  expect(screen.getByLabelText('Display name')).toHaveDisplayValue('Robin Canary');
  expect(mockSupabase.auth.signInWithIdToken).toHaveBeenCalledWith({
    provider: 'apple',
    token: expect.any(String),
    nonce: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({
    data: { full_name: 'Robin Canary' },
  });
  // Privacy: nothing about the person or the credential reaches the logs.
  const text = JSON.stringify(entries);
  for (const secret of ['Robin', 'Canary', 'privaterelay', 'apple-user', 'apple-sub']) {
    expect(text).not.toContain(secret);
  }
});

it('a returning Apple account with a finished profile goes Home from Sign in', async () => {
  mockSupabase.setProfile(completeProfile);
  mockApple.signInAsync.mockImplementation(async ({ nonce }: { nonce: string }) => ({
    identityToken: fakeIdentityToken({ nonce }),
    fullName: null,
  }));
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await flushAuthEvents();
  await press('Continue with Apple');
  expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
  expect(mockSupabase.auth.updateUser).not.toHaveBeenCalled();
});

it('cancelling the sheet is silent and leaves you where you were', async () => {
  mockApple.signInAsync.mockRejectedValueOnce(
    Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }),
  );
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await flushAuthEvents();
  await press('Continue with Apple');
  await waitFor(() => expect(screen.getByLabelText('Sign in')).toBeEnabled());
  expect(screen).toHavePathname('/sign-in');
  expect(screen.queryByText(/cancelled|went wrong|verify/)).toBeNull();
  expect(mockSupabase.auth.signInWithIdToken).not.toHaveBeenCalled();
});

it('a token that doesn’t answer this request is refused, with honest words', async () => {
  mockApple.signInAsync.mockResolvedValueOnce({
    identityToken: fakeIdentityToken({ nonce: 'someone-elses-nonce' }),
    fullName: null,
  });
  await renderRouter('./app', { initialUrl: '/' });
  await flushAuthEvents();
  await press('Continue with Apple');
  expect(
    await screen.findByText('We couldn’t verify that sign-in, so you’re not signed in. Try again.'),
  ).toBeVisible();
  expect(mockSupabase.auth.signInWithIdToken).not.toHaveBeenCalled();
  expect(screen).toHavePathname('/');
});

it.each([
  [
    new AuthApiError('Provider is not enabled', 400, 'provider_disabled'),
    'Sign in with Apple isn’t available yet. Use email instead.',
  ],
  [
    new AuthApiError('Nonces mismatch', 400, undefined),
    'We couldn’t verify that sign-in, so you’re not signed in. Try again.',
  ],
  [
    new AuthApiError('Too many', 429, 'over_request_rate_limit'),
    'Too many tries. Wait a minute, then try again.',
  ],
])('explains Supabase refusing the token: %p', async (error, message) => {
  mockSupabase.auth.signInWithIdToken.mockResolvedValueOnce({
    data: { user: null, session: null },
    error,
  } as never);
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await flushAuthEvents();
  await press('Continue with Apple');
  expect(await screen.findByText(message)).toBeVisible();
  expect(screen).toHavePathname('/sign-in');
});

it('one sign-in at a time: Apple’s sheet open disables the other options', async () => {
  let finish: (value: unknown) => void = () => {};
  mockApple.signInAsync.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await flushAuthEvents();
  await press('Continue with Apple');
  expect(await screen.findByLabelText('Continue with Google')).toBeDisabled();
  expect(screen.getByLabelText('Sign in')).toBeDisabled();
  await act(async () => finish(Promise.reject({ code: 'ERR_REQUEST_CANCELED' })));
  await waitFor(() => expect(screen.getByLabelText('Continue with Google')).toBeEnabled());
});

it('is hidden where Sign in with Apple isn’t available', async () => {
  mockApple.available = false;
  await renderRouter('./app', { initialUrl: '/' });
  await flushAuthEvents();
  expect(await screen.findByLabelText('Continue with Google')).toBeVisible();
  expect(screen.queryByLabelText('Continue with Apple')).toBeNull();
});
