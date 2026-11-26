import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { MutationObserver } from '@tanstack/react-query';

import { MockRoomServer, newIdempotencyKey } from '@/features/room/mockServer';
import { createRoomStore } from '@/features/room/roomStore';
import { createAppleMusicCatalog } from '@/providers/apple/catalog';
import { mockNowPlaying, mockRooms } from '@/providers/mock/data';
import { createSpotifyApi } from '@/providers/spotify/api';
import { createSpotifyAuth } from '@/providers/spotify/auth';
import { connectSpotify, spotifyConnectionStatus } from '@/providers/spotify/connection';
import {
  createFakeSpotify,
  FAKE_CLIENT_ID,
  FAKE_REDIRECT,
  fakeAuthSession,
  nodePkceCrypto,
  splitUrl,
} from '@/test/fakeSpotify';
import { createFakeSupabase, fakeSession, fakeUser, type FakeSupabase } from '@/test/fakeSupabase';

import {
  clearProviderCredentials,
  completeAuthRedirect,
  exchangeAuthCode,
  fetchSavedProfile,
  resetCodeExchanges,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  signUpWithEmail,
} from './auth';
import { setCrashTransport, type CrashEvent } from './crashReporting';
import { EdgeFunctionNetworkError } from './edgeFunctions';
import { addLogSink, type LogEntry } from './logger';
import { createProviderCredentialStore } from './providerCredentials';
import { createQueryClient } from './queryClient';

/**
 * Runtime privacy check (Forge card "Logs and analytics privacy check").
 *
 * Every sensitive flow runs through the REAL app logger with recognizable
 * canary values. Three places are captured: a log sink (what any future sink
 * would get), the console (what Metro, Xcode and the device log would show)
 * and a crash-report transport (what a crash service would be sent). After
 * each flow, none of them may contain a canary.
 *
 * AGENTS.md: logs and analytics never contain tokens, emails, room codes or
 * listening history. The person's user id is checked too, because the auth
 * service promises never to log it.
 */

const CANARY = {
  email: 'canary.person@example.com',
  emailLocal: 'canary.person',
  password: 'Canary-Pa55word-zq',
  accessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYW5hcnkifQ.Q2FuYXJ5U2lnbmF0dXJl',
  refreshToken: 'canaryRefreshT0kenQwErTy',
  authCode: 'c4n4ry-4uth-c0de-77',
  userId: 'ca1a2b3c-0000-4000-8000-00000000ca17',
  roomCode: 'QD-K7CN4R',
  roomCodeBody: 'K7CN4R',
  inviteToken: 'Cn4ryInv1teT0kenAbCdEfGhIjKlMnOpQrStUvWxYz0',
  title: 'Velvet Canary Lullaby',
  artist: 'Pip Canarywood',
  album: 'Songs For Canaries',
  isrc: 'USCNR2600001',
  query: 'velvet canary',
  displayName: 'Canary Person',
} as const;

let entries: LogEntry[];
let consoleOutput: unknown[][];
let crashEvents: CrashEvent[];
let removeSink: () => void;

beforeEach(() => {
  entries = [];
  consoleOutput = [];
  crashEvents = [];
  removeSink = addLogSink((entry) => entries.push(entry));
  setCrashTransport((event) => void crashEvents.push(event));
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation((...args) => void consoleOutput.push(args));
  }
  resetCodeExchanges();
});

afterEach(() => {
  removeSink();
  setCrashTransport(null);
  jest.restoreAllMocks();
});

/** Everything the three captures hold, as one string. */
function captured(): string {
  return JSON.stringify({ entries, consoleOutput, crashEvents });
}

/** Fails naming every canary that leaked. */
function expectNoCanary(extra: readonly string[] = []) {
  const text = captured();
  const leaked = [...Object.values(CANARY), ...extra].filter(
    (canary) => canary !== '' && text.includes(canary),
  );
  expect(leaked).toEqual([]);
}

// ---------------------------------------------------------------------------
// Sign-in and account creation

