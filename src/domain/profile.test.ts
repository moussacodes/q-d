import {
  displayNameError,
  displayNameLength,
  isAvatarSwatch,
  MAX_DISPLAY_NAME_LENGTH,
  normalizeDisplayName,
  validateOnboardingProfile,
  validateProfileChange,
} from './profile';

const SWATCHES = ['#f2a27c', '#8fb4f0'];

describe('display names', () => {
  it('match the database: 1 to 30 characters, trimmed', () => {
    expect(MAX_DISPLAY_NAME_LENGTH).toBe(30);
    expect(displayNameError('Sam')).toBeNull();
    expect(displayNameError('  Sam  ')).toBeNull();
    expect(normalizeDisplayName('  Sam  ')).toBe('Sam');
    expect(displayNameError('a'.repeat(30))).toBeNull();
    expect(displayNameError('a'.repeat(31))).toBe('name_too_long');
    expect(displayNameError(` ${'a'.repeat(30)} `)).toBeNull();
  });

  it.each(['', ' ', '\t \n'])('refuse a blank name %p', (name) => {
    expect(displayNameError(name)).toBe('name_missing');
  });

  it('count characters the way Postgres does, so an emoji is one', () => {
    expect(displayNameLength('🎧')).toBe(1);
    expect('🎧'.length).toBe(2);
    expect(displayNameError('🎧'.repeat(30))).toBeNull();
    expect(displayNameError('🎧'.repeat(31))).toBe('name_too_long');
  });

  it.each(['Sam\nSmith', 'Sam\tS', 'Sam\u0000', 'Sam\u007f'])(
    'refuse control characters inside a name (%p)',
    (name) => {
      expect(displayNameError(name)).toBe('name_invalid');
    },
  );

  it('accept accents, apostrophes and other scripts', () => {
    for (const name of ['Zoë', 'D’Angelo', "O'Neil", '王芳', 'José María']) {
      expect(displayNameError(name)).toBeNull();
    }
  });
});

describe('swatches', () => {
  it('accept only listed colors, ignoring hex case', () => {
    expect(isAvatarSwatch('#f2a27c', SWATCHES)).toBe(true);
    expect(isAvatarSwatch('#F2A27C', SWATCHES)).toBe(true);
    expect(isAvatarSwatch('#000000', SWATCHES)).toBe(false);
    expect(isAvatarSwatch('red', SWATCHES)).toBe(false);
    expect(isAvatarSwatch('', SWATCHES)).toBe(false);
  });
});

describe('validateOnboardingProfile', () => {
  const valid = { displayName: '  Sam ', color: '#8fb4f0', adultConfirmed: true };

  it('returns the trimmed name and the color', () => {
    expect(validateOnboardingProfile(valid, SWATCHES)).toEqual({
      ok: true,
      value: { displayName: 'Sam', color: '#8fb4f0' },
    });
  });

  it.each([
    [{ displayName: ' ' }, 'name_missing'],
    [{ displayName: 'a'.repeat(31) }, 'name_too_long'],
    [{ displayName: 'a\nb' }, 'name_invalid'],
    [{ color: '#123456' }, 'color_invalid'],
    [{ adultConfirmed: false }, 'adult_required'],
  ] as const)('refuses %p with %s', (change, error) => {
    expect(validateOnboardingProfile({ ...valid, ...change }, SWATCHES)).toEqual({
      ok: false,
      error,
    });
  });

  it('checks the name first, then the color, then 18+', () => {
    expect(
      validateOnboardingProfile(
        { displayName: '', color: 'nope', adultConfirmed: false },
        SWATCHES,
      ),
    ).toEqual({ ok: false, error: 'name_missing' });
    expect(
      validateOnboardingProfile(
        { displayName: 'Sam', color: 'nope', adultConfirmed: false },
        SWATCHES,
      ),
    ).toEqual({ ok: false, error: 'color_invalid' });
  });
});

describe('validateProfileChange', () => {
  it('passes through only what changed', () => {
    expect(validateProfileChange({ displayName: ' Maya ' }, SWATCHES)).toEqual({
      ok: true,
      value: { displayName: 'Maya' },
    });
    expect(validateProfileChange({ color: '#f2a27c' }, SWATCHES)).toEqual({
      ok: true,
      value: { color: '#f2a27c' },
    });
    expect(validateProfileChange({}, SWATCHES)).toEqual({ ok: true, value: {} });
  });

  it('refuses a blank name or an unlisted color', () => {
    expect(validateProfileChange({ displayName: '  ' }, SWATCHES)).toEqual({
      ok: false,
      error: 'name_missing',
    });
    expect(validateProfileChange({ displayName: 'Maya', color: '#fff' }, SWATCHES)).toEqual({
      ok: false,
      error: 'color_invalid',
    });
  });
});
