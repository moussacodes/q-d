import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import type { RpcResult } from '@/domain/rpc-error';
import { MockRoomServer } from '@/features/room/mockServer';

// 2.4 Start a room (Forge card "Create room and join room screens (Figma)"):
// a name of 1–40 characters after trimming, the two room rules, and the
// service this phone plays through. The room is always aux.
jest.setTimeout(60_000);

afterEach(() => jest.restoreAllMocks());

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const typeName = async (text: string) => {
  await act(async () => {
    fireEvent.changeText(await screen.findByLabelText('Room name'), text);
  });
};

/** The rule tab ("Everyone", "Chosen", "Only you") for Add songs (0) or controls (1). */
const pickRule = async (rule: 0 | 1, choice: 'Everyone' | 'Chosen' | 'Only you') => {
  await act(async () => {
    fireEvent.press(screen.getAllByRole('tab', { name: choice })[rule]);
  });
};

const selectedRules = () =>
  screen
    .getAllByRole('tab')
    .filter((tab) => tab.props.accessibilityState?.selected)
    .map((tab) => within(tab).getByText(/./).props.children);

const startButton = () => screen.getByLabelText('Start room');

/** A returning user (Spotify connected) on Start a room. */
const openStartRoom = async () => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
  await act(async () => {
    router.push('/create-room');
  });
  await screen.findByLabelText('Room name');
};

describe('the room name', () => {
  it('starts filled in, so Start room is ready', async () => {
    await openStartRoom();
    expect(screen.getByLabelText('Room name').props.value).toBe('Sunday Slow Burn');
    expect(startButton()).toBeEnabled();
  });

  it('can’t be blank or only spaces', async () => {
    await openStartRoom();
    await typeName('   ');
    expect(screen.getByText('Give the room a name.')).toBeVisible();
    expect(startButton()).toBeDisabled();
    expect(startButton().props.accessibilityState).toMatchObject({ disabled: true });

    await typeName('Friday Fade');
    expect(screen.queryByText('Give the room a name.')).toBeNull();
    expect(startButton()).toBeEnabled();
  });

  it('stops at 40 characters', async () => {
    await openStartRoom();
    const field = screen.getByLabelText('Room name');
    expect(field.props.maxLength).toBe(40);
    expect(field.props.accessibilityHint).toBe('Up to 40 characters');

    // A paste can get past maxLength on some keyboards; the rule still holds.
    await typeName('a'.repeat(41));
    expect(screen.getByText('Room names can be up to 40 characters.')).toBeVisible();
    expect(startButton()).toBeDisabled();

    await typeName(`  ${'a'.repeat(40)}  `);
    expect(screen.queryByText(/Room names can be/)).toBeNull();
    expect(startButton()).toBeEnabled();
  });

  it('is trimmed when the room starts', async () => {
    const spy = jest.spyOn(MockRoomServer.prototype, 'createRoom');
    await openStartRoom();
    await typeName('  Friday Fade  ');
    await press('Start room');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Friday Fade', playbackProvider: 'spotify', mode: 'aux' }),
    );
    expect(screen).toHavePathname('/room/QD-7K4F9X');
    expect(await screen.findByText('Friday Fade')).toBeVisible();
  });
});

describe('mode', () => {
  it('is always aux and never offers sync', async () => {
    const spy = jest.spyOn(MockRoomServer.prototype, 'createRoom');
    await openStartRoom();
    expect(screen.queryByText(/sync/i)).toBeNull();
    expect(screen.queryByText(/mode/i)).toBeNull();
    await press('Start room');
    expect(spy.mock.calls[0][0].mode).toBe('aux');
  });
});

