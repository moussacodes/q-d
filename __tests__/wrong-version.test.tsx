import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { overrideTrackMatchRpc } from '@/features/room/overrideTrackMatch';
import { versions } from '@/providers';
import { fillEmailForm } from '@/test/emailForm';

// "Wrong version?" host override (Forge card). The host corrects a match the
// matcher got wrong (PRODUCT_SPEC.md §6, rule 8). Mock mode: the versions are
// labeled mock, and the store stands in for `override_track_match`.
jest.setTimeout(60_000);

const press = async (label: string | RegExp) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const signIn = async () => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await fillEmailForm();
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
};

const openRoom = async (view?: string) => {
  await act(async () => {
    router.push({
      pathname: '/room/[code]',
      params: view ? { code: 'QD-7K4F9X', view } : { code: 'QD-7K4F9X' },
    });
  });
};

const openSheet = async (entry: string, view?: string) => {
  await act(async () => {
    router.push({
      pathname: '/room/[code]/version',
      params: view ? { code: 'QD-7K4F9X', view, entry } : { code: 'QD-7K4F9X', entry },
    });
  });
};

const skip = async (count: number) => {
  for (let i = 0; i < count; i += 1) await press('Skip');
};

const WRONG_VERSION = 'Wrong version? Pick the right one';
// Way Bigger's versions on Spotify (src/providers/mock/matches.ts).
const closest = /^Way Bigger, Don Toliver · Mock Compilation · 3:23, Clean/;
const radioEdit = /^Way Bigger - Radio Edit, Don Toliver · Single · 3:01, Radio edit, Clean/;
const spedUp = /^Way Bigger - Sped Up, Don Toliver · Single · 2:36, Sped up, Clean/;
const live = /^Way Bigger \(Live\), Don Toliver · Mock Live Sessions · 3:16, Live, Explicit/;

