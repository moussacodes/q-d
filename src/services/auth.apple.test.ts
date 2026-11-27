import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import type { AuthErrorCode } from '@/domain/auth';
import { createFakeApple, fakeIdentityToken, nodeNonceCrypto } from '@/test/fakeAppleAuth';
import { createFakeSupabase, fakeSession, fakeUser, type FakeSupabase } from '@/test/fakeSupabase';

import {
  isAppleSignInAvailable,
  mapAppleTokenError,
  onAuthChange,
  signInWithApple,
  type AuthChange,
} from './auth';
import { addLogSink, type LogEntry } from './logger';

// Sign in with Apple, with Apple's sheet, the nonce crypto and Supabase
// faked at the service boundary.

let fake: FakeSupabase;
let apple: ReturnType<typeof createFakeApple>;
let entries: LogEntry[];
let removeSink: () => void;

const appleUser = (metadata: Record<string, unknown> = {}) =>
  fakeUser({
    id: 'apple-user',
    email: 'abc123@privaterelay.appleid.com',
    app_metadata: { provider: 'apple' },
    user_metadata: metadata,
  });

const run = (overrides: Partial<Parameters<typeof signInWithApple>[0]> = {}) =>
  signInWithApple({
    client: fake.client,
    apple: apple.module,
    crypto: nodeNonceCrypto,
    platform: 'ios',
    ...overrides,
  });

const logged = () => JSON.stringify(entries);

beforeEach(() => {
  fake = createFakeSupabase();
  apple = createFakeApple();
  fake.auth.signInWithIdToken.mockImplementation(async () => {
    const user = appleUser();
    return { data: { user, session: fakeSession(user) }, error: null } as never;
  });
  entries = [];
  removeSink = addLogSink((entry) => entries.push(entry));
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, level).mockImplementation(() => {});
  }
});

afterEach(() => {
  removeSink();
  jest.restoreAllMocks();
});

describe('isAppleSignInAvailable', () => {
  it('is true on iOS when the module says so', async () => {
    expect(await isAppleSignInAvailable({ apple: apple.module, platform: 'ios' })).toBe(true);
  });

  it.each(['web', 'android'])('is false on %s without asking the module', async (platform) => {
    expect(await isAppleSignInAvailable({ apple: apple.module, platform })).toBe(false);
    expect(apple.module.isAvailableAsync).not.toHaveBeenCalled();
  });

  it('is false when the module says no or throws', async () => {
    expect(
      await isAppleSignInAvailable({ apple: createFakeApple(false).module, platform: 'ios' }),
    ).toBe(false);
    const broken = createFakeApple();
    (broken.module.isAvailableAsync as jest.Mock).mockRejectedValueOnce(new Error('no module'));
    expect(await isAppleSignInAvailable({ apple: broken.module, platform: 'ios' })).toBe(false);
  });
});

