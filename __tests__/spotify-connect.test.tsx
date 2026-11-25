import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import type { ConnectionState } from '@/providers';

// Spotify connection (Forge card): a host connects before starting a room,
// and a Connect that doesn't work says why in plain words.
jest.setTimeout(60_000);

jest.mock('@/providers', () => {
  const actual = jest.requireActual('@/providers');
  return { ...actual, connectProvider: jest.fn(actual.connectProvider) };
});

const providers = jest.requireMock('@/providers') as {
  connectProvider: jest.Mock<Promise<ConnectionState>, [string]>;
};

const pressLabel = async (label: string, index = 0) => {
  await act(async () => {
    fireEvent.press((await screen.findAllByLabelText(label))[index]);
  });
};
const pressText = async (text: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByText(text));
  });
};

const startRoomScreen = async () => {
  await renderRouter('./app', { initialUrl: '/' });
  await pressLabel('Continue with Google');
  await pressLabel('I’m 18 or older');
  await pressLabel('Continue');
  await screen.findByText('Bring your own music.');
  await pressText('Skip');
  await pressText('Start a room');
  await screen.findByText('Connect a music service to host');
};

afterEach(() => providers.connectProvider.mockClear());

it.each([
  [
    { status: 'needs_subscription', isMock: false },
    'Spotify Premium is needed to play rooms through Spotify.',
  ],
  [
    { status: 'error', code: 'not_approved_user', isMock: false },
    'This Spotify account isn’t on q’d’s tester list yet. Spotify limits q’d to a few testers for now, so ask the team to add you.',
  ],
  [
    { status: 'needs_authorization', isMock: false },
    'Spotify isn’t connected yet. Tap Connect to try again.',
  ],
] as const)('a Connect that returns %j says why and keeps Start room off', async (state, copy) => {
  providers.connectProvider.mockResolvedValueOnce(state);
  await startRoomScreen();
  await pressLabel('Connect'); // Spotify, the first card
  expect(providers.connectProvider).toHaveBeenCalledWith('spotify');
  expect(await screen.findByText(copy)).toBeVisible();
  expect(screen.getByLabelText('Start room')).toBeDisabled();
  expect(screen.getByText('Connect a music service to host')).toBeVisible();
});

it('a failed Connect that then works clears the message and connects', async () => {
  providers.connectProvider.mockResolvedValueOnce({ status: 'needs_subscription', isMock: false });
  providers.connectProvider.mockResolvedValueOnce({ status: 'connected', isMock: false });
  await startRoomScreen();
  await pressLabel('Connect');
  await screen.findByText('Spotify Premium is needed to play rooms through Spotify.');
  await pressLabel('Connect');
  expect(await screen.findByText('Through Spotify')).toBeVisible();
  expect(screen.queryByText('Spotify Premium is needed to play rooms through Spotify.')).toBeNull();
});

it('a Connect that throws reports Spotify as unreachable instead of crashing', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  providers.connectProvider.mockRejectedValueOnce(new Error('boom'));
  await startRoomScreen();
  await pressLabel('Connect');
  expect(
    await screen.findByText('Couldn’t reach Spotify. Check your connection and try again.'),
  ).toBeVisible();
});

it('uses the labeled mock while the real Spotify flag is off', async () => {
  await startRoomScreen();
  await pressLabel('Connect');
  expect(await providers.connectProvider.mock.results[0].value).toEqual({
    status: 'connected',
    accountLabel: 'Mock account',
    isMock: true,
  });
});
