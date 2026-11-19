import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// Search / add-song overlay (Forge card). Anyone in the room adds songs to
// the shared queue (PRODUCT_SPEC.md §4–5); a song that's already there needs
// a second tap to confirm.
jest.setTimeout(60_000);

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

/** A returning user (Baron) in a room. */
const openRoom = async (params: { code: string; view?: string }) => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
  await act(async () => {
    router.push({ pathname: '/room/[code]', params });
  });
};

/** The same, with Add a song open. */
const openAddSong = async (params: { code: string; view?: string }) => {
  await openRoom(params);
  await press('Add a song');
  await screen.findByText('Rain Down');
};

const closeSheet = async () => {
  await act(async () => {
    router.back();
  });
};

describe('a listener', () => {
  it('adds a song to the end of the queue', async () => {
    // Kitchen Disco: Jules hosts, four songs queued.
    await openAddSong({ code: 'QD-9M2XR4' });
    await press('Add Rain Down');
    expect(screen.getByText(/Rain Down added · 5th in line/)).toBeVisible();

    await closeSheet();
    expect(await screen.findByText('5 songs')).toBeVisible();
    expect(screen.getByText('by Baron')).toBeVisible();
  });

  it('can undo the add', async () => {
    await openAddSong({ code: 'QD-9M2XR4' });
    await press('Add Rain Down');
    await press('Undo adding Rain Down');
    expect(screen.queryByText(/Rain Down added/)).toBeNull();

    await closeSheet();
    expect(await screen.findByText('4 songs')).toBeVisible();
    expect(screen.queryByText('by Baron')).toBeNull();
  });

  it('is asked before adding a song that’s already queued', async () => {
    await openAddSong({ code: 'QD-9M2XR4' });
    expect(screen.getByText('In queue')).toBeVisible(); // "Always"

    await press('Add Always');
    expect(screen.getByText('Already in queue. Add it again?')).toBeVisible();
    await press('Cancel');
    expect(screen.queryByText('Already in queue. Add it again?')).toBeNull();

    await press('Add Always');
    await press('Add Always again');
    expect(screen.getByText(/Always added · 5th in line/)).toBeVisible();
    await closeSheet();
    expect(await screen.findByText('5 songs')).toBeVisible();
  });

  it('can add a song that isn’t on the host’s service, which the host can then skip', async () => {
    const note = 'Not on Spotify · the host can skip it';
    await openRoom({ code: 'QD-9M2XR4' });
    // Kitchen Disco's sample queue already has "Phantom", which isn't on Spotify.
    expect(await screen.findAllByText(note)).toHaveLength(1);
    await press('Add a song');
    await screen.findByText('Valentina');
    expect(screen.getAllByText('Not on Spotify').length).toBeGreaterThan(0); // "Valentina"
    await press('Add Valentina');
    expect(screen.getByText(/Valentina added · 5th in line/)).toBeVisible();

    await closeSheet();
    expect(await screen.findAllByText(note)).toHaveLength(2);
  });
});

describe('the host', () => {
  it('is asked before adding the song that’s playing', async () => {
    await openAddSong({ code: 'QD-7K4F9X' });
    expect(screen.getByText('Playing')).toBeVisible();
    await press('Add Have a Baby (With Me)');
    expect(screen.getByText('Playing now. Add it again?')).toBeVisible();
  });

  it('starts an empty room by adding a song', async () => {
    await openAddSong({ code: 'QD-7K4F9X', view: 'empty' });
    await press('Add Rain Down');
    expect(screen.getByText(/Rain Down added · playing now/)).toBeVisible();
    // It's playing, so it can't be taken back from the queue.
    expect(screen.queryByLabelText('Undo adding Rain Down')).toBeNull();

    await closeSheet();
    expect(await screen.findByLabelText('Pause')).toBeVisible();
    expect(screen.queryByText('Nothing playing yet')).toBeNull();
  });

  it('sees songs added in the real room, not in a preview', async () => {
    await openAddSong({ code: 'QD-7K4F9X', view: 'empty' });
    await press('Add Rain Down');
    await closeSheet();
    await act(async () => {
      router.push({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X' } });
    });
    expect(await screen.findAllByText('7 songs')).not.toHaveLength(0);
    expect(screen.queryByText('8 songs')).toBeNull();
  });
});
