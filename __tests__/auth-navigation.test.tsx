import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// Routing by sign-in state (Forge card "Auth and onboarding navigation").
// The first render loads every route, which is slow with a cold cache.
jest.setTimeout(60_000);

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

describe('signed out', () => {
  it('starts on Welcome', async () => {
    await renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
    expect(screen).toHavePathname('/');
  });

  it('sends app and onboarding links back to Welcome', async () => {
    await renderRouter('./app', { initialUrl: '/home' });
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
    expect(screen).toHavePathname('/');
  });

  it('lands a returning user on Home after signing in', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await press('Sign in');
    expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
    expect(screen).toHavePathname('/home');
  });
});

describe('not finished onboarding', () => {
  it('goes to onboarding after creating an account, and stays there', async () => {
    await renderRouter('./app', { initialUrl: '/create-account' });
    await press('Create account');
    expect(await screen.findByText('What should we call you?')).toBeVisible();
    expect(screen).toHavePathname('/onboarding/name');

    // Home isn't reachable until onboarding is finished.
    await act(async () => {
      router.push('/home');
    });
    expect(await screen.findByText('What should we call you?')).toBeVisible();
    expect(screen).toHavePathname('/onboarding/name');
  });

  it('starts onboarding from Welcome with Apple', async () => {
    await renderRouter('./app', { initialUrl: '/' });
    await press('Continue with Apple');
    expect(await screen.findByText('What should we call you?')).toBeVisible();
  });
});

describe('signed in and onboarded', () => {
  const finishOnboarding = async () => {
    await renderRouter('./app', { initialUrl: '/' });
    await press('Continue with Google');
    await press('I’m 18 or older');
    await press('Continue');
    await screen.findByText('Bring your own music.');
    await press('Continue');
    await screen.findByText('You’re all set.');
  };

  it('lands on Home when onboarding is done', async () => {
    await finishOnboarding();
    await press('I’ll do this later');
    expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
    expect(screen).toHavePathname('/home');
  });

  it('can go straight to Start a room from the last onboarding step', async () => {
    await finishOnboarding();
    await act(async () => {
      fireEvent.press(await screen.findByText('Start a room'));
    });
    expect(await screen.findByText('Room rules')).toBeVisible();
    expect(screen).toHavePathname('/create-room');
  });

  it('skips Welcome, and returns to it after signing out', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await press('Sign in');
    await screen.findByText('Start a room or jump into one.');

    await act(async () => {
      router.push('/');
    });
    expect(screen).toHavePathname('/home');

    await press('Settings');
    await act(async () => {
      fireEvent.press(await screen.findByText('Account'));
    });
    await press('Sign out');
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
    expect(screen).toHavePathname('/');
  });
});
