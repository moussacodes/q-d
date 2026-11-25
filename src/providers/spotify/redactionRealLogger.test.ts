import { addLogSink, type LogEntry } from '@/services/logger';
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
 * redaction.test.ts checks what the Spotify code hands the logger. This one
 * keeps the real logger and checks what actually reaches a sink (the console
 * and the crash-report sink), end to end.
 */

const NOW = 1_000_000;
let fake: FakeSpotify;
let entries: LogEntry[];
let consoleOutput: unknown[];
let removeSink: () => void;

beforeEach(() => {
  fake = createFakeSpotify({ now: () => NOW });
  entries = [];
  consoleOutput = [];
  removeSink = addLogSink((entry) => entries.push(entry));
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation((...args) => consoleOutput.push(args));
  }
});

afterEach(() => {
  removeSink();
  jest.restoreAllMocks();
});

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
    api: createSpotifyApi({ auth, fetch: fake.fetch }),
    session,
  };
}

function expectClean(secrets: string[]) {
  const text = JSON.stringify(entries) + JSON.stringify(consoleOutput);
  for (const secret of secrets.filter(Boolean)) expect(text).not.toContain(secret);
}

it('a sheet that fails with the authorize URL in its message logs no state or challenge', async () => {
  const opened: string[] = [];
  const { auth, api } = setup(async (url) => {
    opened.push(url);
    throw new Error(`Could not open ${url}`);
  });
  expect(await connectSpotify(auth, api)).toMatchObject({ status: 'error', code: 'auth_failed' });
  expect(entries.length).toBeGreaterThan(0);
  const { query } = splitUrl(opened[0]);
  expectClean([query.state, query.code_challenge, opened[0]]);
});

it('refused exchanges, refreshes, 401s, 403s and outages reach the sinks without secrets', async () => {
  fake.script('POST', '/api/token', {
    status: 400,
    body: { error: 'invalid_grant', error_description: 'Invalid code fake-auth-code' },
  });
  const { auth, api, session } = setup();
  await connectSpotify(auth, api);

  await fake.connectAccount();
  fake.validAccess.delete('fake-access-1');
  await api.request({ method: 'GET', path: '/me/player' });
  fake.script('PUT', '/v1/me/player/play', {
    status: 403,
    body: { error: { status: 403, message: 'Bearer fake-access-2 refused', reason: 'UNKNOWN' } },
  });
  await api.request({ method: 'PUT', path: '/me/player/play' }).catch(() => {});
  fake.script('GET', '/v1/me/player', 'network_error');
  await api.request({ method: 'GET', path: '/me/player' }).catch(() => {});
  fake.revokeAll();
  await spotifyConnectionStatus(auth, api);

  expect(entries.some((entry) => entry.level === 'warn')).toBe(true);
  const secrets = [...fake.validAccess, ...fake.validRefresh, 'fake-auth-code'];
  for (let i = 1; i <= 5; i += 1) secrets.push(`fake-access-${i}`, `fake-refresh-${i}`);
  for (const { url } of session.opened) secrets.push(splitUrl(url).query.state);
  expectClean(secrets);
});
