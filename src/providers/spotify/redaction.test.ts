import {
  createFakeSpotify,
  FAKE_CLIENT_ID,
  FAKE_REDIRECT,
  fakeAuthSession,
  nodePkceCrypto,
  splitUrl,
  type FakeSpotify,
} from '@/test/fakeSpotify';

import { createSpotifyApi } from './api';
import { createSpotifyAuth, type OpenAuthSession } from './auth';
import { connectSpotify, spotifyConnectionStatus } from './connection';

/**
 * Tokens, codes, verifiers and state never reach a log, an error message or
 * anywhere but the credential store and Spotify. The logger is replaced with
 * one that records the raw arguments, before redaction, so this checks what
 * the Spotify code hands the logger, not what redaction later removes.
 */

jest.mock('@/services/logger', () => {
  const raw: unknown[] = [];
  const make = (scope: string): unknown => ({
    debug: (...args: unknown[]) => raw.push([scope, 'debug', ...args]),
    info: (...args: unknown[]) => raw.push([scope, 'info', ...args]),
    warn: (...args: unknown[]) => raw.push([scope, 'warn', ...args]),
    error: (...args: unknown[]) => raw.push([scope, 'error', ...args]),
    child: (child: string) => make(`${scope}.${child}`),
  });
  return { log: make('app'), __raw: raw };
});

const raw = (jest.requireMock('@/services/logger') as { __raw: unknown[] }).__raw;

/** Everything a value could show, Errors included. */
function dump(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
  );
}

const NOW = 1_000_000;
let fake: FakeSpotify;
let consoleOutput: unknown[];

beforeEach(() => {
  raw.length = 0;
  consoleOutput = [];
  fake = createFakeSpotify({ now: () => NOW });
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation((...args) => consoleOutput.push(args));
  }
});

afterEach(() => jest.restoreAllMocks());

/** Every secret the fake handed out or the flow made up. */
function secrets(opened: { url: string }[]): string[] {
  const values = [...fake.validAccess, ...fake.validRefresh, 'fake-auth-code'];
  for (let i = 1; i <= 10; i += 1) values.push(`fake-access-${i}`, `fake-refresh-${i}`);
  for (const { url } of opened) {
    const { query } = splitUrl(url);
    values.push(query.state, query.code_challenge);
  }
  for (const call of fake.tokenCalls()) {
    const verifier = splitUrl(`https://x/?${call.body}`).query.code_verifier;
    if (verifier) values.push(verifier);
  }
  return values.filter(Boolean);
}

function expectNoSecrets(opened: { url: string }[], ...errors: unknown[]) {
  const text = dump(raw) + dump(consoleOutput) + dump(errors);
  for (const secret of secrets(opened)) {
    expect(text).not.toContain(secret);
  }
}

function setup(open?: OpenAuthSession) {
  const session = fakeAuthSession(fake);
  const auth = createSpotifyAuth({
    clientId: FAKE_CLIENT_ID,
    redirectUri: FAKE_REDIRECT,
    fetch: fake.fetch,
    crypto: nodePkceCrypto,
    openAuthSession: open ?? session.open,
    store: fake.store,
    now: () => NOW,
  });
  return {
    auth,
    api: createSpotifyApi({ auth, fetch: fake.fetch, sleep: async () => {} }),
    session,
  };
}

async function caught(promise: Promise<unknown>) {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('Spotify credentials stay out of logs and errors', () => {
  it('in a successful connect', async () => {
    const { auth, api, session } = setup();
    await connectSpotify(auth, api);
    expectNoSecrets(session.opened);
  });

  it('when the state doesn’t match', async () => {
    const session = fakeAuthSession(fake, () => ({
      type: 'success',
      url: `${FAKE_REDIRECT}?code=fake-auth-code&state=forged-state-value`,
    }));
    const { auth, api } = setup(session.open);
    await connectSpotify(auth, api);
    expect(raw.length).toBeGreaterThan(0);
    expectNoSecrets(session.opened);
    expect(dump(raw)).not.toContain('forged-state-value');
  });

  it('when the code exchange is refused with a body that echoes it', async () => {
    fake.script('POST', '/api/token', {
      status: 400,
      body: { error: 'invalid_grant', error_description: 'Invalid code fake-auth-code' },
    });
    const { auth, api, session } = setup();
    await connectSpotify(auth, api);
    expect(raw.length).toBeGreaterThan(0);
    expectNoSecrets(session.opened);
  });

  it('when a refresh is refused, and on 401s, 403s and network failures', async () => {
    const { auth, api } = setup();
    await fake.connectAccount();
    const errors: unknown[] = [];

    fake.validAccess.delete('fake-access-1');
    await api.request({ method: 'GET', path: '/me/player' });

    fake.script('PUT', '/v1/me/player/play', {
      status: 403,
      body: { error: { status: 403, message: 'Premium required', reason: 'PREMIUM_REQUIRED' } },
    });
    errors.push(await caught(api.request({ method: 'PUT', path: '/me/player/play' })));

    fake.script('GET', '/v1/me/player', 'network_error');
    errors.push(await caught(api.request({ method: 'GET', path: '/me/player' })));

    fake.revokeAll();
    errors.push(await caught(api.request({ method: 'GET', path: '/me/player' })));
    expect(await spotifyConnectionStatus(auth, api)).toMatchObject({
      status: 'needs_authorization',
    });

    expect(errors.every(Boolean)).toBe(true);
    expect(raw.length).toBeGreaterThan(0);
    expectNoSecrets([], ...errors);
  });

  it('never sends a token anywhere but Spotify, and only as a bearer header or token form', async () => {
    const { auth, api } = setup();
    await connectSpotify(auth, api);
    for (const call of fake.calls) {
      expect(call.url).toMatch(/^https:\/\/(accounts|api)\.spotify\.com\//);
      // Tokens never ride in a URL.
      expect(call.url).not.toMatch(/fake-(access|refresh)/);
    }
  });
});
