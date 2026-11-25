import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// Mock auth mode (no Supabase settings, the default on Windows and the web):
// the form checks its fields the same way, then signs in with the mock
// session. Nothing reaches Supabase, because there's no client.
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

describe('mock auth mode', () => {
  it('keeps the mock label, which says nothing is live', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    expect(await screen.findByText('Mock data · nothing here is live')).toBeVisible();
  });

  it('asks for an email and password before signing in', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await press('Sign in');
    expect(await screen.findByText('Enter your email.')).toBeVisible();
    expect(screen.getByText('Enter your password.')).toBeVisible();
    expect(screen).toHavePathname('/sign-in');
  });

  it('clears a field’s message as soon as it’s edited', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await press('Sign in');
    await type('Email', 's');
    expect(screen.queryByText('Enter your email.')).toBeNull();
    expect(screen.getByText('Enter your password.')).toBeVisible();
  });

  it('checks the password length for a new account', async () => {
    await renderRouter('./app', { initialUrl: '/create-account' });
    await type('Email', 'someone@example.com');
    await type('Password', 'short');
    await press('Create account');
    expect(await screen.findByText('Use at least 8 characters.')).toBeVisible();
    expect(screen).toHavePathname('/create-account');
  });

  it('signs in with the mock session once the form is valid', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await type('Email', 'someone@example.com');
    await type('Password', 'x');
    await press('Sign in');
    expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
  });

  it('keeps Apple and Google as mock sign-ins', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await press('Continue with Apple');
    expect(await screen.findByText('Start a room or jump into one.')).toBeVisible();
    expect(screen.queryByText(/isn’t available yet/)).toBeNull();
  });
});
