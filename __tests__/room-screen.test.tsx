import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { MockPlaybackAdapter } from '@/providers/mock/playback';
import { fillEmailForm } from '@/test/emailForm';

// Room screen: default, expanded and queue states (Forge card). The queue
// changes now: the host skips, reorders and removes, and every screen that
// shows the room agrees.
jest.setTimeout(60_000);

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

/** A returning user on Home. */
const signIn = async () => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await fillEmailForm();
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
};

const openRoom = async (params: { code: string; view?: string }) => {
  await act(async () => {
    router.push({ pathname: '/room/[code]', params });
  });
};

/** Queue rows in order, by title (host view: each row is a button). */
const queueOrder = () =>
  screen
    .getAllByLabelText(/^Reorder or remove /)
    .map((row) => String(row.props.accessibilityLabel).replace('Reorder or remove ', ''));

describe('the host', () => {
  it('skips to the next song', async () => {
    await signIn();
    await openRoom({ code: 'QD-7K4F9X' });
    expect(await screen.findByText('Have a Baby (With Me)')).toBeVisible();
    expect(screen.getByText('7 songs')).toBeVisible();

    await press('Skip');
    expect(screen.queryByText('Have a Baby (With Me)')).toBeNull();
    expect(screen.getByText('6 songs')).toBeVisible();
    expect(queueOrder()[0]).toBe('Always');
    // Lovers Rock left the queue and is now playing.
    expect(queueOrder()).not.toContain('Lovers Rock');
    expect(screen.getByText('Lovers Rock')).toBeVisible();
  });

  it('moves songs up and down, and removes them', async () => {
    await signIn();
    await openRoom({ code: 'QD-7K4F9X' });
    expect(queueOrder().slice(0, 3)).toEqual(['Lovers Rock', 'Always', 'Phantom']);

    await press('Reorder or remove Always');
    // Only the song you tapped shows its actions.
    expect(screen.queryByLabelText('Move Lovers Rock up')).toBeNull();
    await press('Move Always up');
    expect(queueOrder().slice(0, 3)).toEqual(['Always', 'Lovers Rock', 'Phantom']);
    expect(screen.getByLabelText('Move Always up')).toBeDisabled();

    await press('Move Always down');
    await press('Move Always down');
    expect(queueOrder().slice(0, 3)).toEqual(['Lovers Rock', 'Phantom', 'Always']);

    await press('Remove Always');
    expect(queueOrder()).not.toContain('Always');
    expect(screen.getByText('6 songs')).toBeVisible();
  });

  it('sees the same queue in the Up next sheet', async () => {
    await signIn();
    await openRoom({ code: 'QD-7K4F9X' });
    await press('Reorder or remove Lovers Rock');
    await press('Remove Lovers Rock');

    await act(async () => {
      router.push({ pathname: '/room/[code]/queue', params: { code: 'QD-7K4F9X' } });
    });
    expect(await screen.findByText('6 songs · 21 min')).toBeVisible();
    expect(queueOrder()[0]).toBe('Always');
  });

  it('is asked to skip a song that isn’t on their service', async () => {
    await signIn();
    await openRoom({ code: 'QD-7K4F9X', view: 'unavailable' });
    expect(await screen.findByText('Not on Spotify')).toBeVisible();
    // No Apple Music connected, so there's nothing to switch to (room-states.test.tsx).
    expect(screen.getByText(/Skip it to keep the room going/)).toBeVisible();

    await press('Skip this song');
    expect(screen.queryByText('Not on Spotify')).toBeNull();
    expect(screen.getByText('3 songs')).toBeVisible();
  });

  it('sees the room they started, with the name they gave it', async () => {
    await signIn();
    await act(async () => {
      router.push('/create-room');
    });
    await act(async () => {
      fireEvent.changeText(await screen.findByDisplayValue('Sunday Slow Burn'), 'Friday Night');
    });
    await press('Start room');
    expect(await screen.findByText('Friday Night')).toBeVisible();
    expect(screen.getByText('Have a Baby (With Me)')).toBeVisible();
  });
});

