import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// 5.1 Settings · Music services and 5.2 Settings · Account (Forge card
// "Music-service and account settings screens"). Only Apple Music and
// Spotify ever appear; Figma's "YouTube Music · Ready" is illustrative only.
jest.setTimeout(60_000);

const press = async (label: string, index = 0) => {
  await act(async () => {
    fireEvent.press((await screen.findAllByLabelText(label))[index]);
  });
};

const pressText = async (text: string | RegExp) => {
  await act(async () => {
    fireEvent.press(await screen.findByText(text));
  });
};

/** A returning user (Spotify connected, mock) in Settings. */
const openSettings = async (tab?: 'account') => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
  await act(async () => {
    router.push(tab ? { pathname: '/settings', params: { tab } } : '/settings');
  });
  await screen.findByText('Settings');
};

const unsupported = /YouTube|TIDAL|Tidal|Amazon|Deezer|Soon|Coming soon/i;

describe('music services (5.1)', () => {
  it('opens first, listing only Spotify and Apple Music', async () => {
    await openSettings();
    expect(
      screen.getByText(
        'Connect a service to host rooms from this phone. Joining a friend’s room works without one.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Music services' })).toBeSelected();
    expect(screen.getAllByText('Spotify').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Apple Music').length).toBeGreaterThan(0);
    expect(screen.queryByText(unsupported)).toBeNull();
    expect(screen.queryByText('Ready')).toBeNull();
  });

  it('labels the mock connection, and offers Apple Music with what it needs', async () => {
    await openSettings();
    expect(screen.getByText('Mock connection · no Spotify account used')).toBeVisible();
    expect(screen.getByText('Subscription needed for full tracks')).toBeVisible();
    expect(screen.getAllByLabelText('Connect')).toHaveLength(1);
    expect(screen.getByLabelText('Disconnect Spotify')).toBeEnabled();
    expect(screen.queryByLabelText('Disconnect Apple Music')).toBeNull();
    expect(screen.getByLabelText('Play rooms through Spotify')).toBeDisabled();
  });

  it('connects Apple Music and switches which service rooms play through', async () => {
    await openSettings();
    await press('Connect');
    expect(await screen.findByText('Mock connection · no Apple Music account used')).toBeVisible();
    expect(screen.queryByLabelText('Connect')).toBeNull();

    const picker = screen.getByLabelText('Play rooms through Spotify');
    expect(picker).toBeEnabled();
    expect(picker).toHaveProp('accessibilityHint', 'Switches to Apple Music');
    await press('Play rooms through Spotify');
    expect(screen.getByLabelText('Play rooms through Apple Music')).toBeVisible();
  });

  it('disconnects a service; the other one takes over', async () => {
    await openSettings();
    await press('Connect');
    await press('Disconnect Spotify');
    expect(await screen.findByText('Premium needed to play rooms')).toBeVisible();
    expect(screen.getByLabelText('Play rooms through Apple Music')).toBeDisabled();
    expect(screen.getByLabelText('Disconnect Apple Music')).toBeVisible();
  });

  it('with nothing connected, hides the choice and hosting asks for a service', async () => {
    await openSettings();
    await press('Disconnect Spotify');
    expect(await screen.findByText('Premium needed to play rooms')).toBeVisible();
    expect(screen.getAllByLabelText('Connect')).toHaveLength(2);
    expect(screen.queryByText('Play rooms through')).toBeNull();

    await press('Back');
    await pressText('Start a room');
    expect(await screen.findByText('Connect a music service to host')).toBeVisible();
    expect(screen.getByLabelText('Start room')).toBeDisabled();
  });

  it('can be connected again after disconnecting', async () => {
    await openSettings();
    await press('Disconnect Spotify');
    await press('Connect'); // Spotify, the first card
    expect(await screen.findByText('Mock connection · no Spotify account used')).toBeVisible();
    expect(screen.getByLabelText('Play rooms through Spotify')).toBeVisible();
  });

  it('offers Disconnect only in Settings, not on Start a room', async () => {
    await openSettings();
    await press('Back');
    await pressText('Start a room');
    await screen.findByText('Room rules');
    expect(screen.queryByLabelText(/^Disconnect /)).toBeNull();
  });
});

describe('account (5.2)', () => {
  it('shows your name, email and sign-in method', async () => {
    await openSettings('account');
    expect(screen.getByRole('tab', { name: 'Account' })).toBeSelected();
    expect(screen.getByLabelText('Display name')).toHaveDisplayValue('Baron');
    expect(screen.getByLabelText('Email')).toHaveProp('editable', false);
    expect(screen.getByText('Signed in with')).toBeVisible();
    expect(screen.getByLabelText('Sign out')).toBeEnabled();
  });

  it('switches between the two tabs', async () => {
    await openSettings();
    await act(async () => {
      fireEvent.press(screen.getByRole('tab', { name: 'Account' }));
    });
    expect(screen.getByLabelText('Display name')).toBeVisible();
    expect(screen.queryByText(/Connect a service to host/)).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByRole('tab', { name: 'Music services' }));
    });
    expect(screen.getByText(/Connect a service to host/)).toBeVisible();
  });

  it('renames you everywhere, but never to a blank name', async () => {
    await openSettings('account');
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Display name'), 'Bee');
    });
    expect(screen.getByText('Bee')).toBeVisible();
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Display name'), '   ');
    });
    expect(screen.getByText('You')).toBeVisible();

    await press('Back');
    expect(await screen.findByText(/^(Morning|Afternoon|Evening), Bee\.$/)).toBeVisible();
  });

  it('changes your color with the onboarding swatches', async () => {
    await openSettings('account');
    expect(screen.queryAllByRole('radio')).toEqual([]);

    await pressText('Change your color');
    const swatches = screen.getAllByRole('radio');
    expect(swatches).toHaveLength(6);
    expect(screen.getByLabelText('Color 1 of 6')).toBeSelected();

    await press('Color 3 of 6');
    expect(screen.getByLabelText('Color 3 of 6')).toBeSelected();
    expect(screen.getByLabelText('Color 1 of 6')).not.toBeSelected();

    await pressText('Done');
    expect(screen.queryAllByRole('radio')).toEqual([]);
    // It was saved, not just shown.
    await pressText('Change your color');
    expect(screen.getByLabelText('Color 3 of 6')).toBeSelected();
  });

  it('shows account deletion as not available yet, instead of a dead link', async () => {
    await openSettings('account');
    expect(screen.getByText('Delete account')).toBeVisible();
    expect(screen.getByText('Not available in this preview yet.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
  });

  it('signs out to Welcome', async () => {
    await openSettings('account');
    await press('Sign out');
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
    expect(screen).toHavePathname('/');
  });
});