describe('email sign-in and sign-up', () => {
  let fake: FakeSupabase;
  const form = { email: ` ${CANARY.email.toUpperCase()} `, password: CANARY.password };
  const user = () =>
    fakeUser({
      id: CANARY.userId,
      email: CANARY.email,
      user_metadata: { full_name: CANARY.displayName },
    });

  beforeEach(() => {
    fake = createFakeSupabase();
  });

  it.each([
    [
      'wrong password, echoing the input',
      new AuthApiError(
        `Invalid login for ${CANARY.email} with ${CANARY.password}`,
        400,
        'invalid_credentials',
      ),
    ],
    [
      'server error with the request in its message',
      new AuthApiError(
        `500: {"email":"${CANARY.email}","password":"${CANARY.password}"}`,
        500,
        'unexpected_failure',
      ),
    ],
    ['rate limited', new AuthApiError(`Too many tries for ${CANARY.email}`, 429, undefined)],
    ['offline', new AuthRetryableFetchError(`fetch ${CANARY.email} failed`, 0)],
  ])('sign-in failure: %s', async (_label, error) => {
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error,
    } as never);
    expect(await signInWithEmail(form, fake.client)).toMatchObject({ ok: false });
    expect(entries.length).toBeGreaterThan(0);
    expectNoCanary();
  });

  it('a sign-in call that throws with the password in its message', async () => {
    fake.auth.signInWithPassword.mockRejectedValueOnce(
      new TypeError(`Network request failed for ${CANARY.email}:${CANARY.password}`),
    );
    expect(await signInWithEmail(form, fake.client)).toEqual({ ok: false, code: 'network' });
    expectNoCanary();
  });

  it('a thrown error whose `code` is free text logs it as `other`', async () => {
    // Some libraries put words, not a code, in `code`.
    fake.auth.signInWithPassword.mockRejectedValueOnce(
      Object.assign(new Error('failed'), { code: `${CANARY.title} by ${CANARY.artist}` }),
    );
    expect(await signInWithEmail(form, fake.client)).toEqual({ ok: false, code: 'unknown' });
    expect(entries.at(-1)?.context).toMatchObject({ supabaseErrorCode: 'other' });
    expectNoCanary();
  });

  it('a successful sign-in logs the method only', async () => {
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: user(), session: { ...fakeSession(user()), access_token: CANARY.accessToken } },
      error: null,
    } as never);
    expect(await signInWithEmail(form, fake.client)).toMatchObject({ ok: true });
    expect(entries.map((entry) => entry.context)).toEqual([{ method: 'email' }]);
    expectNoCanary();
  });

  it.each([
    ['weak password', new AuthApiError(`Weak: ${CANARY.password}`, 422, 'weak_password')],
    ['taken', new AuthApiError(`${CANARY.email} exists`, 422, 'user_already_exists')],
    ['unknown', new AuthApiError(`boom ${CANARY.email}`, 500, undefined)],
  ])('sign-up failure: %s', async (_label, error) => {
    fake.auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error } as never);
    expect(await signUpWithEmail(form, {}, fake.client)).toMatchObject({ ok: false });
    expectNoCanary();
  });

  it('sign-up for an existing email behind confirmation, and a new account', async () => {
    fake.auth.signUp.mockResolvedValueOnce({
      data: { user: { ...user(), identities: [] }, session: null },
      error: null,
    } as never);
    expect(await signUpWithEmail(form, {}, fake.client)).toEqual({
      ok: false,
      code: 'email_taken',
    });
    fake.auth.signUp.mockResolvedValueOnce({
      data: { user: user(), session: null },
      error: null,
    } as never);
    expect(await signUpWithEmail(form, {}, fake.client)).toMatchObject({ ok: true });
    expectNoCanary();
  });

  it('a failed profile read and a failed credential wipe', async () => {
    fake.setProfile(null, { code: 'PGRST301' });
    expect(await fetchSavedProfile(CANARY.userId, fake.client)).toBeNull();
    fake.profileQuery.maybeSingle.mockRejectedValueOnce(
      new Error(`row for ${CANARY.userId} ${CANARY.displayName} ${CANARY.email}`),
    );
    expect(await fetchSavedProfile(CANARY.userId, fake.client)).toBeNull();
    await clearProviderCredentials({
      clearAll: async () => {
        throw Object.assign(new Error(`could not delete ${CANARY.refreshToken}`), {
          code: CANARY.accessToken,
        });
      },
    });
    expect(entries).toHaveLength(3);
    expectNoCanary();
  });

  it('sign-out that fails', async () => {
    fake.auth.signOut.mockRejectedValueOnce(new Error(`revoke ${CANARY.accessToken} failed`));
    await signOut(fake.client);
    expectNoCanary();
  });
});

