import { router, useLocalSearchParams } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { useEffect } from 'react';

import { useMockSession } from '@/features/session/MockSession';

// Availability and low-confidence states (Forge card). q’d never silently
// plays a wrong recording or hides a gap (PRODUCT_SPEC.md §6): a song the
// room's service doesn't have never plays, and a low-confidence or
// explicit/clean match plays only with its warning showing, to everyone.
jest.setTimeout(60_000);

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

/** Test-only route: you're now in the room `code`, then back to Home. */
function EnterRoom() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { enterRoom } = useMockSession();
  useEffect(() => {
    enterRoom(code);
    router.back();
  }, [code, enterRoom]);
  return null;
}

/** A returning user on Home, with Spotify (mock) connected. */
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

const openAddSong = async (code: string, view?: string) => {
  await act(async () => {
    router.push({ pathname: '/room/[code]/add-song', params: view ? { code, view } : { code } });
  });
};

/**
 * Skips `count` songs in the sample room: past Have a Baby, Lovers Rock and
 * Always, Phantom (not on Spotify) is 3, and Way Bigger (uncertain) is 5.
 */
const skip = async (count: number) => {
  for (let i = 0; i < count; i += 1) {
    await press('Skip');
  }
};

const uncertainHost =
  'This is the closest match Spotify has (81/100 match). It could be another recording. Skip it if it’s wrong.';
const uncertainListener =
  'This is the closest match Spotify has (81/100 match). It could be another recording. The host can skip it.';

describe('a low-confidence match playing', () => {
  it('plays, but tells the host it might be the wrong version and offers Skip', async () => {
    await signIn();
    await openRoom('QD-7K4F9X', 'uncertain');
    expect(await screen.findByText('Way Bigger')).toBeVisible();
    expect(screen.getByText('Might be a different version')).toBeVisible();
    expect(screen.getByText(uncertainHost)).toBeVisible();
    // It plays: the host's controls all work.
    expect(screen.getByLabelText('Pause')).toBeEnabled();
    expect(screen.getByLabelText('Previous')).toBeEnabled();
    // "Wrong version?" comes with its own card; nothing pretends to offer it.
    expect(screen.queryByText('Wrong version?')).toBeNull();

    await press('Skip this song');
    expect(await screen.findByText('Butterflies')).toBeVisible();
    expect(screen.queryByText('Might be a different version')).toBeNull();
  });

  it('tells listeners too, without giving them Skip', async () => {
    await signIn();
    await openRoom('QD-7K4F9X');
    await screen.findByText('7 songs');
    await skip(5);
    expect(await screen.findByText(uncertainHost)).toBeVisible();

    // The listener preview shares the real room's queue.
    await openRoom('QD-7K4F9X', 'listener');
    expect(await screen.findByText(uncertainListener)).toBeVisible();
    expect(screen.queryByLabelText('Skip this song')).toBeNull();
    expect(screen.getByLabelText('Skip')).toBeDisabled();
  });

  it('is marked in the queue before it comes up', async () => {
    await signIn();
    await openRoom('QD-7K4F9X');
    expect(await screen.findByText('May be another version on Spotify')).toBeVisible();
    expect(screen.getByText('Not on Spotify · the host can skip it')).toBeVisible();
    // Everything else in the queue matched automatically, so it has no note.
    expect(screen.getAllByText(/ on Spotify/)).toHaveLength(2);
  });

  it('carries no warning in a room that plays through a service that has the song', async () => {
    await signIn();
    await openRoom('QD-7K4F9X', 'apple');
    expect(await screen.findByText('7 songs')).toBeVisible();
    expect(screen.queryByText(/May be another version/)).toBeNull();
    expect(screen.queryByText(/^Not on /)).toBeNull();
  });
});

describe('search results', () => {
  it('say how each song stands on the room’s service', async () => {
    await signIn();
    await openAddSong('QD-7K4F9X');
    expect(await screen.findByText('Ocho Rios')).toBeVisible();
    expect(screen.getByText('Explicit/clean version differs on Spotify')).toBeVisible();
    expect(screen.getByText('Not on Spotify')).toBeVisible(); // Valentina
    // Have a Baby, Always, Rain Down and Moon matched automatically.
    expect(screen.getAllByText('On Spotify')).toHaveLength(4);
  });

  it('play an explicit/clean conflict with its warning when it starts an empty room', async () => {
    await signIn();
    await openAddSong('QD-7K4F9X', 'empty');
    await press('Add Ocho Rios');
    expect(await screen.findByText('Ocho Rios added · playing now')).toBeVisible();

    await openRoom('QD-7K4F9X', 'empty');
    expect(await screen.findByText('Explicit/clean version differs')).toBeVisible();
    expect(
      screen.getByText(
        'Spotify has this song, but not with the same explicit or clean lyrics (95/100 match). Skip it if it’s wrong.',
      ),
    ).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Pause')).toBeEnabled());
  });

  it('never play a song the service doesn’t have, even as the first song', async () => {
    await signIn();
    await openAddSong('QD-7K4F9X', 'empty');
    await press('Add Valentina');
    // The toast never claims a song plays when the host's phone can't play it.
    expect(await screen.findByText('Valentina added · up now · not on Spotify')).toBeVisible();
    expect(screen.queryByText(/playing now/)).toBeNull();

    await openRoom('QD-7K4F9X', 'empty');
    expect(await screen.findByText('Not on Spotify')).toBeVisible();
    expect(screen.getByLabelText('Play')).toBeDisabled();
    expect(screen.getByLabelText('0:00 of 2:34')).toBeVisible();
    expect(screen.getByLabelText('Skip')).toBeEnabled();
  });
});

describe('a song the room’s service doesn’t have', () => {
  it('holds the room until the host skips it, then the next song plays', async () => {
    await signIn();
    await openRoom('QD-7K4F9X', 'unavailable');
    expect(await screen.findByText('Not on Spotify')).toBeVisible();
    expect(screen.getByLabelText('Play')).toBeDisabled();

    await press('Skip this song');
    expect(screen.queryByText('Not on Spotify')).toBeNull();
    // The next song plays through Spotify, with every control back on.
    await waitFor(() => expect(screen.getByLabelText('Pause')).toBeEnabled());
    expect(screen.getByLabelText('Previous')).toBeEnabled();
    expect(screen.getByLabelText('Repeat this song')).toBeEnabled();
  });

  it('plays in a room that plays through a service that has it', async () => {
    await signIn();
    await openRoom('QD-7K4F9X', 'apple');
    await skip(3);
    expect(await screen.findByText('Phantom')).toBeVisible();
    expect(screen.queryByText('Not on Apple Music')).toBeNull();
    await waitFor(() => expect(screen.getByLabelText('Pause')).toBeEnabled());
  });
});

describe('the mini player', () => {
  it('can’t play a song the host’s phone doesn’t have', async () => {
    await signIn();
    await act(async () => {
      router.push({ pathname: '/test-enter-room', params: { code: 'QD-7K4F9X' } } as never);
    });
    await waitFor(() => expect(screen).toHavePathname('/home'));
    expect(await screen.findByLabelText('Pause')).toBeEnabled();

    await openRoom('QD-7K4F9X');
    await skip(3);
    expect(await screen.findByText('Not on Spotify')).toBeVisible();
    await act(async () => {
      router.navigate('/home');
    });
    expect(await screen.findByLabelText('Open room. Now playing Phantom')).toBeVisible();
    expect(screen.getByLabelText('Play')).toBeDisabled();
  });
});
