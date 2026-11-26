import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { addLogSink, type LogEntry } from '@/services/logger';
import {
  completeProfile,
  createFakeSupabase,
  fakeSession,
  flushAuthEvents,
  type FakeSupabase,
} from '@/test/fakeSupabase';

// Save onboarding profile to Supabase (live mode). Supabase is faked at the
// service boundary; the screens, AuthSync, the session, useProfileSave and
// services/profiles.ts are the real ones. The fake keeps what was written,
// so a "restart" reads back the saved profile like the real table would.
jest.setTimeout(60_000);

let mockSupabase: FakeSupabase;

jest.mock('@/services/dataMode', () => ({
  ...jest.requireActual('@/services/dataMode'),
  authMode: 'live',
  isLiveAuth: true,
}));

jest.mock('@/services/supabase', () => ({
  ...jest.requireActual('@/services/supabase'),
  getSupabase: () => mockSupabase.client,
  startSessionAutoRefresh: () => () => {},
}));

const CANARY_NAME = 'Canary Profilename';

let entries: LogEntry[];
let consoleOutput: unknown[][];
let removeSink: () => void;

beforeEach(() => {
  mockSupabase = createFakeSupabase();
  entries = [];
  consoleOutput = [];
  removeSink = addLogSink((entry) => entries.push(entry));
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation((...args) => void consoleOutput.push(args));
  }
});

afterEach(() => {
  removeSink();
  jest.restoreAllMocks();
});

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const type = async (label: string, text: string) => {
  await act(async () => {
    fireEvent.changeText(await screen.findByLabelText(label), text);
  });
};

/** A signed-in person whose profile row is still empty, on onboarding step 1. */
async function openOnboarding() {
  mockSupabase.setStoredSession(fakeSession());
  mockSupabase.setProfile(null);
  await renderRouter('./app', { initialUrl: '/' });
  await flushAuthEvents();
  await screen.findByText('What should we call you?');
}

async function fillStepOne(name = 'Sam') {
  await type('Display name', name);
  await press('Color 4 of 6');
  await press('I’m 18 or older');
}

/** Nothing the logger or the console saw holds the display name. */
function expectNameNotLogged(name = CANARY_NAME) {
  expect(JSON.stringify({ entries, consoleOutput })).not.toContain(name);
}

describe('onboarding step 1 in live mode', () => {
  it('saves name, color and 18+ to the person’s own row, then moves on', async () => {
    await openOnboarding();
    await fillStepOne(`  ${CANARY_NAME}  `);
    await press('Continue');

    expect(await screen.findByText('Bring your own music.')).toBeVisible();
    expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
    expect(mockSupabase.profileWrite.update).toHaveBeenCalledTimes(1);
    expect(mockSupabase.profileWrite.update).toHaveBeenCalledWith({
      display_name: CANARY_NAME,
      color: '#8fb4f0',
      adult_confirmed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(mockSupabase.profileWrite.writeProfile).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
    );
    expectNameNotLogged();
  });

  it('finishing onboarding lands on Home with the saved name', async () => {
    await openOnboarding();
    await fillStepOne('Sam');
    await press('Continue');
    await screen.findByText('Bring your own music.');
    await act(async () => {
      fireEvent.press(screen.getByText('Skip'));
    });
    await press('I’ll do this later');
    expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
    expect(screen).toHavePathname('/home');
    expect(screen.getByText(/, Sam\./)).toBeVisible();
  });

  it('after a restart, the saved profile goes straight to Home', async () => {
    await openOnboarding();
    await fillStepOne('Sam');
    await press('Continue');
    await screen.findByText('Bring your own music.');
    expect(mockSupabase.currentProfile()).toMatchObject({
      display_name: 'Sam',
      color: '#8fb4f0',
      adult_confirmed_at: expect.any(String),
    });

    await act(async () => screen.unmount());
    // Same stored session and the row as it was written.
    await renderRouter('./app', { initialUrl: '/' });
    await flushAuthEvents();
    expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
    expect(screen).toHavePathname('/home');
    expect(screen.getByText(/, Sam\./)).toBeVisible();
  });

  it('shows Saving… and sends one write however often Continue is tapped', async () => {
    let answer: (value: unknown) => void = () => {};
    mockSupabase.profileWrite.writeProfile.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)) as never,
    );
    await openOnboarding();
    await fillStepOne();
    await press('Continue');

    const busy = await screen.findByLabelText('Saving…');
    expect(busy).toBeDisabled();
    await act(async () => {
      fireEvent.press(busy);
    });
    expect(mockSupabase.profileWrite.update).toHaveBeenCalledTimes(1);

    await act(async () => answer({ data: [{ id: 'user-1' }], error: null }));
    expect(await screen.findByText('Bring your own music.')).toBeVisible();
  });

  it.each([
    [
      'offline',
      { data: null, error: { message: 'TypeError: Network request failed' } },
      'Couldn’t reach q’d, so nothing was saved. Check your connection and try again.',
    ],
    [
      'the row is not the caller’s any more',
      { data: [], error: null },
      'You’ve been signed out. Sign in again to save your profile.',
    ],
    [
      'the database refused the values',
      {
        data: null,
        error: { code: '23514', message: `Failing row contains (user-1, ${CANARY_NAME}, #8fb4f0)` },
      },
      'q’d couldn’t save that. Check your name and color, then try again.',
    ],
    [
      'anything else',
      { data: null, error: { code: 'XX000', message: 'internal' } },
      'Something went wrong, so nothing was saved. Try again.',
    ],
  ])('stays on step 1 and says so when %s', async (_label, answer, message) => {
    mockSupabase.profileWrite.writeProfile.mockResolvedValueOnce(answer as never);
    await openOnboarding();
    await fillStepOne(CANARY_NAME);
    await press('Continue');

    expect(await screen.findByText(message)).toBeVisible();
    expect(screen).toHavePathname('/onboarding/name');
    expect(screen.getByLabelText('Continue')).toBeEnabled();
    // Nothing was kept: the next sign-in still lands on onboarding.
    expect(mockSupabase.currentProfile()).toBeNull();
    expectNameNotLogged();
  });

  it('a failed save can be tried again, and editing the name clears the message', async () => {
    mockSupabase.profileWrite.writeProfile.mockResolvedValueOnce({
      data: null,
      error: { message: 'Failed to fetch' },
    } as never);
    await openOnboarding();
    await fillStepOne('Sam');
    await press('Continue');
    const message =
      'Couldn’t reach q’d, so nothing was saved. Check your connection and try again.';
    expect(await screen.findByText(message)).toBeVisible();

    await type('Display name', 'Sam B');
    expect(screen.queryByText(message)).toBeNull();
    await press('Continue');
    expect(await screen.findByText('Bring your own music.')).toBeVisible();
    expect(mockSupabase.currentProfile()).toMatchObject({ display_name: 'Sam B' });
  });

  it('a name the database would refuse is stopped before any write', async () => {
    await openOnboarding();
    await fillStepOne('Sam\nSmith');
    await press('Continue');
    expect(await screen.findByText('Take out line breaks and tabs from your name.')).toBeVisible();
    expect(mockSupabase.profileWrite.update).not.toHaveBeenCalled();
  });
});

