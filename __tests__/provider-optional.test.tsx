import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// Provider-optional flow (Forge card): a music service is needed only on the
// phone that plays, which in aux mode is the host's.
jest.setTimeout(60_000);

const pressLabel = async (label: string, index = 0) => {
  await act(async () => {
    fireEvent.press((await screen.findAllByLabelText(label))[index]);
  });
};
const pressText = async (text: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByText(text));
  });
};

/** New account from Welcome, through onboarding step 1, to step 2 (services). */
const newAccountAtServicesStep = async () => {
  await renderRouter('./app', { initialUrl: '/' });
  await pressLabel('Continue with Google');
  await pressLabel('I’m 18 or older');
  await pressLabel('Continue');
  await screen.findByText('Bring your own music.');
};

describe('guests', () => {
  it('join a room and add a song without connecting a service', async () => {
    await newAccountAtServicesStep();
    await pressText('Skip');
    await pressText('I’ll do this later');
    await screen.findByText('Start a room or jump into one.');

    await act(async () => {
      router.push({ pathname: '/join', params: { code: '9M2XR4' } });
    });
    await pressLabel('Join Kitchen Disco');
    expect(screen).toHavePathname('/room/QD-9M2XR4');

    await pressLabel('Add a song');
    await pressLabel('Add Rain Down');
    expect(await screen.findByText(/Rain Down added/)).toBeVisible();
    expect(screen.queryByText(/Connect a music service/)).toBeNull();
  });
});

describe('hosts', () => {
  it('are asked for a service only when starting a room', async () => {
    await newAccountAtServicesStep();
    await pressText('Skip');
    await pressText('Start a room');

    expect(await screen.findByText('Connect a music service to host')).toBeVisible();
    expect(screen.getByLabelText('Start room')).toBeDisabled();

    await pressLabel('Connect'); // Spotify, the first card
    expect(await screen.findByText('Through Spotify')).toBeVisible();
    expect(screen.queryByText('Connect a music service to host')).toBeNull();

    await pressLabel('Start room');
    expect(screen).toHavePathname('/room/QD-7K4F9X');
  });
});

describe('q’d sign-in and music services are separate', () => {
  it('connecting a service during onboarding keeps you in onboarding', async () => {
    await newAccountAtServicesStep();
    await pressLabel('Connect', 1); // Apple Music
    expect(await screen.findByText('Mock connection · no Apple Music account used')).toBeVisible();
    expect(screen).toHavePathname('/onboarding/services');
  });

  it('a new account starts with no services, even after another account had one', async () => {
    await renderRouter('./app', { initialUrl: '/sign-in' });
    await pressLabel('Sign in');
    await pressLabel('Settings');
    expect(await screen.findByText('Mock connection · no Spotify account used')).toBeVisible();

    await pressText('Account');
    await pressLabel('Sign out');
    await screen.findByText('Different apps. One aux.');

    await pressLabel('Continue with email');
    await pressLabel('Create account');
    await pressLabel('I’m 18 or older');
    await pressLabel('Continue');
    expect(await screen.findByText('Premium needed to play rooms')).toBeVisible();
    expect(screen.queryByText(/Mock connection/)).toBeNull();
  });
});
