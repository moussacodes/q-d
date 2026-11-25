import { router, useLocalSearchParams } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { useEffect } from 'react';

import { useMockSession } from '@/features/session/MockSession';

// Host reconnecting (Forge card "Handle a host who disappears and comes
// back"). PRODUCT_SPEC.md §4: everyone sees "Host reconnecting" for 30
// seconds; then the music pauses and the room and queue are kept; a returning
// host resumes once the room is up to date. Mock mode: the /dev toggle stands
// in for Realtime Presence.
jest.setTimeout(60_000);

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const pressText = async (text: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByText(text));
  });
};

/** Test-only route: you're now in the room `code`, then back. */
function EnterRoom() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { enterRoom } = useMockSession();
  useEffect(() => {
    enterRoom(code);
    router.back();
  }, [code, enterRoom]);
  return null;
}

const signIn = async () => {
  await renderRouter(
    { appDir: './app', overrides: { 'test-enter-room': EnterRoom } },
    { initialUrl: '/sign-in' },
  );
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
};

const openRoom = async (code: string, view?: string) => {
  await act(async () => {
    router.push({ pathname: '/room/[code]', params: view ? { code, view } : { code } });
  });
};

/** Uses the /dev toggle: the sample room host's phone leaves or returns. */
const hostPhone = async (action: 'leaves' | 'returns') => {
  await act(async () => {
    router.push('/dev');
  });
  await pressText(`Host’s phone ${action}`);
  await act(async () => {
    router.back();
  });
};

const reconnectingBody =
  /^Baron’s phone plays the music and lost the room\. If it isn’t back in \d+ s, the music pauses\. The queue is kept\.$/;

describe('listeners', () => {
  it('see "Host reconnecting" with the time left, and the queue is still there', async () => {
    await signIn();
    await openRoom('QD-7K4F9X', 'reconnecting');
    expect(await screen.findByText('Host reconnecting')).toBeVisible();
    expect(screen.getByText(reconnectingBody)).toBeVisible();
    expect(screen.getByText(/back in 30 s/)).toBeVisible();
    // Nothing is lost: the song and the queue are still shown.
    expect(screen.getByText('Have a Baby (With Me)')).toBeVisible();
    expect(screen.getByText('7 songs')).toBeVisible();
    // The music hasn't paused yet; it does at the end of the grace period.
    expect(screen.getByLabelText('Pause')).toBeDisabled();
    expect(screen.getByLabelText('Add a song')).toBeEnabled();
  });

  it('see "Paused" once the host has been away for 30 seconds, with the room kept', async () => {
    await signIn();
    await openRoom('QD-7K4F9X', 'host-away');
    expect(await screen.findByText('Paused')).toBeVisible();
    expect(
      screen.getByText(
        'Baron’s phone hasn’t come back, so the music is paused. The room and the queue are kept.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('Host reconnecting')).toBeNull();
    expect(await screen.findByLabelText('Play')).toBeDisabled();
    expect(screen.getByText('7 songs')).toBeVisible();
    expect(screen.getByText('Have a Baby (With Me)')).toBeVisible();
  });

  it('can still add songs while the host is away: adding goes to the room, not the phone', async () => {
    await signIn();
    await openRoom('QD-7K4F9X', 'host-away');
    await screen.findByText('Paused');
    expect(screen.getByLabelText('Add a song')).toBeEnabled();
  });
});

describe('the host', () => {
  it('sees their own phone reconnecting, with playback controls off and why', async () => {
    await signIn();
    await openRoom('QD-7K4F9X');
    expect(await screen.findByLabelText('Pause')).toBeEnabled();

    await hostPhone('leaves');
    expect(await screen.findByText('Reconnecting')).toBeVisible();
    expect(
      screen.getByText(
        /^Your phone lost the room\. If it isn’t back in \d+ s, the music pauses\. The queue is kept\.$/,
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Pause')).toBeDisabled();
    expect(screen.getByLabelText('Skip')).toBeDisabled();
    expect(
      screen.getByText('Playback controls come back when the host’s phone reconnects.'),
    ).toBeVisible();

    // Back within 30 seconds: nothing paused, everything works again.
    await hostPhone('returns');
    await waitFor(() => expect(screen.queryByText('Reconnecting')).toBeNull());
    expect(screen.getByLabelText('Pause')).toBeEnabled();
    expect(screen.getByLabelText('Skip')).toBeEnabled();
    expect(screen.queryByText('You’re back')).toBeNull();
    expect(screen.getByText('7 songs')).toBeVisible();
  });

  it('resumes the room after coming back from a pause', async () => {
    await signIn();
    await openRoom('QD-7K4F9X', 'host-back');
    expect(await screen.findByText('You’re back')).toBeVisible();
    expect(
      screen.getByText(
        'The music paused while your phone was away. The room and the queue are up to date, so resume when you’re ready.',
      ),
    ).toBeVisible();
    expect(await screen.findByLabelText('Play')).toBeEnabled();
    expect(screen.getByText('7 songs')).toBeVisible();

    await press('Resume the music');
    expect(await screen.findByLabelText('Pause')).toBeEnabled();
    expect(screen.queryByText('You’re back')).toBeNull();
  });

  it('can resume with the big Play button too', async () => {
    await signIn();
    await openRoom('QD-7K4F9X', 'host-back');
    await screen.findByText('You’re back');
    await press('Play');
    expect(await screen.findByLabelText('Pause')).toBeEnabled();
    expect(screen.queryByText('You’re back')).toBeNull();
  });
});

describe('the grace period', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('pauses the music 30 seconds after the host’s phone leaves, then the host resumes', async () => {
    await signIn();
    await openRoom('QD-7K4F9X');
    expect(await screen.findByLabelText('Pause')).toBeEnabled();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    await hostPhone('leaves');
    expect(await screen.findByText('Reconnecting')).toBeVisible();

    await act(async () => {
      jest.advanceTimersByTime(31_000);
    });
    expect(await screen.findByText('Paused · you’re offline')).toBeVisible();
    expect(screen.getByText('7 songs')).toBeVisible();
    await hostPhone('returns');
    expect(await screen.findByText('You’re back')).toBeVisible();
    await press('Resume the music');
    expect(await screen.findByLabelText('Pause')).toBeEnabled();
  });
});

describe('the mini player', () => {
  it('turns Pause off while the host’s phone is away', async () => {
    await signIn();
    await act(async () => {
      router.push({ pathname: '/test-enter-room', params: { code: 'QD-7K4F9X' } } as never);
    });
    await waitFor(() => expect(screen).toHavePathname('/home'));
    expect(await screen.findByLabelText('Pause')).toBeEnabled();

    await hostPhone('leaves');
    await waitFor(() => expect(screen.getByLabelText('Pause')).toBeDisabled());
    await hostPhone('returns');
    await waitFor(() => expect(screen.getByLabelText('Pause')).toBeEnabled());
  });
});
