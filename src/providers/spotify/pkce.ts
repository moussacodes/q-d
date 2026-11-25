/**
 * Proof Key for Code Exchange (RFC 7636) for Spotify's Authorization Code
 * flow. PKCE lets the app authorize without a client secret: the app keeps a
 * random verifier, sends only its SHA-256 hash (the challenge) to Spotify, and
 * proves it started the flow by sending the verifier with the code.
 *
 * Crypto is injected so tests can use Node's and the app uses expo-crypto.
 */

export interface PkceCrypto {
  /** Cryptographically secure random bytes. */
  randomBytes(count: number): Uint8Array;
  /** SHA-256 of `text` (UTF-8), as standard base64. */
  sha256Base64(text: string): Promise<string>;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url without padding (RFC 4648 §5). Written out because `btoa` isn't everywhere. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += ALPHABET[c & 0x3f];
  }
  return out;
}

/** Standard base64 → base64url without padding. */
export function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 64 random bytes give an 86-character verifier (RFC 7636 allows 43–128). */
const VERIFIER_BYTES = 64;
const STATE_BYTES = 16;

export type PkcePair = { verifier: string; challenge: string };

/** The S256 challenge for a verifier. */
export async function pkceChallenge(verifier: string, crypto: PkceCrypto): Promise<string> {
  return base64ToBase64Url(await crypto.sha256Base64(verifier));
}

export async function createPkcePair(crypto: PkceCrypto): Promise<PkcePair> {
  const verifier = base64UrlEncode(crypto.randomBytes(VERIFIER_BYTES));
  return { verifier, challenge: await pkceChallenge(verifier, crypto) };
}

/** An unguessable `state` value that ties the redirect to this attempt. */
export function createState(crypto: PkceCrypto): string {
  return base64UrlEncode(crypto.randomBytes(STATE_BYTES));
}
