import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { roomCodes } from '@/features/room/roomCodes';
import { catalog } from '@/providers';

// UI state tests (Forge card "UI tests for each non-happy-path state"). The
// demo has to show honest states, not crashes or blank screens. One describe
// per state, across the screens that show it (ARCHITECTURE.md §10). Deeper
// coverage of some states lives in room-states, availability-confidence,
// host-reconnecting, provider-optional and settings.
jest.setTimeout(60_000);

const press = async (label: string, index = 0) => {
  await act(async () => {
    fireEvent.press((await screen.findAllByLabelText(label))[index]);
  });
};

const pressText = async (text: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByText(text));
  });
};

const go = async (href: Parameters<typeof router.push>[0]) => {
  await act(async () => {
    router.push(href);
  });
};

/** A returning user on Home, with Spotify (mock) connected. */
const signIn = async () => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
};

/** A new account that skipped connecting a music service: a guest. */
const signUpAsGuest = async () => {
  await renderRouter('./app', { initialUrl: '/' });
  await press('Continue with Google');
  await press('I’m 18 or older');
  await press('Continue');
  await screen.findByText('Bring your own music.');
  await pressText('Skip');
  await pressText('I’ll do this later');
  await screen.findByText('Start a room or jump into one.');
};

const join = (code: string) => go({ pathname: '/join', params: { code } });

afterEach(() => {
  jest.restoreAllMocks();
});

describe('loading', () => {
  it('Join says it’s looking for the room and can’t be pressed yet', async () => {
    jest.spyOn(roomCodes, 'lookup').mockReturnValue(new Promise(() => {}));
    await signIn();
    await join('9M2XR4');
    expect(await screen.findByLabelText('Looking for the room…')).toBeDisabled();
    expect(screen.queryByText('Room found')).toBeNull();
    expect(screen.queryByText(/doesn’t work/)).toBeNull();
  });

  it('Add a song says it’s searching, never “No songs match” before the answer', async () => {
    jest.spyOn(catalog, 'search').mockReturnValue(new Promise(() => {}));
    await signIn();
    await go({ pathname: '/room/[code]/add-song', params: { code: 'QD-7K4F9X' } });
    expect(await screen.findByText('Searching…')).toBeVisible();
    expect(screen.queryByText(/No songs match/)).toBeNull();
  });

  it('the room shows the song from the start until the player has it, never a blank timeline', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X' } });
    expect(await screen.findByText('Have a Baby (With Me)')).toBeVisible();
    expect(screen.getByLabelText(/^\d+:\d{2} of 3:45$/)).toBeVisible();
  });
});

describe('empty queue', () => {
  it('the room asks for a first song', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'empty' } });
    expect(await screen.findByText('Nothing playing yet')).toBeVisible();
    expect(screen.getByText('The queue is empty')).toBeVisible();
    expect(screen.getByLabelText('Add a song')).toBeEnabled();
  });

  it('Up next says the queue is empty instead of showing a blank list', async () => {
    await signIn();
    await go({ pathname: '/room/[code]/queue', params: { code: 'QD-7K4F9X', view: 'empty' } });
    expect(await screen.findByText('The queue is empty')).toBeVisible();
    expect(screen.getByText('Songs people add show up here, in order.')).toBeVisible();
    expect(screen.getByText('0 songs')).toBeVisible();
  });

  it('a search with no results says so', async () => {
    await signIn();
    await go({ pathname: '/room/[code]/add-song', params: { code: 'QD-7K4F9X' } });
    await screen.findByText('Ocho Rios');
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Search'), 'zzqx');
    });
    expect(await screen.findByText('No songs match “zzqx”.')).toBeVisible();
  });

  it('an empty search asks what to look for', async () => {
    await signIn();
    await go({ pathname: '/room/[code]/add-song', params: { code: 'QD-7K4F9X' } });
    await screen.findByText('Ocho Rios');
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Search'), '   ');
    });
    expect(await screen.findByText('Search by song, artist or album.')).toBeVisible();
    expect(screen.queryByText('Ocho Rios')).toBeNull();
  });
});

describe('unavailable and low-confidence songs', () => {
  it('an unavailable song says so and doesn’t play', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'unavailable' } });
    expect(await screen.findByText('Not on Spotify')).toBeVisible();
    expect(screen.getByLabelText('Play')).toBeDisabled();
  });

  it('a low-confidence match plays with its warning', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'uncertain' } });
    expect(await screen.findByText('Might be a different version')).toBeVisible();
    expect(screen.getByLabelText('Pause')).toBeEnabled();
  });
});

describe('host reconnecting', () => {
  it.each([
    ['reconnecting', 'Host reconnecting'],
    ['host-away', 'Paused'],
    ['host-back', 'You’re back'],
  ])('?view=%s shows “%s” with the queue kept', async (view, title) => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view } });
    expect(await screen.findByText(title)).toBeVisible();
    expect(screen.getByText('7 songs')).toBeVisible();
  });
});

