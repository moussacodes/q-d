import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { fillEmailForm } from '@/test/emailForm';

// Welcome, Sign in and Create account (Forge card "Welcome, sign-in and
// account-creation screens"): every screen offers Apple, Google and email,
// and each entry point lands where the mock session says it should.
jest.setTimeout(60_000);

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const pressText = async (text: string | RegExp) => {
  await act(async () => {
    fireEvent.press(await screen.findByText(text));
  });
};

const type = async (label: string, text: string) => {
  await act(async () => {
    fireEvent.changeText(await screen.findByLabelText(label), text);
  });
};

/** Settings → Account names the sign-in method under "Signed in with". */
const expectSignedInWith = async (method: string) => {
  await press('Account');
  expect(await screen.findByText('Signed in with')).toBeVisible();
  // "Email" is also the email field's label.
  expect(screen.getAllByText(method)).toHaveLength(method === 'Email' ? 2 : 1);
};

const unsupported = /YouTube|TIDAL|Tidal|Amazon|Deezer/;

describe('Welcome', () => {
  it('offers Apple, Google and email, plus sign-in for returning users', async () => {
    await renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
    expect(screen.getByLabelText('Continue with Apple')).toBeEnabled();
    expect(screen.getByLabelText('Continue with Google')).toBeEnabled();
    expect(screen.getByLabelText('Continue with email')).toBeEnabled();
    expect(screen.getByText(/Already have an account\?/)).toBeVisible();
  });

  it('spells the wordmark q’d, with the curly apostrophe', async () => {
    await renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByText('q’d')).toBeVisible();
    expect(screen.queryByText("q'd")).toBeNull();
  });

  it('names only Apple Music and Spotify, and says guests need no service', async () => {
    await renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByText(/Apple Music, Spotify or no service at all/)).toBeVisible();
    expect(screen.getByText(/host’s phone plays it/)).toBeVisible();
    expect(screen.queryByText(unsupported)).toBeNull();
  });

  it('starts a new account with Google and suggests its name', async () => {
    await renderRouter('./app', { initialUrl: '/' });
    await press('Continue with Google');
    expect(await screen.findByText('What should we call you?')).toBeVisible();
    expect(screen).toHavePathname('/onboarding/name');
    expect(screen.getByLabelText('Display name')).toHaveDisplayValue('Baron');
  });

  it('opens Create account for email, with an empty form', async () => {
    await renderRouter('./app', { initialUrl: '/' });
    await press('Continue with email');
    expect(await screen.findByText('Create your account.')).toBeVisible();
    expect(screen).toHavePathname('/create-account');
    expect(screen.getByLabelText('Email')).toHaveDisplayValue('');
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('');
  });
});

describe('Sign in', () => {
  it('offers email, Apple and Google, with a password reset hint', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    expect(await screen.findByText('Welcome back.')).toBeVisible();
    expect(screen.getByLabelText('Email')).toBeVisible();
    expect(screen.getByLabelText('Password')).toBeVisible();
    expect(screen.getByLabelText('Sign in')).toBeEnabled();
    expect(screen.getByLabelText('Continue with Apple')).toBeEnabled();
    expect(screen.getByLabelText('Continue with Google')).toBeEnabled();
    expect(screen.getByText('Forgot password?')).toBeVisible();
    expect(screen.getByText(/New to q’d\?/)).toBeVisible();
  });

  it('hides the password until you ask to see it', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await type('Password', 'hunter22');
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', true);

    await press('Show password');
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', false);
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('hunter22');

    await press('Hide password');
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
  });

  it.each([
    ['Sign in', 'Email'],
    ['Continue with Apple', 'Apple'],
    ['Continue with Google', 'Google'],
  ])('“%s” is a returning user: Home, signed in with %s', async (button, method) => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await type('Email', 'someone@example.com');
    await type('Password', 'hunter22');
    await press(button);
    expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
    expect(screen).toHavePathname('/home');
    await expectSignedInWith(method);
  });

  it('switches to Create account in place, so Back still goes to Welcome', async () => {
    await renderRouter('./app', { initialUrl: '/' });
    await pressText(/Already have an account\?/);
    expect(await screen.findByText('Welcome back.')).toBeVisible();

    await pressText(/New to q’d\?/);
    expect(await screen.findByText('Create your account.')).toBeVisible();
    expect(screen).toHavePathname('/create-account');

    await press('Back');
    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
    expect(screen).toHavePathname('/');
  });
});

describe('Create account', () => {
  it('offers email, Apple and Google, without a password reset', async () => {
    await renderRouter('./app', { initialUrl: '/create-account' });
    expect(await screen.findByText('Create your account.')).toBeVisible();
    expect(screen.getByText('You’ll pick a name and color next.')).toBeVisible();
    expect(screen.getByLabelText('Email')).toBeVisible();
    expect(screen.getByLabelText('Password')).toBeVisible();
    expect(screen.getByLabelText('Continue with Apple')).toBeEnabled();
    expect(screen.getByLabelText('Continue with Google')).toBeEnabled();
    expect(screen.queryByText('Forgot password?')).toBeNull();
  });

  it('with email, starts onboarding with a blank name', async () => {
    await renderRouter('./app', { initialUrl: '/create-account' });
    await type('Email', 'someone@example.com');
    await type('Password', 'hunter22');
    await press('Create account');
    expect(await screen.findByText('What should we call you?')).toBeVisible();
    expect(screen.getByLabelText('Display name')).toHaveDisplayValue('');
  });

  it.each(['Continue with Apple', 'Continue with Google'])(
    'with “%s”, starts onboarding with the account’s name',
    async (button) => {
      await renderRouter('./app', { initialUrl: '/create-account' });
      await press(button);
      expect(await screen.findByText('What should we call you?')).toBeVisible();
      expect(screen.getByLabelText('Display name')).toHaveDisplayValue('Baron');
    },
  );

  it('switches to Sign in', async () => {
    await renderRouter('./app', { initialUrl: '/create-account' });
    await pressText(/Already have an account\?/);
    expect(await screen.findByText('Welcome back.')).toBeVisible();
    expect(screen).toHavePathname('/sign-in');
  });
});

describe('once signed in', () => {
  it('Welcome, Sign in and Create account are out of reach', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await fillEmailForm();
    await press('Sign in');
    await screen.findByText('Start a room or jump into one.');

    for (const href of ['/sign-in', '/create-account'] as const) {
      await act(async () => {
        router.push(href);
      });
      expect(screen).toHavePathname('/home');
    }
  });
});
