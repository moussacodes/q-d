import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { create } from 'qrcode';
import { Share } from 'react-native';

import type { RpcResult } from '@/domain/rpc-error';
import { MockRoomServer, type RoomInvite } from '@/features/room/mockServer';

// 3.5 Invite people (Forge card "Invite / QR screen (Figma)"). The QR code
// and the link carry a mock invite token, never the room code; the code is
// shown on its own for reading aloud. Only the host invites.
jest.setTimeout(60_000);

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('qrcode', () => {
  const actual = jest.requireActual('qrcode');
  return { ...actual, create: jest.fn(actual.create) };
});

const qrValues = () => (create as jest.Mock).mock.calls.map(([value]) => value as string);
const lastQrValue = () => qrValues()[qrValues().length - 1];

beforeEach(() => {
  (create as jest.Mock).mockClear();
  (Clipboard.setStringAsync as jest.Mock).mockClear();
});
afterEach(() => jest.restoreAllMocks());

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const ROOM = 'QD-7K4F9X';

/** A returning user, host of the sample room, on Home. */
const signIn = async () => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
};

const openInvite = async (view?: string) => {
  await act(async () => {
    router.push({
      pathname: '/room/[code]/invite',
      params: view ? { code: ROOM, view } : { code: ROOM },
    });
  });
};

const qr = () => screen.queryByLabelText('QR code with the invite link');

describe('the host', () => {
  it('sees the room code to read out, and a QR code that never holds it', async () => {
    await signIn();
    await openInvite();
    expect(await screen.findByText('Invite people')).toBeVisible();
    expect(screen.getByText(ROOM)).toBeVisible();
    expect(screen.getByLabelText('Room code Q D, 7 K 4 F 9 X')).toBeVisible();

    expect(qr()).toBeVisible();
    const value = lastQrValue();
    expect(value).toMatch(/^qd:\/\/join\?invite=mock-[0-9a-f]{32}$/);
    expect(value).not.toBe(ROOM);
    expect(value).not.toContain('7K4F9X');
    for (const drawn of qrValues()) expect(drawn).not.toBe(ROOM);
  });

  it('is told the link is a mock', async () => {
    await signIn();
    await openInvite();
    expect(await screen.findByText('Mock invite · not a working link')).toBeVisible();
  });

  it('says guests need no service, and whether they can add songs', async () => {
    await signIn();
    await openInvite();
    expect(
      await screen.findByText(
        'Anyone with the code or link can join and add songs. No music service needed.',
      ),
    ).toBeVisible();
  });

  it('copies the link the QR code holds', async () => {
    await signIn();
    await openInvite();
    await screen.findByLabelText('QR code with the invite link');
    await press('Copy link');
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(lastQrValue());
    expect(screen.getByText('Link copied')).toBeVisible();
  });

  it('shares the link with the room’s name, not the code', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await signIn();
    await openInvite();
    await screen.findByLabelText('QR code with the invite link');
    await press('Share');
    expect(share).toHaveBeenCalledTimes(1);
    const { message } = share.mock.calls[0][0] as { message: string };
    expect(message).toBe(`Join “Sunday Slow Burn” on q’d: ${lastQrValue()}`);
    expect(message).not.toContain(ROOM);
  });

  it('keeps a closed share sheet from breaking anything', async () => {
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('dismissed'));
    await signIn();
    await openInvite();
    await screen.findByLabelText('QR code with the invite link');
    await press('Share');
    expect(screen.getByLabelText('Share')).toBeEnabled();
  });

  it('gets the same link when Invite opens again', async () => {
    const spy = jest.spyOn(MockRoomServer.prototype, 'createRoomInvite');
    await signIn();
    await openInvite();
    await screen.findByLabelText('QR code with the invite link');
    const first = lastQrValue();
    await press('Close');
    await openInvite();
    await screen.findByLabelText('QR code with the invite link');
    expect(lastQrValue()).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('makes a new link when the kept one has expired', async () => {
    const spy = jest.spyOn(MockRoomServer.prototype, 'createRoomInvite');
    await signIn();
    await openInvite();
    await screen.findByLabelText('QR code with the invite link');
    const first = lastQrValue();
    await press('Close');
    const later = Date.now() + 25 * 3_600_000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    await openInvite();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    await screen.findByLabelText('QR code with the invite link');
    expect(lastQrValue()).not.toBe(first);
  });

  it('keeps the current link when a new one can’t be made, and says so', async () => {
    await signIn();
    await openInvite();
    await screen.findByLabelText('QR code with the invite link');
    const current = lastQrValue();
    jest
      .spyOn(MockRoomServer.prototype, 'createRoomInvite')
      .mockResolvedValueOnce({ ok: false, error: { code: 'room_ended' } });
    await press('Make a new link');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Couldn’t make an invite link. Try again. The current link still works.',
    );
    expect(qr()).toBeVisible();
    expect(lastQrValue()).toBe(current);
    expect(screen.getByLabelText('Copy link')).toBeEnabled();
  });

  it('can make a new link, and the old one stops working', async () => {
    await signIn();
    await openInvite();
    await screen.findByLabelText('QR code with the invite link');
    const old = lastQrValue();
    expect(screen.getByLabelText('Make a new link').props.accessibilityHint).toBe(
      'The current QR code and link stop working',
    );
    await press('Make a new link');
    await waitFor(() => expect(lastQrValue()).not.toBe(old));
    const fresh = lastQrValue();
    expect(fresh).not.toContain('7K4F9X');

    await act(async () => {
      router.push(old.replace('qd://', '/') as never);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/the host made a new one/);

    await act(async () => {
      router.push(fresh.replace('qd://', '/') as never);
    });
    await waitFor(() => expect(screen).toHavePathname(`/room/${ROOM}`));
  });
});

