import { router, useLocalSearchParams } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { useEffect } from 'react';

import { useMockSession } from '@/features/session/MockSession';

// Home: idle and live states (Forge card "Home screen: idle and live states").
// 2.1 idle: nothing playing, so no mini player and no Live room.
// 2.2 live: you're in a room, so its row says Live and, while a song plays,
// the mini player sits at the foot of the screen.
jest.setTimeout(60_000);

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const pressText = async (text: string | RegExp) => {
  await act(async () => {
    fireEvent.press(await screen.findByText(text));
  });
};

/**
 * Test-only route: you're now in the room `code`, the way joining it would
 * leave you, then back to Home. Joining itself is covered elsewhere and is
 * moving from its own screen onto Home.
 */
function EnterRoom() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { enterRoom } = useMockSession();
  useEffect(() => {
    enterRoom(code);
    router.back();
  }, [code, enterRoom]);
  return null;
}

/** A returning user on Home. */
const signIn = async () => {
  await renderRouter(
    { appDir: './app', overrides: { 'test-enter-room': EnterRoom } },
    { initialUrl: '/sign-in' },
  );
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
};

const joinRoom = async (code: string) => {
  await act(async () => {
    router.push({ pathname: '/test-enter-room', params: { code } } as never);
  });
  await waitFor(() => expect(screen).toHavePathname('/home'));
};

const miniPlayer = () => screen.queryByLabelText(/^Open room\. Now playing /);

describe('idle (2.1)', () => {
  it('greets you by name, with no mini player and no live room', async () => {
    await signIn();
    expect(screen.getByText(/^(Morning|Afternoon|Evening), Baron\.$/)).toBeVisible();
    expect(miniPlayer()).toBeNull();
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByText(/listening now/)).toBeNull();
  });

  it('lists recent rooms with their host, size and when they were last active', async () => {
    await signIn();
    expect(screen.getByText('Recent rooms')).toBeVisible();
    expect(screen.getByText('You host · 6 people · Today')).toBeVisible();
    expect(screen.getByText('Hosted by Jules · 6 people · Friday')).toBeVisible();
    expect(screen.getByText('Hosted by Priya · 3 people · Last week')).toBeVisible();
    expect(screen.getByText('Hosted by Theo · 4 people · Oct 12')).toBeVisible();
  });

  it('opens Start a room, Settings, your account and a recent room', async () => {
    await signIn();
    await pressText('Start a room');
    expect(screen).toHavePathname('/create-room');
    await press('Back');

    await press('Settings');
    expect(screen).toHavePathname('/settings');
    expect(await screen.findByText(/Connect a service to host rooms/)).toBeVisible();
    await press('Back');

    await press('Account');
    expect(await screen.findByText('Signed in with')).toBeVisible();
    await press('Back');

    await pressText('Kitchen Disco');
    expect(screen).toHavePathname('/room/QD-9M2XR4');
  });

  it('only takes letters and digits in the code field, six at most', async () => {
    await signIn();
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Room code'), 'qd-7k4f9x-extra');
    });
    expect(screen.getByLabelText('Room code')).toHaveDisplayValue('QD7K4F');
  });
});

describe('live (2.2)', () => {
  it('shows the mini player and a Live row for the room you host', async () => {
    await signIn();
    await joinRoom('QD-7K4F9X');

    const player = await screen.findByLabelText('Open room. Now playing Have a Baby (With Me)');
    expect(player).toBeVisible();
    expect(screen.getByText('Daniel Caesar · Sunday Slow Burn')).toBeVisible();
    expect(screen.getByText('Live')).toBeVisible();
    expect(screen.getByText('You host · 6 listening now')).toBeVisible();
    // Only the room you're in is live.
    expect(screen.getAllByText('Live')).toHaveLength(1);
    expect(screen.getByText('Hosted by Jules · 6 people · Friday')).toBeVisible();
  });

  it('pauses and plays from the mini player, and the room agrees', async () => {
    await signIn();
    await joinRoom('QD-7K4F9X');
    await press('Pause');
    expect(await screen.findByLabelText('Play')).toBeEnabled();

    await press('Open room. Now playing Have a Baby (With Me)');
    expect(screen).toHavePathname('/room/QD-7K4F9X');
    // The room's big Play button: the song is still paused there.
    expect(await screen.findAllByLabelText('Play')).not.toHaveLength(0);
    expect(screen.queryByLabelText('Pause')).toBeNull();
  });

  it('disables Pause for a listener the room’s rules leave out', async () => {
    await signIn();
    await joinRoom('QD-9M2XR4'); // Kitchen Disco: only Jules, the host, controls the music.
    expect(await screen.findByLabelText(/^Open room\. Now playing /)).toBeVisible();
    expect(screen.getByLabelText('Pause')).toBeDisabled();
    expect(screen.getByText('Hosted by Jules · 6 listening now')).toBeVisible();
  });

  it('keeps the Live row but no mini player while the room has nothing playing', async () => {
    await signIn();
    await joinRoom('QD-3HV8PL'); // Late Drive Home: nothing queued yet.
    expect(await screen.findByText('Hosted by Priya · 3 listening now')).toBeVisible();
    expect(screen.getByText('Live')).toBeVisible();
    expect(miniPlayer()).toBeNull();
  });

  it('shows the room you started under the name you gave it', async () => {
    await signIn();
    await pressText('Start a room');
    await act(async () => {
      fireEvent.changeText(await screen.findByLabelText('Room name'), 'Friday Fade');
    });
    await press('Start room');
    expect(await screen.findByText('Friday Fade')).toBeVisible();
    await act(async () => {
      router.back();
    });

    expect(await screen.findByText('You host · 6 listening now')).toBeVisible();
    expect(screen.getByText('Friday Fade')).toBeVisible();
    expect(screen.queryByText('Sunday Slow Burn')).toBeNull();
    expect(screen.getByText('Daniel Caesar · Friday Fade')).toBeVisible();
  });

  it('goes back to idle after signing out and in again', async () => {
    await signIn();
    await joinRoom('QD-7K4F9X');
    await screen.findByText('Live');

    await press('Account');
    await press('Sign out');
    await screen.findByText('Different apps. One aux.');
    await act(async () => {
      router.push('/sign-in');
    });
    await press('Sign in');
    await screen.findByText('Start a room or jump into one.');
    expect(miniPlayer()).toBeNull();
    expect(screen.queryByText('Live')).toBeNull();
  });
});
