import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import type { RpcResult } from '@/domain/rpc-error';
import { MOCK_JOIN_ATTEMPTS, MockRoomServer } from '@/features/room/mockServer';

// Join with a code happens on Home: there's no separate join screen. The mock
// join_room_by_code answers like the contract: sample rooms open, QD-FULL22
// is full, QD-ENDED2 has ended, and any other code is wrong or expired.
jest.setTimeout(60_000);

afterEach(() => jest.restoreAllMocks());

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const typeCode = async (text: string) => {
  await act(async () => {
    fireEvent.changeText(await screen.findByLabelText('Room code'), text);
  });
};

const field = () => screen.getByLabelText('Room code');
const joinButton = () => screen.getByLabelText('Join');

/** A returning user on Home. */
const signIn = async () => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
};

/** Holds the next mock join answer until the test lets it go. */
function holdJoin() {
  let release: (result: RpcResult<{ code: string }>) => void = () => {};
  const spy = jest.spyOn(MockRoomServer.prototype, 'joinRoomByCode').mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  return { spy, release: (result: RpcResult<{ code: string }>) => release(result) };
}

describe('joining from Home', () => {
  it('waits for all six characters', async () => {
    await signIn();
    await typeCode('9M2XR');
    expect(joinButton()).toBeDisabled();
    await press('Join');
    expect(screen).toHavePathname('/home');
  });

  it('opens the room for a pasted code, and Back returns Home', async () => {
    await signIn();
    await typeCode('QD-9m2xr4');
    expect(field().props.value).toBe('9M2XR4');
    expect(joinButton()).toBeEnabled();

    await press('Join');
    expect(screen).toHavePathname('/room/QD-9M2XR4');
    expect(await screen.findByText('Kitchen Disco')).toBeVisible();

    await act(async () => {
      router.back();
    });
    expect(screen).toHavePathname('/home');
    expect(field().props.value).toBe('');
  });

  it('opens it from the keyboard too', async () => {
    await signIn();
    await typeCode('3HV8PL');
    await act(async () => {
      fireEvent(field(), 'submitEditing');
    });
    expect(screen).toHavePathname('/room/QD-3HV8PL');
  });

  it('labels the field and the button for screen readers', async () => {
    await signIn();
    expect(field().props.accessibilityHint).toBe('Six characters from the host, like 7K4F9X');
    expect(joinButton().props.accessibilityRole).toBe('button');
    expect(joinButton().props.accessibilityState).toMatchObject({ disabled: true, busy: false });
  });
});

describe('codes that can’t be right', () => {
  it('points out look-alike characters no code uses and keeps Join off', async () => {
    await signIn();
    await typeCode('9M2XR0');
    expect(field().props.value).toBe('9M2XR0');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Room codes don’t use 0, O, 1 or I. Check the code with the host.',
    );
    expect(joinButton()).toBeDisabled();

    await typeCode('9M2XR4');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(joinButton()).toBeEnabled();
  });

  it('doesn’t call the server from the keyboard either', async () => {
    const spy = jest.spyOn(MockRoomServer.prototype, 'joinRoomByCode');
    await signIn();
    await typeCode('OOOOOO');
    await act(async () => {
      fireEvent(field(), 'submitEditing');
    });
    expect(spy).not.toHaveBeenCalled();
    expect(screen).toHavePathname('/home');
  });
});

