import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// Route tests live here because every file under app/ becomes a route.

// The first render loads every route. With a cold transform cache (always the
// case in CI) that takes ~20 s, well past Jest's 5 s default.
jest.setTimeout(60_000);

describe('Welcome', () => {
  it('renders the headline and opens email sign-up', async () => {
    await renderRouter('./app', { initialUrl: '/' });

    expect(await screen.findByText('Different apps. One aux.')).toBeVisible();

    await fireEvent.press(screen.getByText('Continue with email'));
    expect(screen).toHavePathname('/create-account');
  });

  it('opens sign-in for returning users', async () => {
    await renderRouter('./app', { initialUrl: '/' });

    await fireEvent.press(await screen.findByRole('link'));
    expect(screen).toHavePathname('/sign-in');
  });
});