const useButton = () => screen.getByLabelText('Use this version');

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the host fixes a low-confidence match', () => {
  it('lists the service’s versions, labeled mock, what’s playing first', async () => {
    await signIn();
    await openRoom('uncertain');
    await press(WRONG_VERSION);

    expect(
      await screen.findByText('Pick the version of “Way Bigger” to play on Spotify.'),
    ).toBeVisible();
    expect(
      screen.getByText('Mock versions for testing. They aren’t from Spotify’s catalog.'),
    ).toBeVisible();
    const radios = await screen.findAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(radios[0]).toHaveAccessibleName(
      'Way Bigger, Don Toliver · Mock Compilation · 3:23, Clean, Playing now',
    );
    expect(screen.getByLabelText(radioEdit)).toBeVisible();
    expect(screen.getByLabelText(spedUp)).toBeVisible();
    expect(screen.getByLabelText(live)).toBeVisible();
    // Version, explicit and status tags are visible text too.
    expect(screen.getByText('Radio edit')).toBeVisible();
    expect(screen.getByText('Explicit')).toBeVisible();
    expect(screen.getByText('Playing now')).toBeVisible();
    expect(
      screen.getByText(
        'This play finishes as it started. Your pick plays from the next time this song comes up, for everyone in the room.',
      ),
    ).toBeVisible();
  });

  it('saves the pick: the warning clears, and the song keeps playing as it started', async () => {
    await signIn();
    await openRoom('uncertain');
    expect(await screen.findByText('Might be a different version')).toBeVisible();
    await press(WRONG_VERSION);

    // Nothing is picked yet, and re-picking what plays next changes nothing.
    expect(await screen.findByLabelText(radioEdit)).toBeVisible();
    expect(useButton()).toBeDisabled();
    await press(closest);
    expect(screen.getByLabelText(closest)).toBeSelected();
    expect(useButton()).toBeDisabled();

    await press(radioEdit);
    expect(screen.getByLabelText(radioEdit)).toBeSelected();
    expect(screen.getByLabelText(closest)).not.toBeSelected();
    // Radio semantics: the choice is announced as checked, the others as not.
    expect(screen.getByRole('radio', { checked: true })).toHaveAccessibleName(radioEdit);
    expect(screen.getAllByRole('radio', { checked: false })).toHaveLength(3);
    expect(useButton()).toBeEnabled();
    await press('Use this version');

    await waitFor(() => expect(screen).toHavePathname('/room/QD-7K4F9X'));
    expect(await screen.findByText('You picked a different version')).toBeVisible();
    expect(
      screen.getByText(
        'This play finishes as it started. Your pick plays on Spotify from the next time this song comes up.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('Might be a different version')).toBeNull();
    expect(screen.queryByLabelText(WRONG_VERSION)).toBeNull();
    // No swap mid-song: the same song plays on, with every control on.
    expect(screen.getByText('Way Bigger')).toBeVisible();
    expect(screen.getByLabelText('Pause')).toBeEnabled();
  });

  it('can change the pick, and shows the current pick', async () => {
    await signIn();
    await openRoom('uncertain');
    await press(WRONG_VERSION);
    await press(radioEdit);
    await press('Use this version');
    await press('Change the version you picked');

    expect(await screen.findByText('Your pick')).toBeVisible();
    // What's playing first, then the pick, then the rest.
    expect((await screen.findAllByRole('radio')).map((r) => r.props.accessibilityLabel)).toEqual([
      expect.stringMatching(closest),
      expect.stringMatching(radioEdit),
      expect.stringMatching(spedUp),
      expect.stringMatching(live),
    ]);
    expect(screen.getByLabelText(radioEdit)).toHaveAccessibleName(
      'Way Bigger - Radio Edit, Don Toliver · Single · 3:01, Radio edit, Clean, Your pick',
    );
    // The pick is what plays next, so choosing it again saves nothing.
    await press(radioEdit);
    expect(useButton()).toBeDisabled();
    await press(spedUp);
    await press('Use this version');
    await waitFor(() => expect(screen).toHavePathname('/room/QD-7K4F9X'));
    await press('Change the version you picked');
    expect(await screen.findByLabelText(spedUp)).toHaveAccessibleName(/, Your pick$/);
  });

  it('Cancel closes the sheet and changes nothing', async () => {
    await signIn();
    await openRoom('uncertain');
    await press(WRONG_VERSION);
    await press(radioEdit);
    await press('Cancel');
    await waitFor(() => expect(screen).toHavePathname('/room/QD-7K4F9X'));
    expect(await screen.findByText('Might be a different version')).toBeVisible();
    expect(screen.queryByText('You picked a different version')).toBeNull();
  });

  it('Close (×) closes the sheet too', async () => {
    await signIn();
    await openRoom('uncertain');
    await press(WRONG_VERSION);
    await screen.findByLabelText(radioEdit);
    await press('Close');
    expect(await screen.findByText('Might be a different version')).toBeVisible();
  });

  it('fixes an explicit/clean conflict with the clean radio edit', async () => {
    await signIn();
    await act(async () => {
      router.push({
        pathname: '/room/[code]/add-song',
        params: { code: 'QD-7K4F9X', view: 'empty' },
      });
    });
    await press('Add Ocho Rios');
    await openRoom('empty');
    expect(await screen.findByText('Explicit/clean version differs')).toBeVisible();
    await press(WRONG_VERSION);

    const radios = await screen.findAllByRole('radio');
    // What's playing comes first, then the rest in the matcher's order (which
    // ranks the version without an explicit/clean conflict above it).
    expect(radios.map((radio) => radio.props.accessibilityLabel)).toEqual([
      'Ocho Rios, Daniel Caesar · Never Enough · 2:33, Explicit, Playing now',
      'Ocho Rios - Radio Edit, Daniel Caesar · Never Enough · 2:21, Radio edit, Clean',
      expect.stringMatching(/^Ocho Rios \(Live\), .*, Live, Explicit$/),
    ]);
    await press(/^Ocho Rios - Radio Edit/);
    await press('Use this version');
    expect(await screen.findByText('You picked a different version')).toBeVisible();
    expect(screen.queryByText('Explicit/clean version differs')).toBeNull();
  });
});