describe('no music service (guest)', () => {
  it('can join and add songs, and is asked for a service only to host', async () => {
    await signUpAsGuest();
    await join('9M2XR4');
    await press('Join Kitchen Disco');
    expect(screen).toHavePathname('/room/QD-9M2XR4');
    expect(screen.getByLabelText('Add a song')).toBeEnabled();
    expect(screen.queryByText(/Connect a music service/)).toBeNull();

    await go('/create-room');
    expect(await screen.findByText('Connect a music service to host')).toBeVisible();
    expect(screen.getByLabelText('Start room')).toBeDisabled();
  });

  it('Settings offers both services and no “Play rooms through”', async () => {
    await signUpAsGuest();
    await go('/settings');
    await screen.findByText('Settings');
    expect(screen.getAllByLabelText('Connect')).toHaveLength(2);
    expect(screen.queryByText('Play rooms through')).toBeNull();
  });
});

describe('music service disconnected', () => {
  it('a host whose service was disconnected is told so, and nothing plays', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X' } });
    expect(await screen.findByLabelText('Pause')).toBeEnabled();

    await go('/settings');
    await press('Disconnect Spotify');
    await press('Back');

    expect(await screen.findByText('Spotify isn’t connected')).toBeVisible();
    expect(
      screen.getByText(
        'Your phone plays this room through Spotify. Connect it again in Settings to play music. The room and the queue are kept.',
      ),
    ).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Play')).toBeDisabled());
    expect(screen.getByText('7 songs')).toBeVisible();

    await pressText('Open Settings');
    expect(screen).toHavePathname('/settings');
    await press('Connect');
    await press('Back');
    await waitFor(() => expect(screen.queryByText('Spotify isn’t connected')).toBeNull());
    expect(screen.getByLabelText('Play')).toBeEnabled();
  });

  it('hosting asks for a service again', async () => {
    await signIn();
    await go('/settings');
    await press('Disconnect Spotify');
    await go('/create-room');
    expect(await screen.findByText('Connect a music service to host')).toBeVisible();
    expect(screen.getByLabelText('Start room')).toBeDisabled();
  });

  it('a listener in someone else’s room is never asked for one', async () => {
    await signIn();
    await go('/settings');
    await press('Disconnect Spotify');
    await go({ pathname: '/room/[code]', params: { code: 'QD-9M2XR4' } });
    expect(await screen.findByText('Kitchen Disco')).toBeVisible();
    expect(screen.queryByText(/isn’t connected/)).toBeNull();
  });
});

describe('joining with a code', () => {
  it.each([
    ['ZZZZZZ', 'That code doesn’t work', false],
    ['FULL15', 'This room is full', false],
    ['ENDED1', 'This room has ended', false],
    ['LIMIT1', 'Too many tries', true],
    ['OFFLN1', 'Can’t reach q’d', true],
  ])('%s: “%s”, and Join stays off', async (code, title, canRetry) => {
    await signIn();
    await join(code);
    expect(await screen.findByText(title)).toBeVisible();
    expect(screen.getByLabelText('Join')).toBeDisabled();
    expect(screen.queryByText('Room found')).toBeNull();
    expect(!!screen.queryByText('Try again')).toBe(canRetry);
  });

  it('an incomplete code shows nothing yet, and Join stays off', async () => {
    await signIn();
    await join('9M2');
    expect(await screen.findByLabelText('Join')).toBeDisabled();
    expect(screen.queryByText('Room found')).toBeNull();
    expect(screen.queryByText(/doesn’t work/)).toBeNull();
  });

  it('a lookup that fails unexpectedly counts as offline, and Try again recovers', async () => {
    const lookup = roomCodes.lookup.bind(roomCodes);
    jest
      .spyOn(roomCodes, 'lookup')
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockImplementation(lookup);
    await signIn();
    await join('9M2XR4');
    expect(await screen.findByText('Can’t reach q’d')).toBeVisible();
    await pressText('Try again');
    expect(await screen.findByText('Room found')).toBeVisible();
    expect(screen.getByLabelText('Join Kitchen Disco')).toBeEnabled();
  });

  it('finds the room once the code is corrected', async () => {
    await signIn();
    await join('ZZZZZZ');
    expect(await screen.findByText('That code doesn’t work')).toBeVisible();
    await go({ pathname: '/join', params: { code: '7K4F9X' } });
    expect(await screen.findByLabelText('Join Sunday Slow Burn')).toBeEnabled();
  });
});

describe('offline', () => {
  it('Add a song says search failed instead of “no songs”', async () => {
    jest.spyOn(catalog, 'search').mockRejectedValue(new Error('offline'));
    await signIn();
    await go({ pathname: '/room/[code]/add-song', params: { code: 'QD-7K4F9X' } });
    expect(
      await screen.findByText(
        'Search isn’t working right now. Check your connection, then try again.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/No songs match/)).toBeNull();
  });
});