describe('errors the server answers with', () => {
  const tryCode = async (code: string) => {
    await typeCode(code);
    await press('Join');
  };

  it('says a wrong code may be mistyped or expired, and stays on Home', async () => {
    await signIn();
    await tryCode('ZZZZZZ');
    expect(screen).toHavePathname('/home');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code doesn’t match a room. It may be mistyped or expired, so check it with the host.',
    );
    // The code stays so it can be fixed.
    expect(field().props.value).toBe('ZZZZZZ');
  });

  it('answers an expired code with exactly the same words', async () => {
    await signIn();
    await tryCode('ZZZZZZ');
    const wrong = (await screen.findByRole('alert')).props.children;
    await tryCode('QD-STALE2');
    expect((await screen.findByRole('alert')).props.children).toBe(wrong);
  });

  it('says when the room is full', async () => {
    await signIn();
    await tryCode('QD-FULL22');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That room is full. Rooms hold up to 15 people.',
    );
    expect(screen).toHavePathname('/home');
  });

  it('says when the room has ended', async () => {
    await signIn();
    await tryCode('ENDED2');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That room has ended. Ask the host for a new code.',
    );
    expect(screen).toHavePathname('/home');
  });

  it('clears the error once the code changes', async () => {
    await signIn();
    await tryCode('ZZZZZZ');
    await screen.findByRole('alert');
    await typeCode('ZZZZZ');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it(`asks you to wait after ${MOCK_JOIN_ATTEMPTS} wrong codes, even for a right one`, async () => {
    await signIn();
    for (let i = 0; i < MOCK_JOIN_ATTEMPTS; i++) {
      await tryCode(i % 2 ? 'ZZZZZZ' : 'YYYYYY');
    }
    await tryCode('9M2XR4');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Too many tries\. Wait \d+ seconds?, then try again\.$/,
    );
    expect(screen).toHavePathname('/home');
  });
});

describe('while joining', () => {
  it('shows the code it’s joining and turns the field and the button off', async () => {
    const { spy, release } = holdJoin();
    await signIn();
    await typeCode('9m2xr4');
    await press('Join');

    expect(screen.getByText('Joining QD-9M2XR4…')).toBeVisible();
    expect(joinButton()).toBeDisabled();
    expect(joinButton().props.accessibilityState).toMatchObject({ busy: true });
    expect(field().props.editable).toBe(false);
    expect(screen).toHavePathname('/home');

    // A second tap while the first is out sends nothing.
    await press('Join');
    await act(async () => {
      fireEvent(field(), 'submitEditing');
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ code: '9M2XR4' });
    expect(spy.mock.calls[0][0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);

    await act(async () => {
      release({ ok: true, value: { code: 'QD-9M2XR4' } });
    });
    expect(screen).toHavePathname('/room/QD-9M2XR4');
  });

  it('turns everything back on when the answer is an error', async () => {
    const { release } = holdJoin();
    await signIn();
    await typeCode('9M2XR4');
    await press('Join');
    await act(async () => {
      release({ ok: false, error: { code: 'room_full' } });
    });
    expect(screen.queryByText(/^Joining/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'That room is full. Rooms hold up to 15 people.',
    );
    expect(joinButton()).toBeEnabled();
    expect(field().props.editable).toBe(true);
  });

  it.each([
    ['profile_incomplete', 'Finish your profile before joining a room.'],
    ['not_authenticated', 'Sign in again to join a room.'],
    ['stale_state', 'Couldn’t join right now. Try again.'],
  ] as const)('explains %s in words, never the raw code', async (code, words) => {
    const { release } = holdJoin();
    await signIn();
    await typeCode('9M2XR4');
    await press('Join');
    await act(async () => {
      release({ ok: false, error: { code } });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(words);
    expect(screen.queryByText(new RegExp(code))).toBeNull();
    expect(screen).toHavePathname('/home');
  });

  it('turns the field and the button back on if the call throws', async () => {
    const spy = jest
      .spyOn(MockRoomServer.prototype, 'joinRoomByCode')
      .mockRejectedValueOnce(new Error('network'));
    await signIn();
    await typeCode('9M2XR4');
    await press('Join');
    expect(screen.queryByText(/^Joining/)).toBeNull();
    expect(joinButton()).toBeEnabled();
    expect(field().props.editable).toBe(true);
    await press('Join');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen).toHavePathname('/room/QD-9M2XR4');
  });

  it('uses a new idempotency key for each tap', async () => {
    const spy = jest.spyOn(MockRoomServer.prototype, 'joinRoomByCode');
    await signIn();
    await typeCode('ZZZZZZ');
    await press('Join');
    await press('Join');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0].idempotencyKey).not.toBe(spy.mock.calls[1][0].idempotencyKey);
  });
});