describe('the pick applies from the next time the song comes up', () => {
  it('a queued song plays the pick with no warning, and the queue says the host picked it', async () => {
    await signIn();
    await openRoom();
    expect(await screen.findByText('May be another version on Spotify')).toBeVisible();

    await openSheet('QD-7K4F9X/q5');
    expect(
      await screen.findByText('Your pick plays when this song comes up, for everyone in the room.'),
    ).toBeVisible();
    expect(await screen.findByText('Current match')).toBeVisible();
    await press(radioEdit);
    await press('Use this version');

    await waitFor(() => expect(screen).toHavePathname('/room/QD-7K4F9X'));
    expect(await screen.findByText('Version picked by the host')).toBeVisible();
    expect(screen.queryByText('May be another version on Spotify')).toBeNull();

    // When it comes up, it plays as picked: no warning, nothing to fix.
    await skip(5);
    expect(await screen.findByText('Way Bigger')).toBeVisible();
    expect(screen.queryByText('Might be a different version')).toBeNull();
    expect(screen.queryByText('You picked a different version')).toBeNull();
    expect(screen.queryByLabelText(WRONG_VERSION)).toBeNull();
    await waitFor(() => expect(screen.getByLabelText('Pause')).toBeEnabled());
  });

  it('the same song added again later plays the pick too', async () => {
    await signIn();
    await openRoom('uncertain');
    await press(WRONG_VERSION);
    await press(radioEdit);
    await press('Use this version');
    await screen.findByText('You picked a different version');

    // Add Way Bigger again: the new copy carries the pick.
    await act(async () => {
      router.push({
        pathname: '/room/[code]/add-song',
        params: { code: 'QD-7K4F9X', view: 'uncertain' },
      });
    });
    await act(async () => {
      fireEvent.changeText(await screen.findByLabelText('Search'), 'way bigger');
    });
    await press('Add Way Bigger');
    await press('Add Way Bigger again');
    await openRoom('uncertain');
    expect(await screen.findByText('Version picked by the host')).toBeVisible();
  });
});

