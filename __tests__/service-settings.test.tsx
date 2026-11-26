import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { MockPlaybackAdapter } from '@/providers/mock/playback';
import { fillEmailForm } from '@/test/emailForm';

// Music-service settings: connect, change, disconnect (Forge card). Only
// Apple Music and Spotify appear, a service stays optional for guests, a
// connect only counts once it worked, and disconnecting the service your live
// room plays through says what it does before it does it.
jest.setTimeout(60_000);

afterEach(() => {
  jest.restoreAllMocks();
});

const press = async (label: string | RegExp, index = 0) => {
  await act(async () => {
    fireEvent.press((await screen.findAllByLabelText(label))[index]);
  });
};

const pressText = async (text: string | RegExp) => {
  await act(async () => {
    fireEvent.press(await screen.findByText(text));
  });
};

const go = async (href: Parameters<typeof router.push>[0]) => {
  await act(async () => {
    router.push(href);
  });
};

/** A returning user (Spotify connected, mock) on Home. */
const signIn = async () => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await fillEmailForm();
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
};

/** Starts hosting "Sunday Slow Burn" through Spotify, then opens Settings. */
const hostThenOpenSettings = async () => {
  await signIn();
  await pressText('Start a room');
  await press('Start room');
  expect(screen).toHavePathname('/room/QD-7K4F9X');
  await go('/settings');
  await screen.findByText('Settings');
};

const confirmCopy =
  'Sunday Slow Burn plays through Spotify on this phone. Disconnecting pauses the music for everyone in the room. The room and its queue stay, and you can reconnect any time.';

/** A connect that waits until the test lets it finish. */
function holdConnect() {
  let finish: (connected: boolean) => void = () => {};
  jest.spyOn(MockPlaybackAdapter.prototype, 'connect').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = (connected) =>
          resolve({
            ...(connected
              ? { status: 'connected' as const }
              : { status: 'error' as const, code: 'auth_failed' as const }),
            isMock: true,
          });
      }),
  );
  return (connected: boolean) => act(async () => finish(connected));
}

describe('connecting', () => {
  it('says it’s connecting, and a second tap can’t start another connect', async () => {
    const finish = holdConnect();
    await signIn();
    await go('/settings');
    await press('Connect'); // Apple Music; Spotify is already connected
    expect(await screen.findByText('Connecting Apple Music…')).toBeVisible();
    expect(screen.getByLabelText('Connect')).toBeDisabled();
    expect(screen.queryByText('Mock connection · no Apple Music account used')).toBeNull();
    expect(MockPlaybackAdapter.prototype.connect).toHaveBeenCalledTimes(1);

    await finish(true);
    expect(await screen.findByText('Mock connection · no Apple Music account used')).toBeVisible();
    expect(screen.getByLabelText('Disconnect Apple Music')).toBeVisible();
  });

  it('never shows a failed connect as connected, and can try again', async () => {
    const finish = holdConnect();
    await signIn();
    await go('/settings');
    await press('Connect');
    await finish(false);
    expect(await screen.findByText('Couldn’t connect Apple Music. Try again.')).toBeVisible();
    expect(screen.queryByLabelText('Disconnect Apple Music')).toBeNull();
    expect(screen.getByLabelText('Connect')).toBeEnabled();
    // Only Spotify is connected, so there's still nothing to switch to.
    expect(screen.getByLabelText('Play rooms through Spotify')).toBeDisabled();

    jest.restoreAllMocks();
    await press('Connect');
    expect(await screen.findByText('Mock connection · no Apple Music account used')).toBeVisible();
    expect(screen.queryByText(/Couldn’t connect/)).toBeNull();
  });

  it('starts one connect for two taps in the same frame', async () => {
    const finish = holdConnect();
    await signIn();
    await go('/settings');
    const connectButton = (await screen.findAllByLabelText('Connect'))[0];
    await act(async () => {
      fireEvent.press(connectButton);
      fireEvent.press(connectButton);
    });
    expect(MockPlaybackAdapter.prototype.connect).toHaveBeenCalledTimes(1);
    await finish(true);
    expect(await screen.findByText('Mock connection · no Apple Music account used')).toBeVisible();
  });

  it('drops a connect that finishes after its account signed out', async () => {
    const finish = holdConnect();
    await signIn();
    await go('/settings');
    await press('Connect'); // Apple Music, for this account
    await go({ pathname: '/settings', params: { tab: 'account' } });
    await press('Sign out');
    await screen.findByText('Different apps. One aux.');
    await go('/sign-in');
    await fillEmailForm();
    await press('Sign in');
    await screen.findByText('Start a room or jump into one.');

    await finish(true);
    await go('/settings');
    await screen.findByText('Settings');
    // The new account has only its own Spotify; the old connect counts for nobody.
    expect(screen.queryByText('Mock connection · no Apple Music account used')).toBeNull();
    expect(screen.queryByText('Connecting Apple Music…')).toBeNull();
    expect(screen.getByText('Subscription needed for full tracks')).toBeVisible();
  });

  it('treats an adapter error as a failed connect', async () => {
    jest
      .spyOn(MockPlaybackAdapter.prototype, 'connect')
      .mockRejectedValue(new Error('needs_authorization'));
    await signIn();
    await go('/settings');
    await press('Connect');
    // A throw reads as an unreachable service (Spotify connection card's copy).
    expect(
      await screen.findByText('Couldn’t reach Apple Music. Check your connection and try again.'),
    ).toBeVisible();
    expect(screen.queryByText('needs_authorization')).toBeNull();
  });
});

