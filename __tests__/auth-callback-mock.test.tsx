import { renderRouter, screen } from 'expo-router/testing-library';

// Mock auth mode: there's no Supabase, so a sign-in link can't be finished.
// The callback says so honestly instead of pretending to sign in.
jest.setTimeout(60_000);

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it('says sign-in isn’t set up, and stays signed out', async () => {
  await renderRouter('./app', { initialUrl: '/auth/callback?code=abc' });
  expect(await screen.findByText('Sign-in isn’t set up in this build of q’d.')).toBeVisible();
  expect(screen.getByLabelText('Back to sign in')).toBeEnabled();
});

it('starts on Welcome straight away, with nothing to restore', async () => {
  await renderRouter('./app', { initialUrl: '/' });
  expect(await screen.findByText('Different apps. One aux.')).toBeVisible();
  expect(screen.getByText('Mock data · nothing here is live')).toBeVisible();
});