describe('listeners', () => {
  it('see the warning but never “Wrong version?”', async () => {
    await signIn();
    await openRoom();
    await screen.findByText('7 songs');
    await skip(5);
    expect(await screen.findByLabelText(WRONG_VERSION)).toBeVisible();

    await openRoom('listener');
    expect(await screen.findByText('Might be a different version')).toBeVisible();
    expect(screen.queryByLabelText(WRONG_VERSION)).toBeNull();
    expect(screen.queryByText('Wrong version?')).toBeNull();
  });

  it('are told plainly when the host picked a different version', async () => {
    await signIn();
    await openRoom();
    await screen.findByText('7 songs');
    await skip(5);
    await press(WRONG_VERSION);
    await press(radioEdit);
    await press('Use this version');
    await screen.findByText('You picked a different version');

    await openRoom('listener');
    expect(await screen.findByText('The host picked a different version')).toBeVisible();
    expect(
      screen.getByText(
        'This play finishes as it started. The host’s pick plays from the next time this song comes up.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('Might be a different version')).toBeNull();
    expect(screen.queryByLabelText('Change the version you picked')).toBeNull();
  });

  it('see “Version picked by the host” on a queued song', async () => {
    await signIn();
    await openSheet('QD-7K4F9X/q5');
    await press(radioEdit);
    await press('Use this version');
    await openRoom('listener');
    expect(await screen.findByText('Version picked by the host')).toBeVisible();
  });

  it('opening the sheet by link only says the host picks versions', async () => {
    await signIn();
    await openSheet('QD-7K4F9X/q5', 'listener');
    expect(await screen.findByText('Only the host can pick a different version.')).toBeVisible();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByLabelText('Use this version')).toBeNull();
  });
});

describe('loading and errors', () => {
  it('says it’s finding versions, with nothing to save yet', async () => {
    jest.spyOn(versions, 'versions').mockReturnValue(new Promise(() => {}));
    await signIn();
    await openRoom('uncertain');
    await press(WRONG_VERSION);
    expect(await screen.findByText('Finding versions on Spotify…')).toBeVisible();
    expect(useButton()).toBeDisabled();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('says loading failed, and Try again loads them', async () => {
    jest.spyOn(versions, 'versions').mockRejectedValueOnce(new Error('offline'));
    await signIn();
    await openRoom('uncertain');
    await press(WRONG_VERSION);
    expect(
      await screen.findByText(
        'Couldn’t load versions from Spotify. Check your connection, then try again.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('radio')).toBeNull();
    await press('Try again');
    expect(await screen.findByLabelText(radioEdit)).toBeVisible();
    expect(screen.queryByText(/Couldn’t load versions/)).toBeNull();
  });

  it('says when the service has no versions at all', async () => {
    const real = versions.versions.bind(versions);
    jest.spyOn(versions, 'versions').mockImplementation(async (recordingId, provider) => ({
      ...(await real(recordingId, provider)),
      candidates: [],
    }));
    await signIn();
    await openRoom('uncertain');
    await press(WRONG_VERSION);
    expect(await screen.findByText('Spotify has no versions of this song.')).toBeVisible();
    expect(useButton()).toBeDisabled();
  });

  it('shows Saving… and locks the sheet while the pick is saved', async () => {
    jest.spyOn(overrideTrackMatchRpc, 'call').mockReturnValue(new Promise(() => {}));
    await signIn();
    await openRoom('uncertain');
    await press(WRONG_VERSION);
    await press(radioEdit);
    await press('Use this version');
    const saving = await screen.findByLabelText('Saving…');
    expect(saving).toBeDisabled();
    expect(saving).toBeBusy();
    expect(screen.getByLabelText('Cancel')).toBeDisabled();
    expect(screen.getByLabelText(spedUp)).toBeDisabled();
  });

  it('says saving failed, keeps the choice, and saves on a retry', async () => {
    jest.spyOn(overrideTrackMatchRpc, 'call').mockRejectedValueOnce(new Error('offline'));
    await signIn();
    await openRoom('uncertain');
    await press(WRONG_VERSION);
    await press(radioEdit);
    await press('Use this version');
    expect(
      await screen.findByText('Couldn’t save your pick. Check your connection, then try again.'),
    ).toBeVisible();
    expect(screen).toHavePathname('/room/QD-7K4F9X/version');
    expect(screen.getByLabelText(radioEdit)).toBeSelected();
    expect(useButton()).toBeEnabled();

    await press('Use this version');
    await waitFor(() => expect(screen).toHavePathname('/room/QD-7K4F9X'));
    expect(await screen.findByText('You picked a different version')).toBeVisible();
  });

  it('says so when the song left the room before the pick was saved', async () => {
    jest
      .spyOn(overrideTrackMatchRpc, 'call')
      .mockResolvedValueOnce({ ok: false, error: 'invalid_input', field: 'recording_id' });
    await signIn();
    await openRoom('uncertain');
    await press(WRONG_VERSION);
    await press(radioEdit);
    await press('Use this version');
    expect(
      await screen.findByText(
        'That song isn’t in the room anymore, so q’d couldn’t save your pick.',
      ),
    ).toBeVisible();
  });

  it('a song that isn’t playing or queued anymore can’t be changed', async () => {
    await signIn();
    await openSheet('QD-7K4F9X/gone');
    expect(
      await screen.findByText('This song isn’t playing or in the queue anymore.'),
    ).toBeVisible();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