describe('Google and the auth callback', () => {
  let fake: FakeSupabase;
  const REDIRECT = 'qd://auth/callback';

  beforeEach(() => {
    fake = createFakeSupabase();
  });

  it('a redirect with the PKCE code whose exchange fails, echoing the code and verifier', async () => {
    fake.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError(
        `code ${CANARY.authCode} and verifier ${CANARY.refreshToken} don't match`,
        400,
        'bad_code_verifier',
      ),
    } as never);
    const result = await completeAuthRedirect(`${REDIRECT}?code=${CANARY.authCode}`, fake.client);
    expect(result).toEqual({ ok: false, code: 'link_invalid' });
    expectNoCanary();
  });

  it('an exchange that throws, then one that works', async () => {
    fake.auth.exchangeCodeForSession.mockRejectedValueOnce(
      new Error(`POST /token?grant_type=pkce&auth_code=${CANARY.authCode} failed`),
    );
    await exchangeAuthCode(CANARY.authCode, fake.client);
    const user = fakeUser({ id: CANARY.userId, email: CANARY.email });
    fake.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { user, session: fakeSession(user) },
      error: null,
    } as never);
    expect(await exchangeAuthCode(CANARY.authCode, fake.client)).toMatchObject({ ok: true });
    expectNoCanary();
  });

  it.each([
    `?error=server_error&error_description=${encodeURIComponent(`${CANARY.email} ${CANARY.title}`)}`,
    `#error=${encodeURIComponent(CANARY.title)}&error_code=${encodeURIComponent(CANARY.email)}`,
    `?error=access_denied&error_code=${encodeURIComponent(`${CANARY.artist} ${CANARY.roomCode}`)}`,
    `?state=${CANARY.inviteToken}`,
  ])('a crafted callback link %s', async (suffix) => {
    expect(await completeAuthRedirect(`${REDIRECT}${suffix}`, fake.client)).toMatchObject({
      ok: false,
    });
    expect(entries.length).toBeGreaterThan(0);
    expectNoCanary();
  });

  it('the Google sheet: OAuth URL with state, then a crafted error', async () => {
    fake.auth.signInWithOAuth.mockResolvedValueOnce({
      data: {
        provider: 'google',
        url: `https://abcd.supabase.co/auth/v1/authorize?provider=google&state=${CANARY.inviteToken}`,
      },
      error: null,
    } as never);
    const browser = {
      openAuthSessionAsync: jest.fn(async () => ({
        type: 'success',
        url: `${REDIRECT}?error=${encodeURIComponent(CANARY.email)}&state=${CANARY.inviteToken}`,
      })),
    };
    await signInWithGoogle(REDIRECT, { client: fake.client, browser, platform: 'ios' });
    // The sheet throws with the authorize URL in its message.
    fake.auth.signInWithOAuth.mockResolvedValueOnce({
      data: {
        provider: 'google',
        url: `https://abcd.supabase.co/authorize?state=${CANARY.inviteToken}`,
      },
      error: null,
    } as never);
    browser.openAuthSessionAsync.mockRejectedValueOnce(
      new Error(`could not open https://abcd.supabase.co/authorize?state=${CANARY.inviteToken}`),
    );
    await signInWithGoogle(REDIRECT, { client: fake.client, browser, platform: 'ios' });
    expectNoCanary();
  });
});

// ---------------------------------------------------------------------------
// Music-service credentials and Spotify

