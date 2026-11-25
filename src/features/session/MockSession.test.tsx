import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { MockSessionProvider, RESTORE_TIMEOUT_MS, useMockSession } from './MockSession';

// Startup in live auth mode: the splash waits for the stored session, but
// never forever. Routing is mocked; the session's own state is what's tested.

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('@/services/auth', () => ({
  clearProviderCredentials: jest.fn(async () => {}),
  signOut: jest.fn(async () => ({ ok: true, data: undefined })),
}));

const { router } = jest.requireMock('expo-router') as {
  router: { replace: jest.Mock; push: jest.Mock };
};

function Probe() {
  const session = useMockSession();
  return (
    <>
      <Text>{`${session.auth}:${session.restoring ? 'restoring' : 'ready'}`}</Text>
      <Pressable
        accessibilityLabel="Restore signed in"
        onPress={() =>
          session.applyAuth({
            status: 'ready',
            userId: 'user-1',
            email: 'someone@example.com',
            method: 'email',
            profile: { name: 'Sam', color: '#ff8a5b' },
          })
        }
      />
      <Pressable accessibilityLabel="Restore signed out" onPress={() => session.applyAuth(null)} />
    </>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  router.replace.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('waits about ten seconds at most', () => {
  expect(RESTORE_TIMEOUT_MS).toBe(10_000);
});

it('stops waiting after the limit and shows Welcome', async () => {
  await render(
    <MockSessionProvider liveAuth restoreTimeoutMs={500}>
      <Probe />
    </MockSessionProvider>,
  );
  expect(screen.getByText('signedOut:restoring')).toBeTruthy();
  await act(async () => jest.advanceTimersByTime(499));
  expect(screen.getByText('signedOut:restoring')).toBeTruthy();
  await act(async () => jest.advanceTimersByTime(1));
  expect(screen.getByText('signedOut:ready')).toBeTruthy();
  expect(console.warn).toHaveBeenCalledWith(
    '[session] Session restore timed out',
    expect.objectContaining({ afterMs: 500 }),
  );
});

it('moves a session that turns up late on to Home', async () => {
  await render(
    <MockSessionProvider liveAuth restoreTimeoutMs={500}>
      <Probe />
    </MockSessionProvider>,
  );
  await act(async () => jest.advanceTimersByTime(500));
  await act(async () => fireEvent.press(screen.getByLabelText('Restore signed in')));
  expect(screen.getByText('ready:ready')).toBeTruthy();
  expect(router.replace).toHaveBeenCalledWith('/home');
});

it('doesn’t time out once the session is restored', async () => {
  await render(
    <MockSessionProvider liveAuth restoreTimeoutMs={500}>
      <Probe />
    </MockSessionProvider>,
  );
  await act(async () => fireEvent.press(screen.getByLabelText('Restore signed out')));
  expect(screen.getByText('signedOut:ready')).toBeTruthy();
  await act(async () => jest.advanceTimersByTime(1_000));
  expect(console.warn).not.toHaveBeenCalled();
  // Restoring needs no navigation: the route guards pick the first screen.
  expect(router.replace).not.toHaveBeenCalled();
});

it('never waits in mock auth mode', async () => {
  await render(
    <MockSessionProvider liveAuth={false} restoreTimeoutMs={500}>
      <Probe />
    </MockSessionProvider>,
  );
  expect(screen.getByText('signedOut:ready')).toBeTruthy();
});
