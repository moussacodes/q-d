import { appleDisplayName, decodeJwtClaims, identityTokenMatchesNonce, toHex } from './appleSignIn';

const b64url = (text: string) =>
  btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const jwt = (claims: unknown) =>
  `${b64url('{"alg":"RS256"}')}.${b64url(JSON.stringify(claims))}.sig`;

describe('decodeJwtClaims', () => {
  it('reads the claims of a JWT, including UTF-8 and base64url characters', () => {
    expect(decodeJwtClaims(jwt({ nonce: 'abc', name: 'Zoë ?>~' }))).toEqual({
      nonce: 'abc',
      name: 'Zoë ?>~',
    });
  });

  it('accepts padding', () => {
    const [h, p, s] = jwt({ a: 1 }).split('.');
    expect(decodeJwtClaims(`${h}.${p}==.${s}`)).toEqual({ a: 1 });
  });

  it.each([
    ['empty', ''],
    ['two parts', 'a.b'],
    ['four parts', 'a.b.c.d'],
    ['empty body', 'a..c'],
    ['not base64url', 'a.b+c/.c'],
    ['impossible length', 'a.abcde.c'],
    ['not JSON', `a.${b64url('nope')}.c`],
    ['JSON array', `a.${b64url('[1]')}.c`],
    ['JSON null', `a.${b64url('null')}.c`],
    ['invalid UTF-8', 'a._w.c'],
  ])('is null for %s', (_name, token) => {
    expect(decodeJwtClaims(token)).toBeNull();
  });
});

describe('identityTokenMatchesNonce', () => {
  it('matches only the same hashed nonce', () => {
    expect(identityTokenMatchesNonce(jwt({ nonce: 'h1' }), 'h1')).toBe(true);
    expect(identityTokenMatchesNonce(jwt({ nonce: 'h2' }), 'h1')).toBe(false);
  });

  it('refuses a token without a nonce, with a non-string one, or unreadable', () => {
    expect(identityTokenMatchesNonce(jwt({ sub: 'x' }), 'h1')).toBe(false);
    expect(identityTokenMatchesNonce(jwt({ nonce: 1 }), '1')).toBe(false);
    expect(identityTokenMatchesNonce('garbage', 'h1')).toBe(false);
  });
});

describe('appleDisplayName', () => {
  it('joins the given and family names', () => {
    expect(appleDisplayName({ givenName: ' Sam ', familyName: 'Lee', middleName: 'X' })).toBe(
      'Sam Lee',
    );
    expect(appleDisplayName({ givenName: 'Sam', familyName: null })).toBe('Sam');
    expect(appleDisplayName({ givenName: null, familyName: 'Lee' })).toBe('Lee');
  });

  it('falls back to the nickname', () => {
    expect(appleDisplayName({ givenName: '  ', nickname: 'Sammy' })).toBe('Sammy');
  });

  it('is null when Apple shared nothing', () => {
    expect(appleDisplayName(null)).toBeNull();
    expect(appleDisplayName(undefined)).toBeNull();
    expect(appleDisplayName({ givenName: null, familyName: null })).toBeNull();
  });
});

it('toHex pads every byte', () => {
  expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
});
