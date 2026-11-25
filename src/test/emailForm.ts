import { act, fireEvent, screen } from 'expo-router/testing-library';

/** A valid email and password, so the form's checks let the tap through. */
export const validEmailForm = { email: 'someone@example.com', password: 'correct-horse' };

/** Fills in Sign in or Create account with a valid email and password. */
export async function fillEmailForm(form = validEmailForm) {
  await act(async () => {
    fireEvent.changeText(await screen.findByLabelText('Email'), form.email);
  });
  await act(async () => {
    fireEvent.changeText(await screen.findByLabelText('Password'), form.password);
  });
}
