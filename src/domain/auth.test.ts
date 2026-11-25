import {
  hasFormErrors,
  isProfileComplete,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  resolveAuthStatus,
  validateEmail,
  validateEmailForm,
} from './auth';

describe('validateEmail', () => {
  it.each(['someone@example.com', '  someone@example.com  ', 'a.b+tag@sub.example.co.uk'])(
    'accepts %p',
    (email) => {
      expect(validateEmail(email)).toBeUndefined();
    },
  );

  it.each(['', '   '])('asks for an email when it is %p', (email) => {
    expect(validateEmail(email)).toBe('email_missing');
  });

  it.each([
    'someone',
    'someone@',
    '@example.com',
    'someone@example',
    'some one@example.com',
    'a@b@c.com',
  ])('rejects %p', (email) => {
    expect(validateEmail(email)).toBe('email_invalid');
  });

  it('trims the email', () => {
    expect(normalizeEmail('  someone@example.com\n')).toBe('someone@example.com');
  });
});

describe('validateEmailForm', () => {
  const email = 'someone@example.com';

  it('passes a complete form', () => {
    expect(validateEmailForm({ email, password: 'x' }, 'sign-in')).toEqual({});
    expect(
      validateEmailForm({ email, password: 'x'.repeat(MIN_PASSWORD_LENGTH) }, 'create-account'),
    ).toEqual({});
  });

  it('reports both fields at once', () => {
    const errors = validateEmailForm({ email: '', password: '' }, 'sign-in');
    expect(errors).toEqual({ email: 'email_missing', password: 'password_missing' });
    expect(hasFormErrors(errors)).toBe(true);
    expect(hasFormErrors({})).toBe(false);
  });

  it('signs in with any password length, so old accounts still work', () => {
    expect(validateEmailForm({ email, password: 'short' }, 'sign-in')).toEqual({});
  });

  it('needs a long enough password for a new account', () => {
    expect(
      validateEmailForm({ email, password: 'x'.repeat(MIN_PASSWORD_LENGTH - 1) }, 'create-account'),
    ).toEqual({ password: 'password_short' });
  });

  it('refuses a password longer than the server can use', () => {
    expect(
      validateEmailForm({ email, password: 'x'.repeat(MAX_PASSWORD_LENGTH + 1) }, 'create-account'),
    ).toEqual({ password: 'password_long' });
    // Counted in bytes: 25 three-byte characters are 75 bytes.
    expect(validateEmailForm({ email, password: '€'.repeat(25) }, 'create-account')).toEqual({
      password: 'password_long',
    });
  });

  it('accepts exactly 8 characters and exactly 72 bytes', () => {
    expect(
      validateEmailForm({ email, password: 'x'.repeat(MIN_PASSWORD_LENGTH) }, 'create-account'),
    ).toEqual({});
    expect(
      validateEmailForm({ email, password: 'x'.repeat(MAX_PASSWORD_LENGTH) }, 'create-account'),
    ).toEqual({});
    // 18 four-byte emoji are 72 bytes: allowed. One more ASCII byte isn't.
    expect(validateEmailForm({ email, password: '🎧'.repeat(18) }, 'create-account')).toEqual({});
    expect(validateEmailForm({ email, password: `${'🎧'.repeat(18)}x` }, 'create-account')).toEqual(
      { password: 'password_long' },
    );
  });

  it('never checks length on sign-in, even past 72 bytes', () => {
    expect(validateEmailForm({ email, password: 'x'.repeat(200) }, 'sign-in')).toEqual({});
  });

  it('keeps spaces in a password, which count', () => {
    expect(validateEmailForm({ email, password: '        ' }, 'create-account')).toEqual({});
  });
});

describe('isProfileComplete', () => {
  const complete = {
    display_name: 'Sam',
    color: '#ff8a5b',
    adult_confirmed_at: '2026-11-20T12:00:00Z',
  };

  it('needs a name, a color and the 18+ confirmation', () => {
    expect(isProfileComplete(complete)).toBe(true);
    expect(isProfileComplete({ ...complete, display_name: null })).toBe(false);
    expect(isProfileComplete({ ...complete, display_name: '   ' })).toBe(false);
    expect(isProfileComplete({ ...complete, color: null })).toBe(false);
    expect(isProfileComplete({ ...complete, adult_confirmed_at: null })).toBe(false);
    expect(isProfileComplete(null)).toBe(false);
    expect(isProfileComplete(undefined)).toBe(false);
  });
});

describe('resolveAuthStatus', () => {
  it('signed out → Welcome, unfinished profile → onboarding, else ready', () => {
    expect(resolveAuthStatus(false, false)).toBe('signedOut');
    expect(resolveAuthStatus(false, true)).toBe('signedOut');
    expect(resolveAuthStatus(true, false)).toBe('onboarding');
    expect(resolveAuthStatus(true, true)).toBe('ready');
  });
});
