import { nodeCrypto, nodePkceCrypto } from '@/test/fakeSpotify';

import {
  base64ToBase64Url,
  base64UrlEncode,
  createPkcePair,
  createState,
  pkceChallenge,
  type PkceCrypto,
} from './pkce';

/** RFC 7636 Appendix B. */
const RFC_BYTES = [
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105,
  214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
];
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('base64UrlEncode', () => {
  it('matches the RFC 7636 example', () => {
    expect(base64UrlEncode(new Uint8Array(RFC_BYTES))).toBe(RFC_VERIFIER);
  });

  it.each([0, 1, 2, 3, 4, 5, 31, 32, 33, 64, 255])(
    'matches Node’s base64url for %i random bytes',
    (length) => {
      const bytes = nodeCrypto.randomBytes(length);
      expect(base64UrlEncode(new Uint8Array(bytes))).toBe(bytes.toString('base64url'));
    },
  );

  it('converts standard base64 to unpadded base64url', () => {
    expect(base64ToBase64Url('a+b/c==')).toBe('a-b_c');
  });
});

describe('PKCE', () => {
  it('computes the RFC 7636 S256 challenge', async () => {
    expect(await pkceChallenge(RFC_VERIFIER, nodePkceCrypto)).toBe(RFC_CHALLENGE);
  });

  it('makes an 86-character verifier from the unreserved alphabet, and its challenge', async () => {
    const { verifier, challenge } = await createPkcePair(nodePkceCrypto);
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]{86}$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challenge).toBe(nodeCrypto.createHash('sha256').update(verifier).digest('base64url'));
    expect(challenge).not.toContain('=');
  });

  it('uses fresh randomness every time', async () => {
    const pairs = await Promise.all(
      Array.from({ length: 20 }, () => createPkcePair(nodePkceCrypto)),
    );
    expect(new Set(pairs.map((pair) => pair.verifier)).size).toBe(20);
    const states = Array.from({ length: 20 }, () => createState(nodePkceCrypto));
    expect(new Set(states).size).toBe(20);
    states.forEach((state) => expect(state).toMatch(/^[A-Za-z0-9\-_]{22}$/));
  });

  it('asks the injected crypto for the random bytes', async () => {
    const crypto: PkceCrypto = {
      randomBytes: jest.fn((count: number) => new Uint8Array(count).fill(7)),
      sha256Base64: jest.fn(async () => 'aGFzaA=='),
    };
    const pair = await createPkcePair(crypto);
    expect(crypto.randomBytes).toHaveBeenCalledWith(64);
    expect(pair.challenge).toBe('aGFzaA');
    expect(crypto.sha256Base64).toHaveBeenCalledWith(pair.verifier);
  });
});
