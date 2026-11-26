import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { MOCK_JOIN_ATTEMPTS, MockRoomServer } from '@/features/room/mockServer';
import { catalog } from '@/providers';
import { fillEmailForm } from '@/test/emailForm';

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
  await fillEmailForm();
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

afterEach(() => {
  jest.restoreAllMocks();
});

// Joining happens on Home's code field (join-on-Home stack), so these type
// into it and press its Join button.
const typeCode = async (code: string) => {
  await act(async () => {
    fireEvent.changeText(await screen.findByLabelText('Room code'), code);
  });
};

const joinButton = () => screen.getByLabelText('Join');

const pressJoin = async () => {
  await act(async () => {
    fireEvent.press(joinButton());
  });
};

/** Types `code` into Home's field and presses Join. */
const join = async (code: string) => {
  await typeCode(code);
  await pressJoin();
};

describe('loading', () => {
  it('Join says it’s joining and can’t be pressed again', async () => {
    const call = jest
      .spyOn(MockRoomServer.prototype, 'joinRoomByCode')
      .mockReturnValue(new Promise(() => {}));
    await signIn();
    await join('9M2XR4');
    expect(await screen.findByText('Joining QD-9M2XR4…')).toBeVisible();
    expect(joinButton()).toBeDisabled();
    await pressJoin();
    expect(call).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
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
        'This room plays through Spotify on your phone, so the music is paused. The room and its queue are still here.',
      ),
    ).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Play')).toBeDisabled());
    expect(screen.getByText('7 songs')).toBeVisible();

    await press('Reconnect Spotify');
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

// Joining with a code, on Home's field (moved from the old Join screen when
// this stack merged with join-on-Home; DECISIONS.md 2026-11-25 · UI state
// tests). join-from-home.test.tsx covers these in more depth.
describe('joining with a code', () => {
  const wrong =
    'That code doesn’t match a room. It may be mistyped or expired, so check it with the host.';

  it.each([
    ['ZZZZZZ', wrong],
    ['STALE2', wrong],
    ['FULL22', 'That room is full. Rooms hold up to 15 people.'],
    ['ENDED2', 'That room has ended. Ask the host for a new code.'],
  ])('%s: “%s”, and you stay on Home', async (code, words) => {
    await signIn();
    await join(code);
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
    expect(screen).toHavePathname('/home');
  });

  it(`pauses joining after ${MOCK_JOIN_ATTEMPTS} wrong codes, and says how long to wait`, async () => {
    await signIn();
    for (let i = 0; i < MOCK_JOIN_ATTEMPTS; i += 1) {
      await join('ZZZZZZ');
    }
    // Even a real room's code waits now: the limit is checked first.
    await join('9M2XR4');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Too many tries\. Wait \d+ seconds?, then try again\.$/,
    );
    expect(screen).toHavePathname('/home');
  });

  it('an incomplete code can’t be sent', async () => {
    const call = jest.spyOn(MockRoomServer.prototype, 'joinRoomByCode');
    await signIn();
    await typeCode('9M2');
    expect(joinButton()).toBeDisabled();
    await pressJoin();
    expect(call).not.toHaveBeenCalled();
  });

  it('a code with 0, O, 1 or I says codes never use them, and isn’t sent', async () => {
    const call = jest.spyOn(MockRoomServer.prototype, 'joinRoomByCode');
    await signIn();
    await typeCode('FULL15');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Room codes don’t use 0, O, 1 or I. Check the code with the host.',
    );
    expect(joinButton()).toBeDisabled();
    expect(call).not.toHaveBeenCalled();
  });

  it('a call that fails unexpectedly turns Join back on, and a second tap joins', async () => {
    jest
      .spyOn(MockRoomServer.prototype, 'joinRoomByCode')
      .mockRejectedValueOnce(new Error('fetch failed'));
    await signIn();
    await join('9M2XR4');
    expect(screen).toHavePathname('/home');
    expect(joinButton()).toBeEnabled();
    await pressJoin();
    expect(screen).toHavePathname('/room/QD-9M2XR4');
  });

  it('editing the code clears the error, and a corrected code joins', async () => {
    await signIn();
    await join('ZZZZZZ');
    expect(await screen.findByRole('alert')).toHaveTextContent(wrong);
    await typeCode('7k4f9x');
    expect(screen.queryByRole('alert')).toBeNull();
    await pressJoin();
    expect(screen).toHavePathname('/room/QD-7K4F9X');
  });
});

describe('offline', () => {
  it('Add a song says search failed instead of “no songs”', async () => {
    jest.spyOn(catalog, 'search').mockRejectedValue(new Error('offline'));
    await signIn();
    await go({ pathname: '/room/[code]/add-song', params: { code: 'QD-7K4F9X' } });
    expect(
      await screen.findByText('Search isn’t working right now. Try again in a moment.'),
    ).toBeVisible();
    expect(screen.queryByText(/No songs match/)).toBeNull();
  });
});

/** Uses a /dev toggle for the sample room: Realtime's stand-ins in mock mode. */
const devToggle = async (label: string) => {
  await go('/dev');
  await pressText(label);
  await act(async () => {
    router.back();
  });
};

describe('room ended (room.ended)', () => {
  it('the host sees the room is over, with no controls, and goes Home', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X' } });
    expect(await screen.findByLabelText('Pause')).toBeEnabled();
    await devToggle('Host ends the room');
    expect(await screen.findByText('This room has ended')).toBeVisible();
    expect(
      screen.getByText(
        'You ended this room. Nothing more plays, and its code doesn’t work any more.',
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText('Pause')).toBeNull();
    expect(screen.queryByLabelText('Play')).toBeNull();
    expect(screen.queryByLabelText('Add a song')).toBeNull();
    await press('Back to Home');
    expect(screen).toHavePathname('/home');
    // No mini player for a room that's over.
    expect(screen.queryByText('Have a Baby (With Me)')).toBeNull();
  });

  it('a listener is told the host ended it', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'listener' } });
    await screen.findByText('Have a Baby (With Me)');
    await devToggle('Host ends the room');
    expect(await screen.findByText('This room has ended')).toBeVisible();
    expect(
      screen.getByText(
        'Baron ended this room. Nothing more plays, and its code doesn’t work any more.',
      ),
    ).toBeVisible();
  });
});

describe('offline inside the room', () => {
  it('says so, keeps the room and queue, and turns off changes until it’s back', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X', view: 'listener' } });
    await screen.findByText('Have a Baby (With Me)');
    await devToggle('This phone goes offline');
    expect(await screen.findByText('You’re offline')).toBeVisible();
    expect(screen.getByText('7 songs')).toBeVisible();
    expect(screen.getByLabelText('Add a song')).toBeDisabled();

    await devToggle('This phone is back online');
    await waitFor(() => expect(screen.queryByText('You’re offline')).toBeNull());
    expect(screen.getByLabelText('Add a song')).toBeEnabled();
  });

  it('on the host’s phone, it’s the host leaving: Reconnecting, then the room pauses', async () => {
    await signIn();
    await go({ pathname: '/room/[code]', params: { code: 'QD-7K4F9X' } });
    expect(await screen.findByLabelText('Pause')).toBeEnabled();
    await devToggle('This phone goes offline');
    expect(await screen.findByText('You’re offline')).toBeVisible();
    expect(screen.getByText('Reconnecting')).toBeVisible();
    expect(screen.getByLabelText('Skip')).toBeDisabled();
  });
});