describe('the expanded cover', () => {
  it('is the only layout while a song plays, with the whole queue a scroll away', async () => {
    await signIn();
    await openRoom({ code: 'QD-7K4F9X' });
    expect(await screen.findByText('Up next · 7 songs')).toBeVisible();
    // No resize button: the cover can't be made smaller.
    expect(screen.queryByLabelText('Smaller cover')).toBeNull();
    expect(screen.queryByLabelText('Bigger cover')).toBeNull();
    expect(screen.getByLabelText('Skip')).toBeVisible();
    // Below the controls: every queued song.
    expect(screen.getByText('7 songs')).toBeVisible();
    expect(queueOrder()).toHaveLength(7);
    // Who's in the room is in the Up next sheet.
    expect(screen.queryByLabelText('People in this room')).toBeNull();

    // The host still reorders from here.
    await press('Reorder or remove Always');
    await press('Move Always up');
    expect(queueOrder().slice(0, 2)).toEqual(['Always', 'Lovers Rock']);
  });

  it('isn’t shown when nothing is playing', async () => {
    await signIn();
    await openRoom({ code: 'QD-7K4F9X', view: 'empty' });
    expect(await screen.findByText('Nothing playing yet')).toBeVisible();
    expect(screen.getByLabelText('People in this room')).toBeVisible();
    expect(screen.queryByText(/^Up next · /)).toBeNull();
  });
});

describe('listeners', () => {
  it('can’t skip, reorder or remove', async () => {
    await signIn();
    await openRoom({ code: 'QD-9M2XR4' }); // Kitchen Disco, hosted by Jules
    expect(await screen.findByText('Kitchen Disco')).toBeVisible();
    expect(screen.getByLabelText('Skip')).toBeDisabled();
    expect(screen.queryAllByLabelText(/^Reorder or remove /)).toEqual([]);
    expect(screen.queryByLabelText(/^Move /)).toBeNull();
  });
});

describe('when a song can’t play', () => {
  // Songs moving on by themselves is covered with a fake clock in
  // src/features/room/RoomPlayer.test.ts. The 4.3 preview used to show it,
  // by "playing" a song Spotify doesn't have, which the host's phone never does.
  it('waits for the host instead of playing a song the service doesn’t have', async () => {
    await signIn();
    await openRoom({ code: 'QD-7K4F9X', view: 'unavailable' });
    expect(await screen.findByText('Not on Spotify')).toBeVisible();
    // Nothing plays: the timeline stays at the start, and only Skip works.
    expect(screen.getByLabelText('0:00 of 1:49')).toBeVisible();
    expect(screen.getByLabelText('Play')).toBeDisabled();
    expect(screen.getByLabelText('Previous')).toBeDisabled();
    expect(screen.getByLabelText('Repeat this song')).toBeDisabled();
    expect(screen.getByLabelText('Skip')).toBeEnabled();
    expect(screen.getByText('4 songs')).toBeVisible();
  });
});

describe('when a song ends', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('the next one plays, without anyone tapping', async () => {
    await signIn();
    // The mock player keeps real time; run its songs ahead instead of waiting.
    let ahead = 0;
    const adapter = MockPlaybackAdapter.prototype as unknown as {
      position: (this: { status: string }) => number;
    };
    const position = adapter.position;
    jest.spyOn(adapter, 'position').mockImplementation(function (this: { status: string }) {
      return position.call(this) + (this.status === 'playing' ? ahead : 0);
    });
    // The room opens 1:40 into "Have a Baby (With Me)", which is 3:45 long.
    await openRoom({ code: 'QD-7K4F9X' });
    expect(await screen.findByText('Have a Baby (With Me)')).toBeVisible();
    ahead = 130_000;
    await waitFor(() => expect(screen.getByText('6 songs')).toBeVisible());
    expect(screen.queryByText('Have a Baby (With Me)')).toBeNull();
  });
});
