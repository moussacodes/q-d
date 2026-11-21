import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

// Join with a code happens on Home: there's no separate join screen.
jest.setTimeout(60_000);

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const typeCode = async (text: string) => {
  await act(async () => {
    fireEvent.changeText(await screen.findByLabelText('Room code'), text);
  });
};

/** A returning user on Home. */
const signIn = async () => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
};

describe('joining from Home', () => {
  it('waits for all six characters', async () => {
    await signIn();
    await typeCode('9M2X');
    expect(screen.getByLabelText('Join')).toBeDisabled();
    await press('Join');
    expect(screen).toHavePathname('/home');
  });

  it('opens the room for a pasted code, and Back returns Home', async () => {
    await signIn();
    await typeCode('QD-9m2xr4');
    expect(screen.getByLabelText('Room code').props.value).toBe('9M2XR4');

    await press('Join');
    expect(screen).toHavePathname('/room/QD-9M2XR4');
    expect(await screen.findByText('Kitchen Disco')).toBeVisible();

    await act(async () => {
      router.back();
    });
    expect(screen).toHavePathname('/home');
    expect(screen.getByLabelText('Room code').props.value).toBe('');
  });

  it('opens it from the keyboard too', async () => {
    await signIn();
    await typeCode('3HV8PL');
    await act(async () => {
      fireEvent(screen.getByLabelText('Room code'), 'submitEditing');
    });
    expect(screen).toHavePathname('/room/QD-3HV8PL');
  });
});