describe('room rules', () => {
  it('start as everyone adds songs and only you control the music', async () => {
    await openStartRoom();
    expect(selectedRules()).toEqual(['Everyone', 'Only you']);
    expect(screen.getByLabelText('Add songs').props.accessibilityRole).toBe('tablist');
    expect(screen.getByLabelText('Play, skip, reorder, remove').props.accessibilityRole).toBe(
      'tablist',
    );
  });

  it('offer Everyone, Chosen and Only you for each rule', async () => {
    await openStartRoom();
    for (const choice of ['Everyone', 'Chosen', 'Only you'] as const) {
      expect(screen.getAllByRole('tab', { name: choice })).toHaveLength(2);
    }
  });

  it('say where chosen people are picked once a rule is Chosen', async () => {
    await openStartRoom();
    const hint = 'Pick who in Listeners once people join. You can change these rules there too.';
    expect(screen.queryByText(hint)).toBeNull();
    await pickRule(0, 'Chosen');
    expect(screen.getByText(hint)).toBeVisible();
    await pickRule(0, 'Everyone');
    expect(screen.queryByText(hint)).toBeNull();
  });

  it('go to create_room and on to the room', async () => {
    const spy = jest.spyOn(MockRoomServer.prototype, 'createRoom');
    await openStartRoom();
    await pickRule(0, 'Only you');
    await pickRule(1, 'Chosen');
    expect(selectedRules()).toEqual(['Only you', 'Chosen']);
    await press('Start room');

    expect(spy.mock.calls[0][0].rules).toEqual({
      addSongs: { who: 'host', chosen: [] },
      control: { who: 'chosen', chosen: [] },
    });
    // Listeners shows the same rules once the room is up.
    await act(async () => {
      router.push({ pathname: '/room/[code]/listeners', params: { code: 'QD-7K4F9X' } });
    });
    await screen.findByText('Room rules');
    expect(selectedRules()).toEqual(['Only you', 'Chosen']);
  });
});

describe('starting', () => {
  function holdCreate() {
    let release: (result: RpcResult<{ code: string }>) => void = () => {};
    const spy = jest.spyOn(MockRoomServer.prototype, 'createRoom').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    return { spy, release: (result: RpcResult<{ code: string }>) => release(result) };
  }

  it('says Starting… and ignores more taps until the server answers', async () => {
    const { spy, release } = holdCreate();
    await openStartRoom();
    await press('Start room');

    expect(screen.getByText('Starting…')).toBeVisible();
    expect(startButton()).toBeDisabled();
    expect(startButton().props.accessibilityState).toMatchObject({ busy: true });
    await press('Start room');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen).toHavePathname('/create-room');

    await act(async () => {
      release({ ok: true, value: { code: 'QD-7K4F9X' } });
    });
    expect(screen).toHavePathname('/room/QD-7K4F9X');
  });

  it('shows the server’s error and lets you try again', async () => {
    const { release } = holdCreate();
    await openStartRoom();
    await press('Start room');
    await act(async () => {
      release({ ok: false, error: { code: 'provider_required' } });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Connect a music service to start a room.');
    expect(screen.getByText('Start room')).toBeVisible();
    expect(startButton()).toBeEnabled();
    expect(screen).toHavePathname('/create-room');
  });

  it('never shows a raw error code', async () => {
    const { release } = holdCreate();
    await openStartRoom();
    await press('Start room');
    await act(async () => {
      release({ ok: false, error: { code: 'feature_disabled' } });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Couldn’t start the room right now. Try again.',
    );
    expect(screen.queryByText(/feature_disabled/)).toBeNull();
  });

  it.each([
    ['profile_incomplete', 'Finish your profile before starting a room.'],
    ['invalid_input', 'Room names need 1 to 40 characters.'],
  ] as const)('explains %s in words', async (code, words) => {
    const { release } = holdCreate();
    await openStartRoom();
    await press('Start room');
    await act(async () => {
      release({ ok: false, error: { code } });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(words);
    expect(screen.queryByText(new RegExp(code))).toBeNull();
  });

  it('says how long to wait when rate limited', async () => {
    const { release } = holdCreate();
    await openStartRoom();
    await press('Start room');
    await act(async () => {
      release({ ok: false, error: { code: 'rate_limited', retryAfterSeconds: 1 } });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Too many tries. Wait 1 second, then try again.',
    );
  });

  it('turns Start room back on if the call throws instead of answering', async () => {
    const spy = jest
      .spyOn(MockRoomServer.prototype, 'createRoom')
      .mockRejectedValueOnce(new Error('network'));
    await openStartRoom();
    await press('Start room');
    expect(screen).toHavePathname('/create-room');
    expect(startButton()).toBeEnabled();
    expect(screen.getByText('Start room')).toBeVisible();
    await press('Start room');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen).toHavePathname('/room/QD-7K4F9X');
  });
});

describe('a host needs a service', () => {
  it('keeps Start room off until one is connected, and never calls create_room', async () => {
    const spy = jest.spyOn(MockRoomServer.prototype, 'createRoom');
    await openStartRoom();
    // Disconnect the returning account's Spotify in Settings.
    await act(async () => {
      router.push('/settings');
    });
    await press('Disconnect Spotify');
    await act(async () => {
      router.push('/create-room');
    });
    expect(await screen.findByText('Connect a music service to host')).toBeVisible();
    const buttons = screen.getAllByLabelText('Start room');
    const start = buttons[buttons.length - 1];
    expect(start).toBeDisabled();
    await act(async () => {
      fireEvent.press(start);
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
