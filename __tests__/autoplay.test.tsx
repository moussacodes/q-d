import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { MockPlaybackAdapter } from '@/providers/mock/playback';

// "Autoplay by Apple Music/Spotify" (Forge card). When the queue ends in aux
// and the host's service keeps playing songs it picks itself, everyone is
// told whose songs they are, so nobody thinks q’d or the room chose them.
jest.setTimeout(60_000);

afterEach(() => {
  jest.restoreAllMocks();
});

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

/**
 * Skips to the last queued song, "Heartbreak Anniversary", then runs the
 * mock player past its end instead of waiting 3:18.
 */
const runOutTheQueue = async () => {
  await screen.findByText('7 songs');
  for (let i = 0; i < 7; i += 1) await press('Skip');
  expect(await screen.findByText('Heartbreak Anniversary')).toBeVisible();
  const adapter = MockPlaybackAdapter.prototype as unknown as {
    position: (this: { track: { providerTrackId: string } | null }) => number;
  };
  const position = adapter.position;
  jest.spyOn(adapter, 'position').mockImplementation(function (this: {
    track: { providerTrackId: string } | null;
  }) {
    return position.call(this) + (this.track?.providerTrackId === 'q7' ? 200_000 : 0);
  });
};

describe('the host', () => {
  it('sees the service’s own pick, labeled with the service, once the queue ends', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X' } });
    await runOutTheQueue();
    await waitFor(() => expect(screen.getByText('Autoplay by Spotify')).toBeVisible());

    expect(screen.getByText('Get You')).toBeVisible();
    expect(
      screen.getByText(
        'The queue ran out, so Spotify is picking songs on your phone. q’d and the room didn’t choose them. Add a song and the queue takes over.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('Nothing playing yet')).toBeNull();
    expect(screen.queryByText('Heartbreak Anniversary')).toBeNull();
    expect(screen.getByText('0 songs')).toBeVisible();

    await press('Pause');
    expect(screen.getByLabelText('Play')).toBeEnabled();
    expect(screen.getByText('Autoplay by Spotify')).toBeVisible();
  });

  it('hands the room back to the queue when a song is added', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X' } });
    await runOutTheQueue();
    await screen.findByText('Autoplay by Spotify');

    await press('Add a song');
    await press('Add Rain Down');
    expect(await screen.findByText(/Rain Down added/)).toBeVisible();
    await act(async () => {
      router.back();
    });
    expect(await screen.findByText('Rain Down')).toBeVisible();
    expect(screen.queryByText('Autoplay by Spotify')).toBeNull();
    expect(screen.queryByText('Get You')).toBeNull();
  });

  it('sees it on Home’s mini player too', async () => {
    await signIn();
    await act(async () => {
      fireEvent.press(await screen.findByText('Start a room'));
    });
    await press('Start room');
    await runOutTheQueue();
    await screen.findByText('Autoplay by Spotify');
    await go('/home');
    expect(
      await screen.findByLabelText('Open room. Now playing Autoplay by Spotify'),
    ).toBeVisible();
  });

  it('names Apple Music when the room plays through it', async () => {
    await signIn();
    // The host's phone needs Apple Music connected to play through it.
    await go('/settings');
    await act(async () => {
      fireEvent.press(await screen.findByText('Connect'));
    });
    await screen.findByText('Mock connection · no Apple Music account used');
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'apple' } });
    await runOutTheQueue();
    await waitFor(() => expect(screen.getByText('Autoplay by Apple Music')).toBeVisible());
    expect(screen.queryByText(/Autoplay by Spotify/)).toBeNull();
  });

  it('gets no autoplay label when the last song is skipped instead of ending', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X' } });
    await screen.findByText('7 songs');
    for (let i = 0; i < 8; i += 1) await press('Skip');
    expect(await screen.findByText('Nothing playing yet')).toBeVisible();
    expect(screen.queryByText(/^Autoplay by/)).toBeNull();
  });
});

describe('listeners', () => {
  it('see whose songs these are, without the song or the controls', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X' } });
    await runOutTheQueue();
    await screen.findByText('Autoplay by Spotify');

    // The listener preview shares the real room.
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'listener' } });
    expect(await screen.findByText('Autoplay by Spotify')).toBeVisible();
    expect(screen.getByText('Spotify is choosing')).toBeVisible();
    expect(
      screen.getByText(
        'The queue ran out, so the host’s Spotify is picking songs. q’d and the room didn’t choose them. Add a song and the queue takes over.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('Get You')).toBeNull();
    expect(screen.queryByLabelText('Pause')).toBeNull();
    expect(screen.queryByLabelText('Play')).toBeNull();
  });
});