describe('Spotify connect, refresh, 401 and 403', () => {
  const NOW = 1_000_000;

  function setup() {
    const fake = createFakeSpotify({ now: () => NOW });
    const session = fakeAuthSession(fake);
    const auth = createSpotifyAuth({
      clientId: FAKE_CLIENT_ID,
      redirectUri: FAKE_REDIRECT,
      fetch: fake.fetch,
      crypto: nodePkceCrypto,
      openAuthSession: session.open,
      store: fake.store,
      now: () => NOW,
    });
    return { fake, session, auth, api: createSpotifyApi({ auth, fetch: fake.fetch }) };
  }

  /** Every token, code, verifier and state the fake handed out. */
  function spotifySecrets(fake: ReturnType<typeof createFakeSpotify>, opened: string[]) {
    const secrets = [...fake.validAccess, ...fake.validRefresh];
    for (let i = 1; i <= 6; i += 1) secrets.push(`fake-access-${i}`, `fake-refresh-${i}`);
    for (const url of opened) {
      const { query } = splitUrl(url);
      secrets.push(query.state, query.code_challenge);
    }
    for (const call of fake.calls) {
      const verifier = /code_verifier=([^&]+)/.exec(String(call.body ?? ''))?.[1];
      if (verifier) secrets.push(decodeURIComponent(verifier));
    }
    return secrets.filter(Boolean);
  }

  it('connect, refused refresh, 401 and 403 with song data in Spotify’s answer', async () => {
    const { fake, session, auth, api } = setup();
    await connectSpotify(auth, api);
    await fake.connectAccount();

    // A 403 whose reason and message carry song data and the token.
    fake.script('PUT', '/v1/me/player/play', {
      status: 403,
      body: {
        error: {
          status: 403,
          message: `Bearer fake-access-1 cannot play ${CANARY.title}`,
          reason: `${CANARY.title} by ${CANARY.artist}`,
        },
      },
    });
    await api.request({ method: 'PUT', path: '/me/player/play' }).catch(() => {});

    // A queue add whose URI is never logged.
    fake.script('POST', '/v1/me/player/queue', {
      status: 500,
      body: { error: { status: 500, message: `spotify:track:CanaryTrack123 ${CANARY.isrc}` } },
    });
    await api
      .request({
        method: 'POST',
        path: '/me/player/queue',
        query: { uri: 'spotify:track:CanaryTrack123' },
      })
      .catch(() => {});

    // A refresh Spotify refuses with free text, then a 401 on the new token.
    fake.validAccess.clear();
    fake.script('POST', '/api/token', {
      status: 400,
      body: { error: `invalid_grant for ${CANARY.email}`, error_description: CANARY.refreshToken },
    });
    await api.request({ method: 'GET', path: '/me/player' }).catch(() => {});
    await spotifyConnectionStatus(auth, api);

    expect(entries.some((entry) => entry.level === 'warn')).toBe(true);
    expectNoCanary([
      ...spotifySecrets(
        fake,
        session.opened.map((o) => o.url),
      ),
      'CanaryTrack123',
    ]);
  });

  it('logs Spotify’s machine reason, and `other` for anything else', async () => {
    const { fake, auth, api } = setup();
    await connectSpotify(auth, api);
    await fake.connectAccount();
    for (const reason of ['UNKNOWN', `${CANARY.title} is restricted`]) {
      fake.script('PUT', '/v1/me/player/play', {
        status: 403,
        body: { error: { status: 403, message: 'refused', reason } },
      });
      await api.request({ method: 'PUT', path: '/me/player/play' }).catch(() => {});
    }
    const reasons = entries
      .filter((entry) => entry.message === 'Spotify request failed')
      .map((entry) => entry.context?.reason);
    expect(reasons).toEqual(['UNKNOWN', 'other']);
    expectNoCanary();
  });

  it('credential storage failures never log the credentials', async () => {
    const broken = createProviderCredentialStore({
      persistent: true,
      getItem: async () => {
        throw new Error(`read failed near ${CANARY.accessToken}`);
      },
      setItem: async (_key, value) => {
        throw new Error(`keychain refused ${value}`);
      },
      deleteItem: async () => {
        throw new Error(`delete failed ${CANARY.refreshToken}`);
      },
    });
    await broken
      .save('spotify', {
        accessToken: CANARY.accessToken,
        refreshToken: CANARY.refreshToken,
        expiresAt: 1,
      })
      .catch(() => {});
    await broken.load('spotify');
    await broken.clear('spotify').catch(() => {});
    expect(entries).toHaveLength(3);
    expect(crashEvents.length).toBeGreaterThan(0);
    expectNoCanary();
  });
});

// ---------------------------------------------------------------------------
// Rooms, invites, the queue, search and provider switching

