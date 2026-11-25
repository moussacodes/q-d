import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// Provider switching between tracks (Forge card). When the song that's up
// isn't on the room's service but is on another one the host connected, the
// host is asked. q’d never switches on its own, and a switch only happens
// between songs. Listeners are told what happened.
jest.setTimeout(60_000);

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
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
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
};

/** Connects Apple Music in Settings, then comes back. */
const connectAppleMusic = async () => {
  await go('/settings');
  await act(async () => {
    fireEvent.press(await screen.findByText('Connect'));
  });
  expect(await screen.findByText('Mock connection · no Apple Music account used')).toBeVisible();
  await press('Back');
};

/** Skips past Have a Baby, Lovers Rock and Always, so "Phantom" (not on Spotify) is up. */
const skipToPhantom = async () => {
  await screen.findByText('7 songs');
  for (let i = 0; i < 3; i += 1) await press('Skip');
  expect(await screen.findByText('Not on Spotify')).toBeVisible();
};

const timeline = /^\d+:\d{2} of \d+:\d{2}$/;

describe('the host', () => {
  it('holds a song that isn’t on the room’s service instead of playing it', async () => {
    await signIn();
    await connectAppleMusic();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'unavailable' } });
    expect(await screen.findByText('Not on Spotify')).toBeVisible();
    expect(screen.getByText('Phantom')).toBeVisible();
    expect(screen.getByLabelText('0:00 of 1:49')).toBeVisible();
    expect(screen.getByLabelText('Play')).toBeDisabled();
    // Nothing switches by itself.
    expect(screen.getAllByText('Spotify').length).toBeGreaterThan(0);
    expect(screen.queryByText(/switched/)).toBeNull();
  });

  it('switches when asked, and the song plays from its start through the new service', async () => {
    await signIn();
    await connectAppleMusic();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'unavailable' } });
    await press('Switch to Apple Music');

    expect(screen.queryByText('Not on Spotify')).toBeNull();
    expect(screen.getByText('Phantom')).toBeVisible();
    expect(
      screen.getByText(
        'You switched from Spotify to Apple Music between songs. The room plays through Apple Music now.',
      ),
    ).toBeVisible();
    expect(screen.getAllByText('Apple Music').length).toBeGreaterThan(0);
    expect(await screen.findByLabelText('Pause')).toBeEnabled();
    expect(screen.getByLabelText(timeline).props.accessibilityLabel).toMatch(/^0:0\d of 1:49$/);
  });

  it('can still skip instead of switching', async () => {
    await signIn();
    await connectAppleMusic();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'unavailable' } });
    await press('Skip this song');
    expect(screen.queryByText('Phantom')).toBeNull();
    expect(screen.queryByText(/switched/)).toBeNull();
    expect(screen.queryByLabelText('Switch to Apple Music')).toBeNull();
  });

  it('sees in the queue that a coming song can be switched', async () => {
    await signIn();
    await connectAppleMusic();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X' } });
    expect(
      await screen.findByText('Not on Spotify · you can switch to Apple Music when it comes up'),
    ).toBeVisible();
    expect(screen.queryByText('Not on Spotify · the host can skip it')).toBeNull();
  });

  it('keeps the new service for the next room’s Settings note, and the next songs', async () => {
    await signIn();
    await act(async () => {
      fireEvent.press(await screen.findByText('Start a room'));
    });
    await press('Start room');
    await connectAppleMusic();
    await skipToPhantom();
    await press('Switch to Apple Music');
    await press('Skip');
    // "175 Months" is on both services and plays through Apple Music now.
    expect(await screen.findByText('175 Months')).toBeVisible();
    expect(screen.queryByText(/switched/)).toBeNull();
    expect(screen.queryByText(/^Not on /)).toBeNull();

    await go('/settings');
    expect(
      await screen.findByText(
        'Sunday Slow Burn keeps playing through Apple Music. This choice is for rooms you start next.',
      ),
    ).toBeVisible();
  });
});

describe('listeners', () => {
  it('see the plain note in the queue and no switch button', async () => {
    await signIn();
    await connectAppleMusic();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'listener' } });
    expect(await screen.findByText('Not on Spotify · the host can skip it')).toBeVisible();
  });

  it('are told when the host switched', async () => {
    await signIn();
    await connectAppleMusic();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X' } });
    await skipToPhantom();
    await press('Switch to Apple Music');

    // The listener preview shares the real room.
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'listener' } });
    expect(
      await screen.findByText('The host switched from Spotify to Apple Music between songs.'),
    ).toBeVisible();
    expect(screen.queryByText('Not on Spotify')).toBeNull();
    expect(screen.queryByLabelText('Switch to Apple Music')).toBeNull();
  });

  it('can’t switch in a room someone else hosts, even with both services', async () => {
    await signIn();
    await connectAppleMusic();
    // Kitchen Disco, hosted by Jules through Spotify: Phantom is third in line.
    await go({ pathname: '/join', params: { code: '9M2XR4' } });
    await press('Join Kitchen Disco');
    expect(await screen.findByText('Not on Spotify · the host can skip it')).toBeVisible();
    expect(screen.queryByText(/you can switch/)).toBeNull();
  });
});
