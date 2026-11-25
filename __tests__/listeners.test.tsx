import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';
import { fillEmailForm } from '@/test/emailForm';

// 3.6 Listeners (Forge card "Listener management screen"): who's in the room,
// and the room rules. The host changes the rules and picks chosen people;
// everyone else reads them.
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

const open = async (pathname: '/room/[code]' | '/room/[code]/listeners', view?: string) => {
  await act(async () => {
    router.push({ pathname, params: view ? { code: 'QD-7K4F9X', view } : { code: 'QD-7K4F9X' } });
  });
};

/** The rule tab ("Everyone", "Chosen", "Only you") for Add songs (0) or controls (1). */
const pickRule = async (rule: 0 | 1, choice: 'Everyone' | 'Chosen' | 'Only you') => {
  await act(async () => {
    fireEvent.press(screen.getAllByRole('tab', { name: choice })[rule]);
  });
};

const people = ['Baron (you)', 'Maya', 'Jules', 'Priya', 'Theo', 'Sam'];

describe('the host', () => {
  it('sees everyone in the room, with the host first and marked', async () => {
    await signIn();
    await open('/room/[code]/listeners');
    expect(await screen.findByText('Listeners')).toBeVisible();
    expect(screen.getByText('6 people in the room')).toBeVisible();
    for (const name of people) {
      expect(screen.getByText(name)).toBeVisible();
    }
    expect(screen.getByText('Host · plays the music')).toBeVisible();
    expect(screen.getAllByText('In the room')).toHaveLength(5);
    expect(screen.getByText('Host')).toBeVisible();
    // The host's row names the service the room plays through.
    expect(screen.getByText('Spotify')).toBeVisible();
  });

  it('names the service the room plays through, not the host’s usual one', async () => {
    await signIn();
    await open('/room/[code]/listeners', 'apple');
    expect(await screen.findByText('Apple Music')).toBeVisible();
    expect(screen.queryByText('Spotify')).toBeNull();
  });

  it('starts with the default rules and no chips to choose people', async () => {
    await signIn();
    await open('/room/[code]/listeners');
    await screen.findByText('Room rules');
    const selected = screen
      .getAllByRole('tab')
      .filter((tab) => tab.props.accessibilityState?.selected);
    expect(selected.map((tab) => within(tab).getByText(/./).props.children)).toEqual([
      'Everyone',
      'Only you',
    ]);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryByText(/Tap the chips/)).toBeNull();
  });

  it('chooses people for a rule, and keeps them when switching away and back', async () => {
    await signIn();
    await open('/room/[code]/listeners');
    await screen.findByText('Room rules');

    await pickRule(1, 'Chosen');
    expect(screen.getByText('Tap the chips next to people below to choose them.')).toBeVisible();
    // One chip per person except the host.
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    const maya = screen.getByLabelText('Maya can play, skip, reorder and remove');
    expect(maya).not.toBeChecked();

    await press('Maya can play, skip, reorder and remove');
    expect(screen.getByLabelText('Maya can play, skip, reorder and remove')).toBeChecked();

    await pickRule(1, 'Only you');
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    await pickRule(1, 'Chosen');
    expect(screen.getByLabelText('Maya can play, skip, reorder and remove')).toBeChecked();
    expect(screen.getByLabelText('Jules can play, skip, reorder and remove')).not.toBeChecked();
  });

  it('shows one chip per Chosen rule', async () => {
    await signIn();
    await open('/room/[code]/listeners');
    await screen.findByText('Room rules');
    await pickRule(0, 'Chosen');
    await pickRule(1, 'Chosen');
    expect(screen.getAllByRole('checkbox')).toHaveLength(10);
    expect(screen.getByLabelText('Sam can add songs')).toBeVisible();
    expect(screen.getByLabelText('Sam can play, skip, reorder and remove')).toBeVisible();
  });

  it('is told to invite people first when nobody else is here', async () => {
    await signIn();
    await open('/room/[code]/listeners', 'empty');
    expect(await screen.findByText('1 person in the room')).toBeVisible();
    expect(screen.getByText('Baron (you)')).toBeVisible();
    expect(screen.queryByText(/Nobody else is here yet/)).toBeNull();

    await pickRule(0, 'Chosen');
    expect(
      screen.getByText('Nobody else is here yet. Invite people, then choose them here.'),
    ).toBeVisible();
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
  });

  it('opens it from the people strip in the room', async () => {
    await signIn();
    await open('/room/[code]', 'empty');
    await press('People in this room');
    expect(screen).toHavePathname('/room/QD-7K4F9X/listeners');
    expect(await screen.findByText('1 person in the room')).toBeVisible();
  });
});

describe('a listener', () => {
  it('reads the rules as text and can’t change them', async () => {
    await signIn();
    await open('/room/[code]/listeners', 'listener');
    expect(await screen.findByText('Maya (you)')).toBeVisible();
    expect(screen.getByText('Baron')).toBeVisible();
    expect(screen.getByText('6 people in the room')).toBeVisible();
    expect(screen.getByText('Everyone')).toBeVisible();
    expect(screen.getByText('Host only')).toBeVisible();
    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
  });

  it('sees when the host chose them', async () => {
    await signIn();
    await open('/room/[code]/listeners');
    await screen.findByText('Room rules');
    await pickRule(1, 'Chosen');
    await press('Maya can play, skip, reorder and remove');

    await open('/room/[code]/listeners', 'listener');
    expect(await screen.findByText('Chosen people (incl. you)')).toBeVisible();
  });

  it('opens it from the room’s options button', async () => {
    await signIn();
    await open('/room/[code]', 'listener');
    await press('Room options');
    expect(screen).toHavePathname('/room/QD-7K4F9X/listeners');
    expect(await screen.findByText('Maya (you)')).toBeVisible();
  });
});