describe('rooms, invites and the queue', () => {
  it('join by code: wrong code, rate limited, then a real one', async () => {
    const server = new MockRoomServer(() => 0);
    for (let i = 0; i < 6; i += 1) {
      await server.joinRoomByCode({ code: CANARY.roomCode, idempotencyKey: newIdempotencyKey() });
    }
    await server.joinRoomByCode({ code: mockRooms[0].code, idempotencyKey: newIdempotencyKey() });
    expect(captured()).not.toContain(mockRooms[0].code);
    expectNoCanary();
  });

  it('invites: create as host and guest, join with a good and a wrong token', async () => {
    const server = new MockRoomServer(() => 0);
    const made = await server.createRoomInvite({
      roomCode: CANARY.roomCode,
      asHost: true,
      idempotencyKey: newIdempotencyKey(),
    });
    await server.createRoomInvite({
      roomCode: CANARY.roomCode,
      asHost: false,
      idempotencyKey: newIdempotencyKey(),
    });
    const token = made.ok ? made.value.token : '';
    expect(token).not.toBe('');
    await server.joinRoomByInvite({ token, idempotencyKey: newIdempotencyKey() });
    await server.joinRoomByInvite({
      token: CANARY.inviteToken,
      idempotencyKey: newIdempotencyKey(),
    });
    expectNoCanary([token]);
  });

  it('enqueue (twice, duplicate), reorder, remove, advance and switch provider', () => {
    const store = createRoomStore(() => 0);
    const ref = { code: mockRooms[0].code };
    const song = { ...mockNowPlaying, id: 'canary', title: CANARY.title, artist: CANARY.artist };
    const first = store.enqueue(ref, song, CANARY.displayName);
    store.enqueue(ref, song, CANARY.displayName);
    store.enqueue(ref, song, CANARY.displayName, true);
    if (first.ok) {
      store.move(ref, first.entryId, null);
      store.remove(ref, first.entryId);
    }
    const playing = store.get(ref).nowPlaying;
    store.switchProvider(ref, {
      forEntryId: playing?.entryId ?? 'none',
      to: 'apple_music',
      isHost: false,
      songStarted: false,
      playsThrough: 'spotify',
      hostConnected: ['spotify'],
    });
    if (playing) store.advance(ref, playing.entryId, 'unavailable');
    expectNoCanary();
  });

  it('catalog search errors never log the query', async () => {
    const answers = [
      { status: 429, body: { code: 'rate_limited', retry_after_seconds: 12 } },
      { status: 500, body: { message: `search for ${CANARY.query} failed` } },
      { status: 400, body: { code: 'invalid_input', field: 'query', echo: CANARY.query } },
      { status: 200, body: { results: [{ title: CANARY.title }] } },
    ];
    const queries: unknown[] = [];
    let call = 0;
    const catalog = createAppleMusicCatalog({
      invoke: async (_name, body) => {
        queries.push(body);
        if (call === answers.length) {
          call += 1;
          throw new EdgeFunctionNetworkError('timeout');
        }
        if (call > answers.length) throw new Error(`fetch failed: ${CANARY.query}`);
        return answers[call++];
      },
    });
    for (let i = 0; i < answers.length + 2; i += 1) {
      await catalog.search(CANARY.query, 'US').catch(() => {});
    }
    expect(queries).toHaveLength(answers.length + 2);
    expectNoCanary();
  });
});

describe('server-state errors (queries and mutations)', () => {
  it('a not-null violation whose details hold the failing row', async () => {
    const client = createQueryClient();
    const observer = new MutationObserver(client, {
      mutationFn: async () => {
        throw {
          code: '23502',
          message: 'null value in column "position" of relation "queue_entries"',
          details: `Failing row contains (5d1c, ${CANARY.title}, ${CANARY.artist}, ${CANARY.album}, ${CANARY.isrc}, ${CANARY.roomCodeBody}, ${CANARY.displayName}).`,
          hint: null,
        };
      },
      meta: { scope: 'queue.enqueue' },
    });
    await observer.mutate().catch(() => {});
    expect(entries.map((entry) => entry.message)).toEqual(['Mutation failed']);
    expect(captured()).toContain('queue.enqueue');
    expectNoCanary();
    client.clear();
  });

  it('a failed query keyed by room code and search query', async () => {
    const client = createQueryClient();
    await client
      .fetchQuery({
        queryKey: ['room', CANARY.roomCode, 'search', CANARY.query],
        queryFn: async () => {
          throw Object.assign(new Error(`not a member of ${CANARY.roomCode}`), {
            // A library that puts words in `code`.
            code: `${CANARY.title} ${CANARY.artist}`,
            details: { invite: CANARY.inviteToken, email: CANARY.email },
          });
        },
        retry: false,
      })
      .catch(() => {});
    expect(entries).toHaveLength(1);
    expectNoCanary();
    client.clear();
  });
});
