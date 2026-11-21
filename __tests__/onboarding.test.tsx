import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// Two-step onboarding (Forge card): name, color and 18+ on step 1, then an
// optional music-service step that finishes on Home.
jest.setTimeout(60_000);

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

const signUpWithEmail = async () => {
  await renderRouter('./app', { initialUrl: '/create-account' });
  await press('Create account');
  await screen.findByText('What should we call you?');
};

describe('step 1', () => {
  it('needs a display name and the 18+ confirmation', async () => {
    await signUpWithEmail();
    expect(screen.getByLabelText('Display name')).toHaveDisplayValue('');
    expect(screen.getByLabelText('Continue')).toBeDisabled();

    await press('I’m 18 or older');
    expect(screen.getByLabelText('Continue')).toBeDisabled();

    await type('Display name', '   ');
    expect(screen.getByLabelText('Continue')).toBeDisabled();

    await type('Display name', 'Maya');
    expect(screen.getByLabelText('Continue')).toBeEnabled();

    await press('I’m 18 or older');
    expect(screen.getByLabelText('Continue')).toBeDisabled();
  });

  it('suggests the Apple account name', async () => {
    await renderRouter('./app', { initialUrl: '/' });
    await press('Continue with Apple');
    expect(await screen.findByLabelText('Display name')).toHaveDisplayValue('Baron');
  });

  it('lets you pick a color and previews how you’ll show up', async () => {
    await signUpWithEmail();
    await type('Display name', 'Maya');
    await press('Color 4 of 6');
    expect(screen.getByLabelText('Color 4 of 6')).toBeSelected();
    expect(screen.getByLabelText('Color 1 of 6')).not.toBeSelected();
    expect(screen.getByText('How you’ll show up: “Added by Maya”')).toBeVisible();
  });

  it('Back cancels sign-up', async () => {
    await signUpWithEmail();
    await press('Back');
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
    expect(screen).toHavePathname('/');
  });
});

describe('the whole flow', () => {
  it('skips the music-service step and uses the saved profile everywhere', async () => {
    await signUpWithEmail();
    await type('Display name', '  Maya  ');
    await press('Color 4 of 6');
    await press('I’m 18 or older');
    await press('Continue');

    await screen.findByText('Bring your own music.');
    await act(async () => {
      fireEvent.press(screen.getByText('Skip'));
    });
    expect(await screen.findByText(/, Maya\.$/)).toBeVisible();
    expect(screen).toHavePathname('/home');

    await press('Account');
    expect(await screen.findByLabelText('Display name')).toHaveDisplayValue('Maya');
    // "Signed in with" shows the method used: the Email field label plus the method.
    expect(screen.getAllByText('Email')).toHaveLength(2);
    expect(screen.queryByText('Apple')).toBeNull();
  });
});