describe('Settings → Account in live mode', () => {
  async function openAccount() {
    mockSupabase.setStoredSession(fakeSession());
    mockSupabase.setProfile({ ...completeProfile, color: '#f2a27c' });
    await renderRouter('./app', { initialUrl: '/' });
    await flushAuthEvents();
    await screen.findByText('Start a room or jump into one.');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Settings'));
    });
    await act(async () => {
      fireEvent.press(await screen.findByText('Account'));
    });
    await screen.findByText('Change your color');
  }

  const openColors = async () => {
    await act(async () => {
      fireEvent.press(screen.getByText('Change your color'));
    });
  };

  it('a new color is written and then shown', async () => {
    await openAccount();
    await openColors();
    await press('Color 3 of 6');
    expect(mockSupabase.profileWrite.update).toHaveBeenCalledWith({ color: '#e8c547' });
    expect(screen.getByLabelText('Color 3 of 6')).toBeSelected();
  });

  it('a color that wasn’t saved isn’t shown as picked', async () => {
    mockSupabase.profileWrite.writeProfile.mockResolvedValueOnce({
      data: null,
      error: { message: 'Failed to fetch' },
    } as never);
    await openAccount();
    await openColors();
    await press('Color 3 of 6');
    expect(
      await screen.findByText(
        'Couldn’t reach q’d, so nothing was saved. Check your connection and try again.',
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Color 3 of 6')).not.toBeSelected();
    expect(screen.getByLabelText('Color 1 of 6')).toBeSelected();
  });

  it('a second color picked while the first is saving sends nothing', async () => {
    let answer: (value: unknown) => void = () => {};
    mockSupabase.profileWrite.writeProfile.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)) as never,
    );
    await openAccount();
    await openColors();
    await press('Color 3 of 6');
    expect(await screen.findByText('Saving…')).toBeVisible();
    expect(screen.getByLabelText('Display name')).not.toBeEnabled();
    await press('Color 5 of 6');
    expect(mockSupabase.profileWrite.update).toHaveBeenCalledTimes(1);

    await act(async () => answer({ data: [{ id: 'user-1' }], error: null }));
    expect(screen.queryByText('Saving…')).toBeNull();
    expect(screen.getByLabelText('Color 3 of 6')).toBeSelected();
    expect(screen.getByLabelText('Color 5 of 6')).not.toBeSelected();
  });

  it('the name is written once, when the field is left, not per keystroke', async () => {
    await openAccount();
    const field = screen.getByLabelText('Display name');
    await act(async () => {
      fireEvent.changeText(field, 'Sa');
      fireEvent.changeText(field, CANARY_NAME);
    });
    expect(mockSupabase.profileWrite.update).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent(field, 'blur');
    });
    expect(mockSupabase.profileWrite.update).toHaveBeenCalledTimes(1);
    expect(mockSupabase.profileWrite.update).toHaveBeenCalledWith({ display_name: CANARY_NAME });
    expect(await screen.findByText(CANARY_NAME)).toBeVisible();
    expectNameNotLogged();
  });

  it('leaving the field unchanged or blank writes nothing and keeps the saved name', async () => {
    await openAccount();
    const field = screen.getByLabelText('Display name');
    await act(async () => {
      fireEvent(field, 'blur');
    });
    await act(async () => {
      fireEvent.changeText(field, '   ');
    });
    await act(async () => {
      fireEvent(field, 'blur');
    });
    expect(mockSupabase.profileWrite.update).not.toHaveBeenCalled();
    expect(field).toHaveDisplayValue('Sam');
  });

  it('a name that wasn’t saved keeps the saved one in the header and says why', async () => {
    mockSupabase.profileWrite.writeProfile.mockResolvedValueOnce({
      data: [],
      error: null,
    } as never);
    await openAccount();
    const field = screen.getByLabelText('Display name');
    await act(async () => {
      fireEvent.changeText(field, 'Maya');
    });
    await act(async () => {
      fireEvent(field, 'blur');
    });
    expect(
      await screen.findByText('You’ve been signed out. Sign in again to save your profile.'),
    ).toBeVisible();
    expect(screen.queryByText('Maya')).toBeNull();
    expect(screen.getByText('Sam')).toBeVisible();
  });
});
