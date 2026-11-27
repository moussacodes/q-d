/**
 * Pure helpers for Sign in with Apple (services/auth.ts `signInWithApple`).
 *
 * Apple signs an identity token (a JWT) that carries the SHA-256 of the
 * nonce q’d sent. Supabase checks it again on the server; checking here too
 * means a token that doesn't answer this request is never sent anywhere.
 * Nothing here verifies the signature: that's Supabase's job.
 */

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Decodes base64url (with or without padding) to bytes, or null if it isn't base64url. */
function base64UrlToBytes(input: string): number[] | null {
  const text = input.replace(/=+$/, '');
  if (text.length % 4 === 1) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = BASE64URL.indexOf(char);
    if (value === -1) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

/** UTF-8 bytes to a string, or null if they aren't valid UTF-8. */
function utf8(bytes: number[]): string | null {
  try {
    return decodeURIComponent(bytes.map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''));
  } catch {
    return null;
  }
}

/** The claims of a JWT, unverified. Null when it isn't a three-part JWT with a JSON object body. */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  const bytes = base64UrlToBytes(parts[1]);
  if (!bytes) return null;
  const json = utf8(bytes);
  if (json === null) return null;
  try {
    const claims: unknown = JSON.parse(json);
    return claims && typeof claims === 'object' && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether Apple's identity token answers this request: its `nonce` claim is
 * the hashed nonce q’d sent. A token without one, or one that can't be read,
 * doesn't.
 */
export function identityTokenMatchesNonce(token: string, hashedNonce: string): boolean {
  const claims = decodeJwtClaims(token);
  return typeof claims?.nonce === 'string' && claims.nonce === hashedNonce;
}

/** The part of Apple's `fullName` q’d reads. Every field may be null. */
export interface AppleFullName {
  givenName?: string | null;
  middleName?: string | null;
  familyName?: string | null;
  nickname?: string | null;
}

/**
 * The name Apple shared, as one line ("Sam Lee"), or null. Apple shares it
 * only the first time someone signs in to q’d, and only if they let it.
 */
export function appleDisplayName(fullName: AppleFullName | null | undefined): string | null {
  if (!fullName) return null;
  const parts = [fullName.givenName, fullName.familyName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  const nickname = typeof fullName.nickname === 'string' ? fullName.nickname.trim() : '';
  return nickname || null;
}

/** Bytes as lowercase hex. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