describe('while the invite is being made', () => {
  function holdInvite() {
    let release: (result: RpcResult<RoomInvite>) => void = () => {};
    const spy = jest.spyOn(MockRoomServer.prototype, 'createRoomInvite').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    return { spy, release: (result: RpcResult<RoomInvite>) => release(result) };
  }

  it('says so, with Copy link and Share off and no QR code yet', async () => {
    const { spy, release } = holdInvite();
    await signIn();
    await openInvite();
    expect(await screen.findByText('Making an invite link…')).toBeVisible();
    expect(qr()).toBeNull();
    expect(screen.getByLabelText('Copy link')).toBeDisabled();
    expect(screen.getByLabelText('Share')).toBeDisabled();
    expect(spy.mock.calls[0][0]).toMatchObject({ roomCode: ROOM, asHost: true });

    await act(async () => {
      release({
        ok: true,
        value: {
          token: 'mock-0123456789abcdef0123456789abcdef',
          expiresAt: '2026-11-26T00:00:00Z',
        },
      });
    });
    expect(qr()).toBeVisible();
    expect(lastQrValue()).toBe('qd://join?invite=mock-0123456789abcdef0123456789abcdef');
    expect(screen.getByLabelText('Copy link')).toBeEnabled();
  });

  it('shows an error with Try again', async () => {
    const { spy, release } = holdInvite();
    await signIn();
    await openInvite();
    await screen.findByText('Making an invite link…');
    await act(async () => {
      release({ ok: false, error: { code: 'room_ended' } });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t make an invite link. Try again.');
    expect(screen.getByLabelText('Copy link')).toBeDisabled();
    await press('Try again');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0].idempotencyKey).not.toBe(spy.mock.calls[1][0].idempotencyKey);
  });
});

describe('room rules in the subtitle', () => {
  it('leave out adding songs when guests can’t', async () => {
    await signIn();
    await act(async () => {
      router.push('/create-room');
    });
    await screen.findByLabelText('Room name');
    await act(async () => {
      fireEvent.press(screen.getAllByRole('tab', { name: 'Only you' })[0]);
    });
    await press('Start room');
    await openInvite();
    expect(
      await screen.findByText('Anyone with the code or link can join. No music service needed.'),
    ).toBeVisible();
  });
});

describe('someone who isn’t the host', () => {
  it('is told only the host invites, with no code, QR, link or share', async () => {
    const spy = jest.spyOn(MockRoomServer.prototype, 'createRoomInvite');
    await signIn();
    await openInvite('listener');
    expect(await screen.findByText('Only Baron can invite people.')).toBeVisible();
    expect(qr()).toBeNull();
    expect(screen.queryByText(ROOM)).toBeNull();
    expect(screen.queryByLabelText('Copy link')).toBeNull();
    expect(screen.queryByLabelText('Share')).toBeNull();
    expect(screen.queryByLabelText('Make a new link')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('opening an invite link', () => {
  it('goes Home without a token', async () => {
    await signIn();
    await act(async () => {
      router.push('/join');
    });
    await waitFor(() => expect(screen).toHavePathname('/home'));
  });

  it('sends someone signed out to Welcome without calling the server', async () => {
    const spy = jest.spyOn(MockRoomServer.prototype, 'joinRoomByInvite');
    await renderRouter('./app', { initialUrl: '/join?invite=mock-0123' });
    await waitFor(() => expect(screen).toHavePathname('/'));
    expect(screen.queryByText('Joining the room…')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('says it’s joining while the server checks the invite', async () => {
    let release: (result: RpcResult<{ code: string }>) => void = () => {};
    jest.spyOn(MockRoomServer.prototype, 'joinRoomByInvite').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await signIn();
    await act(async () => {
      router.push({ pathname: '/join', params: { invite: 'mock-held' } });
    });
    expect(await screen.findByText('Joining the room…')).toBeVisible();
    expect(screen.queryByLabelText('Go to Home')).toBeNull();
    await act(async () => {
      release({ ok: true, value: { code: ROOM } });
    });
    await waitFor(() => expect(screen).toHavePathname(`/room/${ROOM}`));
  });

  it.each([
    [{ code: 'room_full' }, 'That room is full. Rooms hold up to 15 people.'],
    [{ code: 'room_ended' }, 'That room has ended. Ask the host for a new code.'],
    [
      { code: 'rate_limited', retryAfterSeconds: 30 },
      'Too many tries. Wait 30 seconds, then try again.',
    ],
    [{ code: 'profile_incomplete' }, 'Finish your profile before joining a room.'],
    [{ code: 'not_authenticated' }, 'Sign in again to join a room.'],
    [{ code: 'stale_state' }, 'Couldn’t join right now. Try again.'],
  ] as const)('explains %o in words', async (error, words) => {
    jest
      .spyOn(MockRoomServer.prototype, 'joinRoomByInvite')
      .mockResolvedValue({ ok: false, error } as RpcResult<{ code: string }>);
    await signIn();
    await act(async () => {
      router.push({ pathname: '/join', params: { invite: 'mock-any' } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
    expect(screen.queryByText(new RegExp(error.code))).toBeNull();
    expect(screen.getByLabelText('Go to Home')).toBeVisible();
  });

  it('says a wrong token doesn’t work and offers Home', async () => {
    await signIn();
    await act(async () => {
      router.push({ pathname: '/join', params: { invite: 'mock-wrong' } });
    });
    expect(await screen.findByText('Couldn’t join.')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This invite doesn’t work anymore. It may have expired, or the host made a new one. Ask the host for a new link or the room code.',
    );
    await press('Go to Home');
    expect(screen).toHavePathname('/home');
  });
});