describe('guests', () => {
  it('can leave both services unconnected; Settings says joining works without one', async () => {
    await renderRouter('./app', { initialUrl: '/' });
    await press('Continue with Google');
    await press('I’m 18 or older');
    await press('Continue');
    await pressText('Skip');
    await pressText('I’ll do this later');
    await go('/settings');
    expect(
      await screen.findByText(
        'Connect a service to host rooms from this phone. Joining a friend’s room works without one.',
      ),
    ).toBeVisible();
    expect(screen.getAllByLabelText('Connect')).toHaveLength(2);
    expect(screen.queryByText('Play rooms through')).toBeNull();
    expect(screen.queryByText(/YouTube|TIDAL|Amazon|Deezer/i)).toBeNull();
  });

  it('disconnect at once in a room they only joined, which doesn’t depend on them', async () => {
    await signIn();
    // Joining happens on Home's code field (join-on-Home stack).
    await act(async () => {
      fireEvent.changeText(await screen.findByLabelText('Room code'), '9M2XR4');
    });
    await press('Join');
    expect(screen).toHavePathname('/room/QD-9M2XR4');
    await go('/settings');
    await press('Disconnect Spotify');
    expect(await screen.findByText('Premium needed to play rooms')).toBeVisible();
    expect(screen.queryByText('Disconnect Spotify?')).toBeNull();
    expect(screen.queryByText(/keeps playing through/)).toBeNull();
  });
});

