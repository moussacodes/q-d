import type { AppleFullName } from '@/domain/appleSignIn';
import type { AppleAuthenticationModule, NonceCrypto } from '@/services/auth';

import { nodeCrypto } from './fakeSpotify';

/**
 * A stand-in for expo-apple-authentication's sheet. By default it answers
 * like Apple: an identity token (an unsigned, obviously fake JWT) whose
 * `nonce` claim is the hashed nonce it was asked for. Tests change the
 * answer with `answer`.
 */

/** ASCII text as base64url without padding. */
const base64url = (text: string) =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A fake Apple identity token with these claims. The signature is fake too. */
export function fakeIdentityToken(claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', kid: 'fake' }));
  return `${header}.${base64url(JSON.stringify({ iss: 'https://appleid.apple.com', ...claims }))}.ZmFrZS1zaWduYXR1cmU`;
}

export const nodeNonceCrypto: NonceCrypto = {
  randomBytes: (count) => new Uint8Array(nodeCrypto.randomBytes(count)),
  sha256Hex: async (text) =>
    (
      nodeCrypto.createHash('sha256').update(text) as unknown as { digest(e: 'hex'): string }
    ).digest('hex'),
};

export type AppleAnswer =
  | { kind: 'ok'; fullName?: AppleFullName | null; nonce?: string; noToken?: boolean }
  | { kind: 'throw'; code: string };

export function createFakeApple(available = true) {
  let next: AppleAnswer = { kind: 'ok' };
  const signInAsync = jest.fn(async (options: { requestedScopes: number[]; nonce: string }) => {
    const answer = next;
    if (answer.kind === 'throw') {
      throw Object.assign(new Error('The Apple sheet failed'), { code: answer.code });
    }
    return {
      identityToken: answer.noToken
        ? null
        : fakeIdentityToken({ sub: 'apple-sub-001', nonce: answer.nonce ?? options.nonce }),
      fullName: answer.fullName ?? null,
    };
  });
  const module: AppleAuthenticationModule & { signInAsync: typeof signInAsync } = {
    isAvailableAsync: jest.fn(async () => available),
    signInAsync,
  };
  return {
    module,
    signInAsync,
    answer(value: AppleAnswer) {
      next = value;
    },
  };
}