describe('signInWithApple', () => {
  it('sends Apple the hash of a fresh nonce and Supabase the raw nonce', async () => {
    const result = await run();

    expect(result).toEqual({
      ok: true,
      data: {
        id: 'apple-user',
        email: 'abc123@privaterelay.appleid.com',
        method: 'apple',
        name: null,
      },
    });
    const request = apple.signInAsync.mock.calls[0][0];
    expect(request.requestedScopes).toEqual([0, 1]); // FULL_NAME, EMAIL
    const [credentials] = fake.auth.signInWithIdToken.mock.calls[0];
    expect(credentials.provider).toBe('apple');
    expect(credentials.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(request.nonce).toBe(await nodeNonceCrypto.sha256Hex(credentials.nonce!));
    expect(request.nonce).not.toBe(credentials.nonce);
    expect(credentials.token.split('.')).toHaveLength(3);
  });

  it('uses a new nonce every time', async () => {
    await run();
    await run();
    const [a, b] = fake.auth.signInWithIdToken.mock.calls.map(([c]) => c.nonce);
    expect(a).not.toBe(b);
  });

  it('a cancelled sheet is `cancelled`, logged as info, and Supabase is never called', async () => {
    apple.answer({ kind: 'throw', code: 'ERR_REQUEST_CANCELED' });
    expect(await run()).toEqual({ ok: false, code: 'cancelled' });
    expect(fake.auth.signInWithIdToken).not.toHaveBeenCalled();
    expect(entries.map((e) => e.level)).toEqual(['info']);
  });

  it.each<[string, AuthErrorCode]>([
    ['ERR_REQUEST_NOT_HANDLED', 'method_unavailable'],
    ['ERR_REQUEST_NOT_INTERACTIVE', 'method_unavailable'],
    ['ERR_INVALID_OPERATION', 'method_unavailable'],
    ['ERR_REQUEST_FAILED', 'verification_failed'],
    ['ERR_INVALID_RESPONSE', 'verification_failed'],
    ['ERR_REQUEST_UNKNOWN', 'unknown'],
    ['SOMETHING_NEW', 'unknown'],
  ])('a sheet failing with %s is %s', async (code, expected) => {
    apple.answer({ kind: 'throw', code });
    expect(await run()).toEqual({ ok: false, code: expected });
    expect(fake.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('a credential without an identity token is refused before Supabase', async () => {
    apple.answer({ kind: 'ok', noToken: true });
    expect(await run()).toEqual({ ok: false, code: 'verification_failed' });
    expect(fake.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('a token whose nonce doesn’t match this request is refused before Supabase', async () => {
    apple.answer({ kind: 'ok', nonce: 'f'.repeat(64) });
    expect(await run()).toEqual({ ok: false, code: 'verification_failed' });
    expect(fake.auth.signInWithIdToken).not.toHaveBeenCalled();
    expect(entries).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ step: 'apple_nonce' }),
      }),
    ]);
  });

  it('a token that isn’t a readable JWT is refused before Supabase', async () => {
    apple.signInAsync.mockResolvedValueOnce({ identityToken: 'not-a-jwt', fullName: null });
    expect(await run()).toEqual({ ok: false, code: 'verification_failed' });
    expect(fake.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('is unavailable off iOS, or where the module says no, without opening a sheet', async () => {
    expect(await run({ platform: 'web' })).toEqual({ ok: false, code: 'method_unavailable' });
    expect(await run({ apple: createFakeApple(false).module })).toEqual({
      ok: false,
      code: 'method_unavailable',
    });
    expect(apple.signInAsync).not.toHaveBeenCalled();
  });

  it('is not_configured without a Supabase client', async () => {
    expect(await run({ client: null })).toEqual({ ok: false, code: 'not_configured' });
    expect(apple.signInAsync).not.toHaveBeenCalled();
  });

  it('a nonce that can’t be made is `unknown`, without opening a sheet', async () => {
    const result = await run({
      crypto: {
        randomBytes: () => {
          throw new Error('no entropy');
        },
        sha256Hex: nodeNonceCrypto.sha256Hex,
      },
    });
    expect(result).toEqual({ ok: false, code: 'unknown' });
    expect(apple.signInAsync).not.toHaveBeenCalled();
  });

  it.each<[string, unknown, AuthErrorCode]>([
    ['nonce mismatch', new AuthApiError('Nonces mismatch', 400, undefined), 'verification_failed'],
    [
      'nonce missing',
      new AuthApiError(
        'Passed nonce and nonce in id_token should either both exist or not.',
        400,
        undefined,
      ),
      'verification_failed',
    ],
    ['bad JWT', new AuthApiError('invalid JWT', 401, 'bad_jwt'), 'verification_failed'],
    [
      'audience not listed',
      new AuthApiError('Unacceptable audience in id_token: [host.exp.Exponent]', 400, undefined),
      'method_unavailable',
    ],
    [
      'Apple off',
      new AuthApiError('Provider not enabled', 400, 'provider_disabled'),
      'method_unavailable',
    ],
    ['rate limit', new AuthApiError('Too many', 429, 'over_request_rate_limit'), 'rate_limited'],
    [
      'signups off',
      new AuthApiError('Signups not allowed', 422, 'signup_disabled'),
      'signups_disabled',
    ],
    ['offline', new AuthRetryableFetchError('Failed to fetch', 0), 'network'],
    ['server error', new AuthApiError('boom', 500, undefined), 'unknown'],
  ])('Supabase refusing (%s) is %s', async (_name, error, expected) => {
    fake.auth.signInWithIdToken.mockResolvedValueOnce({
      data: { user: null, session: null },
      error,
    } as never);
    expect(await run()).toEqual({ ok: false, code: expected });
    expect(mapAppleTokenError(error)).toBe(expected);
  });

  it('a thrown Supabase call is mapped too', async () => {
    fake.auth.signInWithIdToken.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await run()).toEqual({ ok: false, code: 'network' });
  });

  it('an answer without a user is `unknown`', async () => {
    fake.auth.signInWithIdToken.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: null,
    } as never);
    expect(await run()).toEqual({ ok: false, code: 'unknown' });
  });

  describe('the name Apple shares the first time', () => {
    it('is returned, saved to the account, and in the SIGNED_IN event', async () => {
      const changes: AuthChange[] = [];
      const stop = onAuthChange((change) => changes.push(change), fake.client);
      await new Promise((resolve) => setTimeout(resolve, 0));
      fake.auth.signInWithIdToken.mockImplementationOnce(async () => {
        const user = appleUser();
        // supabase-js announces the session before signInWithIdToken returns.
        fake.emit('SIGNED_IN', fakeSession(user));
        return { data: { user, session: fakeSession(user) }, error: null } as never;
      });
      apple.answer({ kind: 'ok', fullName: { givenName: ' Sam ', familyName: 'Lee' } });

      const result = await run();
      await new Promise((resolve) => setTimeout(resolve, 0));
      stop();

      expect(result).toMatchObject({ ok: true, data: { name: 'Sam Lee' } });
      expect(fake.auth.updateUser).toHaveBeenCalledWith({ data: { full_name: 'Sam Lee' } });
      expect(changes.find((c) => c.event === 'SIGNED_IN')?.user?.name).toBe('Sam Lee');
    });

    it('is forgotten after the call: a later session event for an Apple user has no name', async () => {
      apple.answer({ kind: 'ok', fullName: { givenName: 'Sam', familyName: null } });
      await run();
      const changes: AuthChange[] = [];
      const stop = onAuthChange((change) => changes.push(change), fake.client);
      fake.emit('TOKEN_REFRESHED', fakeSession(appleUser()));
      await new Promise((resolve) => setTimeout(resolve, 0));
      stop();
      expect(changes.find((c) => c.event === 'TOKEN_REFRESHED')?.user?.name).toBeNull();
    });

    it('later sign-ins share no name, and nothing is saved', async () => {
      expect(await run()).toMatchObject({ ok: true, data: { name: null } });
      expect(fake.auth.updateUser).not.toHaveBeenCalled();
    });

    it('a name already on the account wins and isn’t saved again', async () => {
      fake.auth.signInWithIdToken.mockImplementationOnce(async () => {
        const user = appleUser({ full_name: 'Samantha Lee' });
        return { data: { user, session: fakeSession(user) }, error: null } as never;
      });
      apple.answer({ kind: 'ok', fullName: { givenName: 'Sam', familyName: 'Lee' } });
      expect(await run()).toMatchObject({ ok: true, data: { name: 'Samantha Lee' } });
      expect(fake.auth.updateUser).not.toHaveBeenCalled();
    });

    it('a failed save still signs in', async () => {
      fake.auth.updateUser.mockResolvedValueOnce({
        data: { user: null },
        error: new AuthApiError('nope', 500, undefined),
      } as never);
      apple.answer({ kind: 'ok', fullName: { givenName: 'Sam', familyName: 'Lee' } });
      expect(await run()).toMatchObject({ ok: true, data: { name: 'Sam Lee' } });
      fake.auth.updateUser.mockRejectedValueOnce(new Error('offline'));
      apple.answer({ kind: 'ok', fullName: { givenName: 'Sam', familyName: 'Lee' } });
      expect(await run()).toMatchObject({ ok: true });
    });
  });

  it('never logs the token, nonce, name, email or Apple user id', async () => {
    apple.answer({
      kind: 'ok',
      fullName: { givenName: 'Canaryname', familyName: 'Canarysurname' },
    });
    await run();
    const { nonce, token } = fake.auth.signInWithIdToken.mock.calls[0][0];
    const hashed = apple.signInAsync.mock.calls[0][0].nonce;
    // And on every failure path.
    apple.answer({ kind: 'ok', nonce: 'f'.repeat(64), fullName: { givenName: 'Canaryname' } });
    await run();
    apple.answer({ kind: 'throw', code: 'ERR_REQUEST_UNKNOWN' });
    await run();
    fake.auth.signInWithIdToken.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError(`Nonces mismatch for ${token}`, 400, undefined),
    } as never);
    await run();

    const text = logged();
    expect(entries.length).toBeGreaterThan(3);
    for (const secret of [
      nonce!,
      hashed,
      token,
      token.split('.')[1],
      'Canaryname',
      'Canarysurname',
      'privaterelay',
      'apple-sub-001',
      'apple-user',
      'mismatch',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('fakeIdentityToken', () => {
  it('is a three-part token', () => {
    expect(fakeIdentityToken({ nonce: 'x' }).split('.')).toHaveLength(3);
  });
});