describe('while hosting a live room', () => {
  it('says the room keeps its service when you change where rooms play', async () => {
    await hostThenOpenSettings();
    expect(
      screen.getByText(
        'Sunday Slow Burn keeps playing through Spotify. This choice is for rooms you start next.',
      ),
    ).toBeVisible();
    await press('Connect');
    await press('Play rooms through Spotify');
    expect(screen.getByLabelText('Play rooms through Apple Music')).toBeVisible();
    expect(screen.getByText(/Sunday Slow Burn keeps playing through Spotify\./)).toBeVisible();
  });

  it('asks before disconnecting the room’s service, and Keep connected changes nothing', async () => {
    await hostThenOpenSettings();
    await press('Disconnect Spotify');
    expect(await screen.findByText('Disconnect Spotify?')).toBeVisible();
    expect(screen.getByText(confirmCopy)).toBeVisible();
    expect(screen.getByText('Mock connection · no Spotify account used')).toBeVisible();

    await pressText('Keep connected');
    expect(screen.queryByText('Disconnect Spotify?')).toBeNull();
    expect(screen.getByText('Mock connection · no Spotify account used')).toBeVisible();
    expect(screen.getByLabelText('Pause')).toBeEnabled();
  });

  it('disconnects the other service without asking', async () => {
    await hostThenOpenSettings();
    await press('Connect');
    await press('Disconnect Apple Music');
    expect(await screen.findByText('Subscription needed for full tracks')).toBeVisible();
    expect(screen.queryByText(/^Disconnect .*\?$/)).toBeNull();
  });

  it('pauses the room once confirmed, and says so honestly in the room', async () => {
    await hostThenOpenSettings();
    await press('Disconnect Spotify');
    await press('Disconnect Spotify and pause Sunday Slow Burn');
    expect(await screen.findByText('Premium needed to play rooms')).toBeVisible();
    expect(screen.queryByText('Disconnect Spotify?')).toBeNull();
    // The mini player can't resume a room this phone can't play.
    expect(screen.getByLabelText('Play')).toBeDisabled();

    await press('Back');
    expect(await screen.findByText('Spotify isn’t connected')).toBeVisible();
    expect(
      screen.getByText(
        'This room plays through Spotify on your phone, so the music is paused. The room and its queue are still here.',
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Play')).toBeDisabled();
    expect(screen.getByText('Have a Baby (With Me)')).toBeVisible();
    expect(screen.getByText('7 songs')).toBeVisible();
  });

  it('reconnects from the room; the music waits for the host to press Play', async () => {
    await hostThenOpenSettings();
    await press('Disconnect Spotify');
    await press('Disconnect Spotify and pause Sunday Slow Burn');
    await press('Back');
    await press('Reconnect Spotify');
    expect(screen.queryByText('Spotify isn’t connected')).toBeNull();
    expect(screen.getByLabelText('Play')).toBeEnabled();

    await press('Play');
    expect(screen.getByLabelText('Pause')).toBeEnabled();
  });

  it('a skip during the hold doesn’t start the next song, even after reconnecting', async () => {
    await hostThenOpenSettings();
    await press('Disconnect Spotify');
    await press('Disconnect Spotify and pause Sunday Slow Burn');
    await press('Back');
    await screen.findByText('Spotify isn’t connected');
    await press('Skip');
    expect(await screen.findByText('Lovers Rock')).toBeVisible();
    expect(screen.getByLabelText('Play')).toBeDisabled();

    await press('Reconnect Spotify');
    expect(screen.queryByText('Spotify isn’t connected')).toBeNull();
    // Reconnecting never resumes by itself: Play, not Pause, until the host presses it.
    expect(screen.getByLabelText('Play')).toBeEnabled();
    expect(screen.queryByLabelText('Pause')).toBeNull();
    await press('Play');
    expect(screen.getByLabelText('Pause')).toBeEnabled();
  });

  it('disables Reconnect while it runs, so it can’t be tapped twice', async () => {
    await hostThenOpenSettings();
    await press('Disconnect Spotify');
    await press('Disconnect Spotify and pause Sunday Slow Burn');
    await press('Back');
    const finish = holdConnect();
    await press('Reconnect Spotify');
    expect(screen.getByLabelText('Reconnect Spotify')).toBeDisabled();
    await finish(true);
    expect(screen.queryByText('Spotify isn’t connected')).toBeNull();
    expect(MockPlaybackAdapter.prototype.connect).toHaveBeenCalledTimes(1);
  });

  it('keeps the notice when reconnecting fails', async () => {
    await hostThenOpenSettings();
    await press('Disconnect Spotify');
    await press('Disconnect Spotify and pause Sunday Slow Burn');
    await press('Back');
    jest
      .spyOn(MockPlaybackAdapter.prototype, 'connect')
      .mockResolvedValue({ status: 'error', code: 'auth_failed', isMock: true });
    await press('Reconnect Spotify');
    expect(await screen.findByText('Couldn’t connect Spotify. Try again.')).toBeVisible();
    expect(screen.getByText('Spotify isn’t connected')).toBeVisible();
    expect(screen.getByLabelText('Play')).toBeDisabled();
  });

  it('shows listeners the music paused, without the host’s notice', async () => {
    await hostThenOpenSettings();
    await press('Disconnect Spotify');
    await press('Disconnect Spotify and pause Sunday Slow Burn');
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'listener' } });
    expect(await screen.findByText('Have a Baby (With Me)')).toBeVisible();
    expect(screen.queryByText('Spotify isn’t connected')).toBeNull();
    expect(screen.queryByLabelText('Reconnect Spotify')).toBeNull();
    expect(screen.getByLabelText('Play')).toBeDisabled();
  });
});
