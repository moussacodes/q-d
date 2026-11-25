import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// Empty queue (4.2) and unavailable recording (4.3) states (Forge card
// "Empty queue and unavailable recording states"). Both have to be honest:
// an empty room says what to do next, and a song the host's service doesn't
// have says so, without promising a switch the host can't make.
jest.setTimeout(60_000);

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

/** A returning user on Home, with Spotify (mock) connected. */
const signIn = async () => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
};

const openRoom = async (code: string, view?: string) => {
  await act(async () => {
    router.push({ pathname: '/room/[code]', params: view ? { code, view } : { code } });
  });
};

/** The timeline's label, "1:40 of 3:45". */
const timeline = /^\d+:\d{2} of \d+:\d{2}$/;

describe('empty queue (4.2)', () => {
  it('asks the host for a first song, with an empty cover and queue', async () => {
    await signIn();
    await openRoom('QD-7K4F9X', 'empty');
    expect(await screen.findByText('Nothing playing yet')).toBeVisible();
    expect(
      screen.getByText('Add a song to get the room going. It plays on the host’s phone.'),
    ).toBeVisible();
    expect(screen.getByText('The queue is empty')).toBeVisible();
    expect(screen.getByText('Songs people add show up here, in order.')).toBeVisible();
    expect(screen.getByText('0 songs')).toBeVisible();
    expect(screen.getByText('Just you so far')).toBeVisible();
    // The code shows while there's no cover to expand, so the host can share it.
    expect(screen.getByText('QD-7K4F9X')).toBeVisible();
    expect(screen.getByLabelText('Add a song')).toBeEnabled();
    // Nothing to play, so no timeline and no playback controls.
    expect(screen.queryByLabelText(timeline)).toBeNull();
    expect(screen.queryByLabelText('Skip')).toBeNull();
    expect(screen.queryByText(/^Not on /)).toBeNull();
  });

  it('lets a listener add the first song in an empty room they didn’t start', async () => {
    await signIn();
    await openRoom('QD-3HV8PL'); // Late Drive Home, hosted by Priya: nothing queued.
    expect(await screen.findByText('Nothing playing yet')).toBeVisible();
    expect(screen.getByText('The queue is empty')).toBeVisible();
    expect(screen.getByText('Host: Priya')).toBeVisible();
    expect(screen.getByLabelText('Add a song')).toBeEnabled();
    await press('Add a song');
    expect(screen).toHavePathname('/room/QD-3HV8PL/add-song');
  });

  it('says so when the last queued song is playing, then empties the room', async () => {
    await signIn();
    await openRoom('QD-7K4F9X');
    await screen.findByText('7 songs');
    for (let i = 0; i < 7; i += 1) {
      await press('Skip');
    }
    // The last song plays; nothing waits behind it.
    expect(screen.getByText('Up next · 0 songs')).toBeVisible();
    expect(screen.getByText('Nothing queued yet')).toBeVisible();
    expect(screen.getByText('The queue is empty')).toBeVisible();
    expect(screen.getByLabelText(timeline)).toBeVisible();

    await press('Skip');
    expect(await screen.findByText('Nothing playing yet')).toBeVisible();
    expect(screen.queryByLabelText(timeline)).toBeNull();
  });
});

describe('song not on the host’s service (4.3)', () => {
  it('asks the host to skip it when they have no other service', async () => {
    await signIn();
    await openRoom('QD-7K4F9X', 'unavailable');
    expect(await screen.findByText('Not on Spotify')).toBeVisible();
    expect(
      screen.getByText(
        'This song isn’t on the service your phone plays through. Skip it to keep the room going.',
      ),
    ).toBeVisible();
    // Switching needs Apple Music connected, which this host hasn't done.
    expect(screen.queryByText('Switch for next song')).toBeNull();
    expect(screen.queryByText(/Apple Music/)).toBeNull();

    await press('Skip this song');
    expect(screen.queryByText('Not on Spotify')).toBeNull();
    expect(screen.queryByText('Phantom')).toBeNull();
  });

  it('offers to switch for the next song once the host has the other service', async () => {
    await signIn();
    await press('Settings');
    await act(async () => {
      fireEvent.press(await screen.findByText('Connect'));
    });
    expect(await screen.findByText('Mock connection · no Apple Music account used')).toBeVisible();
    await press('Back');

    await openRoom('QD-7K4F9X', 'unavailable');
    expect(await screen.findByText('Not on Spotify')).toBeVisible();
    expect(
      screen.getByText(
        'This song isn’t on the service your phone plays through. Skip it, or switch to Apple Music for the next song.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Switch for next song')).toBeVisible();
    expect(screen.getByLabelText('Skip this song')).toBeEnabled();
  });

  it('marks the song in the queue before it comes up', async () => {
    await signIn();
    await openRoom('QD-7K4F9X');
    expect(await screen.findByText('Not on Spotify · the host can skip it')).toBeVisible();
    expect(screen.queryByText('Not on Spotify')).toBeNull();
  });

  it('tells listeners why it can’t play, without offering them Skip', async () => {
    await signIn();
    await openRoom('QD-7K4F9X');
    await screen.findByText('7 songs');
    // Past Have a Baby, Lovers Rock and Always: "Phantom", not on Spotify, comes up.
    await press('Skip');
    await press('Skip');
    await press('Skip');
    expect(await screen.findByText('Not on Spotify')).toBeVisible();

    // The listener preview shares the real room's queue.
    await openRoom('QD-7K4F9X', 'listener');
    expect(
      await screen.findByText(
        'This song isn’t on Spotify, so the host’s phone can’t play it. The host can skip it.',
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText('Skip this song')).toBeNull();
    expect(screen.queryByText('Switch for next song')).toBeNull();
    expect(screen.getByLabelText('Skip')).toBeDisabled();
  });
});
