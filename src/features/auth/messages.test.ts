import {
  authErrorMessages,
  checkEmailMessage,
  fieldErrorMessages,
  methodUnavailableMessage,
} from './messages';

const all = [
  ...Object.values(authErrorMessages),
  ...Object.values(fieldErrorMessages),
  checkEmailMessage,
  methodUnavailableMessage('apple'),
  methodUnavailableMessage('google'),
];

describe('auth copy', () => {
  it('has a message for every error', () => {
    for (const message of all) expect(message.trim().length).toBeGreaterThan(0);
  });

  it('uses curly apostrophes, so q’d is spelled right', () => {
    for (const message of all) expect(message).not.toContain("'");
    expect(authErrorMessages.network).toContain('q’d');
  });

  it('never names a provider q’d doesn’t support', () => {
    expect(all.join(' ')).not.toMatch(/YouTube|TIDAL|Tidal|Amazon|Deezer/);
  });

  it('names the method that isn’t available', () => {
    expect(methodUnavailableMessage('apple')).toBe(
      'Sign in with Apple isn’t available yet. Use email instead.',
    );
    expect(methodUnavailableMessage('google')).toContain('Google');
  });

  it('says a too-long password can be fewer characters with emoji or accents', () => {
    // The limit is 72 bytes, so the copy can't promise 72 of any character.
    expect(fieldErrorMessages.password_long).toContain('72');
    expect(fieldErrorMessages.password_long).toMatch(/emoji|accented/);
  });
});
