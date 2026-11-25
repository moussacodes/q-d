/**
 * The catalog-search handler with a fake Apple, fake token and fake database:
 * request checks, every error code, and what reaches Apple and the database.
 */
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CatalogTrack } from '../../functions/catalog-search/apple';
import { createCatalogStore } from '../../functions/catalog-search/db';
import { ServiceError } from '../../functions/catalog-search/errors';
import {
  createHandler,
  parseSearchRequest,
  retryAfterSeconds,
  userIdFrom,
  type CatalogSearchDeps,
} from '../../functions/catalog-search/handler';
import { handlerFromEnv } from '../../functions/catalog-search/index';

const songs = readFileSync(join(__dirname, '..', 'fixtures', 'apple-search-songs.json'), 'utf8');
const empty = readFileSync(join(__dirname, '..', 'fixtures', 'apple-search-empty.json'), 'utf8');
const unauthorized = readFileSync(
  join(__dirname, '..', 'fixtures', 'apple-error-unauthorized.json'),
  'utf8',
);

const USER = '6f1c2a52-6a3b-4a43-8a4e-2f0f6f7f9a10';
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** A JWT-shaped string. Supabase verifies the signature before the function runs. */
const jwt = (payload: Record<string, unknown>) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJl`;
const userJwt = jwt({ sub: USER, role: 'authenticated' });

const recordingId = (trackId: string) => `00000000-0000-4000-8000-${trackId.padStart(12, '0')}`;

type Fake = {
  deps: CatalogSearchDeps;
  appleCalls: { url: string; init: RequestInit }[];
  saved: CatalogTrack[][];
  consumed: string[];
  cleared: number;
};

function fake(
  apple: (url: string, init: RequestInit) => Promise<Response> = async () =>
    new Response(songs, { status: 200 }),
  overrides: Partial<CatalogSearchDeps> = {},
): Fake {
  const state: Fake = {
    appleCalls: [],
    saved: [],
    consumed: [],
    cleared: 0,
    deps: undefined as unknown as CatalogSearchDeps,
  };
  state.deps = {
    fetch: (url, init) => {
      state.appleCalls.push({ url, init });
      return apple(url, init);
    },
    tokens: {
      get: async () => 'developer-token-secret',
      clear: () => {
        state.cleared += 1;
      },
    },
    consumeSearch: async (userId) => {
      state.consumed.push(userId);
    },
    saveTracks: async (tracks) => {
      state.saved.push(tracks);
      return new Map(tracks.map((t) => [t.providerTrackId, recordingId(t.providerTrackId)]));
    },
    ...overrides,
  };
  return state;
}

const post = (body: unknown, authorization: string | null = `Bearer ${userJwt}`) =>
  new Request('http://localhost/catalog-search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function call(state: Fake, request: Request) {
  const response = await createHandler(state.deps)(request);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

describe('catalog-search handler · happy path', () => {
  it('searches Apple, saves the songs and answers with recording ids', async () => {
    const state = fake();
    const { response, body } = await call(state, post({ query: '  Paper   Lanterns ', limit: 5 }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.appleCalls).toHaveLength(1);
    expect(state.appleCalls[0].url).toBe(
      'https://api.music.apple.com/v1/catalog/us/search?term=Paper+Lanterns&types=songs&limit=5',
    );
    expect(state.appleCalls[0].init.headers).toMatchObject({
      authorization: 'Bearer developer-token-secret',
    });
    expect(state.consumed).toEqual([USER]);
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0].map((t) => t.versionTags)).toEqual([[], [], ['live'], [], ['sped_up']]);

    expect(body.storefront).toBe('us');
    expect(body.results.map((r: { recordingId: string }) => r.recordingId)).toEqual(
      ['9000000001', '9000000002', '9000000003', '9000000004', '9000000007'].map(recordingId),
    );
    expect(body.results[0]).toEqual({
      recordingId: recordingId('9000000001'),
      availableOn: ['apple_music'],
      track: {
        provider: 'apple_music',
        providerTrackId: '9000000001',
        title: 'Paper Lanterns',
        artists: ['The Fixture Band'],
        album: 'Synthetic Weather',
        durationMs: 214000,
        isrc: 'QZSYN2600001',
        explicit: true,
        artworkUrl: 'https://artwork.example.test/image/thumb/Synthetic/a1/{w}x{h}bb.jpg',
        artworkBackgroundColor: '#1A2B3C',
      },
    });
  });

  it('never sends the developer token or Apple ids anywhere but Apple', async () => {
    const state = fake();
    const { body } = await call(state, post({ query: 'paper' }));
    expect(JSON.stringify(body)).not.toContain('developer-token-secret');
  });

  it('uses the storefront asked for, lowercased', async () => {
    const state = fake();
    const { body } = await call(state, post({ query: 'paper', storefront: 'GB' }));
    expect(state.appleCalls[0].url).toContain('/v1/catalog/gb/search?');
    expect(body.storefront).toBe('gb');
  });

  it('answers an empty search without touching the database', async () => {
    const state = fake(async () => new Response(empty, { status: 200 }));
    const { response, body } = await call(state, post({ query: 'nothing matches' }));
    expect(response.status).toBe(200);
    expect(body).toEqual({ storefront: 'us', results: [] });
    expect(state.saved).toEqual([]);
  });

  it('leaves out a song the database did not save', async () => {
    const state = fake(undefined, {
      saveTracks: async (tracks) => new Map([[tracks[1].providerTrackId, recordingId('2')]]),
    });
    const { body } = await call(state, post({ query: 'paper' }));
    expect(
      body.results.map((r: { track: { providerTrackId: string } }) => r.track.providerTrackId),
    ).toEqual(['9000000002']);
  });

  it('answers a CORS preflight for the web preview', async () => {
    const response = await createHandler(fake().deps)(
      new Request('http://localhost/catalog-search', { method: 'OPTIONS' }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
  });
});

describe('catalog-search handler · request checks', () => {
  it('accepts POST only', async () => {
    const state = fake();
    const { response, body } = await call(
      state,
      new Request('http://localhost/catalog-search', { method: 'GET' }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST, OPTIONS');
    expect(body).toEqual({ code: 'invalid_input', field: 'method' });
  });

  it.each([
    ['no authorization header', null],
    ['a non-bearer header', `Basic ${userJwt}`],
    ['a token that is not a JWT', 'Bearer abc'],
    ['the anon key (a JWT without sub)', `Bearer ${jwt({ role: 'anon' })}`],
    ['a JWT whose payload is not JSON', 'Bearer aGVhZGVy.bm90LWpzb24.c2ln'],
  ])('needs a signed-in user: %s', async (_name, authorization) => {
    const state = fake();
    const { response, body } = await call(state, post({ query: 'paper' }, authorization));
    expect(response.status).toBe(401);
    expect(body).toEqual({ code: 'not_authenticated' });
    expect(state.appleCalls).toEqual([]);
    expect(state.consumed).toEqual([]);
  });

  it.each<[string, unknown, string]>([
    ['a body that is not JSON', '{nope', 'body'],
    ['an array body', [], 'body'],
    ['no query', {}, 'query'],
    ['a number query', { query: 5 }, 'query'],
    ['a blank query', { query: '   ' }, 'query'],
    ['a query over 100 characters', { query: 'x'.repeat(101) }, 'query'],
    ['a fractional limit', { query: 'paper', limit: 2.5 }, 'limit'],
    ['a string limit', { query: 'paper', limit: '5' }, 'limit'],
    ['a zero limit', { query: 'paper', limit: 0 }, 'limit'],
    ['a limit over 25', { query: 'paper', limit: 26 }, 'limit'],
    ['a three-letter storefront', { query: 'paper', storefront: 'usa' }, 'storefront'],
    ['a storefront with a path', { query: 'paper', storefront: '../' }, 'storefront'],
    ['a number storefront', { query: 'paper', storefront: 1 }, 'storefront'],
  ])('rejects %s with invalid_input', async (_name, body, field) => {
    const state = fake();
    const { response, body: answer } = await call(state, post(body));
    expect(response.status).toBe(400);
    expect(answer).toEqual({ code: 'invalid_input', field });
    expect(state.appleCalls).toEqual([]);
    expect(state.consumed).toEqual([]);
  });

  it('accepts the edges of each range', () => {
    expect(parseSearchRequest({ query: 'x'.repeat(100), limit: 25, storefront: 'jp' })).toEqual({
      query: 'x'.repeat(100),
      limit: 25,
      storefront: 'jp',
    });
    expect(parseSearchRequest({ query: 'a', limit: 1 })).toEqual({
      query: 'a',
      limit: 1,
      storefront: 'us',
    });
    expect(parseSearchRequest({ query: 'a' }).limit).toBe(20);
  });
});

describe('catalog-search handler · limits and provider errors', () => {
  it('stops at the per-user search limit before calling Apple', async () => {
    const state = fake(undefined, {
      consumeSearch: async () => {
        throw new ServiceError(429, 'rate_limited', { retry_after_seconds: 12 });
      },
    });
    const { response, body } = await call(state, post({ query: 'paper' }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('12');
    expect(body).toEqual({ code: 'rate_limited', retry_after_seconds: 12 });
    expect(state.appleCalls).toEqual([]);
  });

  it('answers provider_unavailable without counting a search when the Apple secrets are missing', async () => {
    const state = fake(undefined, { tokens: null });
    const { response, body } = await call(state, post({ query: 'paper' }));
    expect(response.status).toBe(502);
    expect(body).toEqual({
      code: 'provider_unavailable',
      provider: 'apple_music',
      reason: 'not_configured',
    });
    expect(state.consumed).toEqual([]);
    expect(state.appleCalls).toEqual([]);
  });

  it('answers provider_unavailable when the token cannot be minted', async () => {
    const state = fake(undefined, {
      tokens: {
        get: async () => {
          throw new Error('bad key');
        },
        clear: () => {},
      },
    });
    const { body } = await call(state, post({ query: 'paper' }));
    expect(body).toMatchObject({ code: 'provider_unavailable', reason: 'not_configured' });
  });

  it('maps Apple 429 to rate_limited with Retry-After', async () => {
    const state = fake(
      async () => new Response('{}', { status: 429, headers: { 'retry-after': '7' } }),
    );
    const { response, body } = await call(state, post({ query: 'paper' }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('7');
    expect(body).toEqual({ code: 'rate_limited', retry_after_seconds: 7 });
    expect(state.saved).toEqual([]);
  });

  it.each([401, 403])('forgets a token Apple rejects with %i', async (status) => {
    const state = fake(async () => new Response(unauthorized, { status }));
    const { response, body } = await call(state, post({ query: 'paper' }));
    expect(response.status).toBe(502);
    expect(body).toEqual({
      code: 'provider_unavailable',
      provider: 'apple_music',
      reason: 'unauthorized',
    });
    expect(state.cleared).toBe(1);
  });

  it('maps an unknown storefront (404) and a malformed request (400) to invalid_input', async () => {
    const notFound = await call(
      fake(async () => new Response('{}', { status: 404 })),
      post({ query: 'paper', storefront: 'zz' }),
    );
    expect(notFound.response.status).toBe(400);
    expect(notFound.body).toEqual({ code: 'invalid_input', field: 'storefront' });

    const bad = await call(
      fake(async () => new Response('{}', { status: 400 })),
      post({ query: 'paper' }),
    );
    expect(bad.body).toEqual({ code: 'invalid_input', field: 'query' });
  });

  it.each<[string, () => Promise<Response>, string]>([
    ['a 500', async () => new Response('oops', { status: 500 }), 'upstream_error'],
    ['a 503', async () => new Response('', { status: 503 }), 'upstream_error'],
    [
      'a body that is not JSON',
      async () => new Response('<html>', { status: 200 }),
      'bad_response',
    ],
    [
      'an error body with 200',
      async () => new Response(unauthorized, { status: 200 }),
      'bad_response',
    ],
    [
      'a network failure',
      async () => {
        throw new TypeError('fetch failed');
      },
      'network',
    ],
  ])('maps %s to provider_unavailable', async (_name, apple, reason) => {
    const state = fake(apple);
    const { response, body } = await call(state, post({ query: 'paper' }));
    expect(response.status).toBe(502);
    expect(body).toEqual({ code: 'provider_unavailable', provider: 'apple_music', reason });
    expect(state.saved).toEqual([]);
  });

  it('gives up on Apple after the timeout', async () => {
    const state = fake(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      { timeoutMs: 10 },
    );
    const { response, body } = await call(state, post({ query: 'paper' }));
    expect(response.status).toBe(502);
    expect(body).toMatchObject({ code: 'provider_unavailable', reason: 'timeout' });
  });

  it('answers 500 without a code or any request detail when the database fails', async () => {
    const state = fake(undefined, {
      saveTracks: async () => {
        throw new Error('connection refused');
      },
    });
    const { response, body } = await call(state, post({ query: 'paper lanterns' }));
    expect(response.status).toBe(500);
    expect(body).toEqual({});
  });

  it('does not log anything', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => {}),
    );
    await call(fake(), post({ query: 'paper' }));
    await call(
      fake(async () => new Response('', { status: 500 })),
      post({ query: 'paper' }),
    );
    spies.forEach((spy) => {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});

describe('helpers', () => {
  it('reads the user id from a JWT', () => {
    expect(userIdFrom(`Bearer ${userJwt}`)).toBe(USER);
    expect(userIdFrom(`Bearer ${jwt({ sub: '' })}`)).toBeNull();
    expect(userIdFrom(`Bearer ${jwt({ sub: 42 })}`)).toBeNull();
    expect(userIdFrom(null)).toBeNull();
  });

  it('reads Retry-After as seconds or a date, kept to 1…3600', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    expect(retryAfterSeconds('15', now)).toBe(15);
    expect(retryAfterSeconds('0', now)).toBe(1);
    expect(retryAfterSeconds('999999', now)).toBe(3600);
    expect(retryAfterSeconds('Wed, 25 Nov 2026 12:00:20 GMT', now)).toBe(20);
    expect(retryAfterSeconds(null, now)).toBe(30);
    expect(retryAfterSeconds('soon', now)).toBe(30);
  });
});

describe('catalog store (PostgREST)', () => {
  const track: CatalogTrack = {
    provider: 'apple_music',
    providerTrackId: '9000000001',
    title: 'Paper Lanterns',
    artists: ['The Fixture Band'],
    album: null,
    durationMs: 214000,
    isrc: null,
    explicit: false,
    artworkUrl: null,
    artworkBackgroundColor: null,
    versionTags: ['live'],
  };

  function store(respond: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const s = createCatalogStore({
      url: 'https://project.example.test/',
      serviceRoleKey: 'service-role-secret',
      fetch: async (url, init) => {
        calls.push({ url, init });
        return respond(url, init);
      },
    });
    return { s, calls };
  }

  it('saves tracks as snake_case through the service role', async () => {
    const { s, calls } = store(
      () =>
        new Response(
          JSON.stringify([{ provider_track_id: '9000000001', recording_id: recordingId('1') }]),
          { status: 200 },
        ),
    );
    const ids = await s.saveTracks([track]);
    expect(ids.get('9000000001')).toBe(recordingId('1'));
    expect(calls[0].url).toBe('https://project.example.test/rest/v1/rpc/save_catalog_tracks');
    expect(calls[0].init.headers).toMatchObject({
      apikey: 'service-role-secret',
      authorization: 'Bearer service-role-secret',
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      tracks: [
        {
          provider_track_id: '9000000001',
          title: 'Paper Lanterns',
          artists: ['The Fixture Band'],
          album: null,
          duration_ms: 214000,
          isrc: null,
          explicit: false,
          artwork_url: null,
          artwork_background_color: null,
          version_tags: ['live'],
        },
      ],
    });
  });

  it('counts a search for the user', async () => {
    const { s, calls } = store(() => new Response(null, { status: 204 }));
    await s.consumeSearch(USER);
    expect(calls[0].url).toBe('https://project.example.test/rest/v1/rpc/consume_catalog_search');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ user_id: USER });
  });

  it('turns the database rate_limited error into a ServiceError', async () => {
    const { s } = store(
      () =>
        new Response(
          JSON.stringify({
            code: 'P0001',
            message: 'rate_limited',
            details: '{"retry_after_seconds": 9}',
            hint: 'qd',
          }),
          { status: 400 },
        ),
    );
    await expect(s.consumeSearch(USER)).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
      details: { retry_after_seconds: 9 },
    });
  });

  it('falls back to 60 s when the limit error has no usable retry time', async () => {
    const { s } = store(
      () =>
        new Response(JSON.stringify({ message: 'rate_limited', details: 'nope', hint: 'qd' }), {
          status: 400,
        }),
    );
    await expect(s.consumeSearch(USER)).rejects.toMatchObject({
      details: { retry_after_seconds: 60 },
    });
  });

  it.each([
    ['another q’d error', { message: 'invalid_input', hint: 'qd' }],
    ['a rate_limited message without the qd hint', { message: 'rate_limited' }],
    ['no body', null],
  ])('treats %s as a server fault', async (_name, body) => {
    const { s } = store(() => new Response(body ? JSON.stringify(body) : '', { status: 500 }));
    const error = await s.saveTracks([track]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ServiceError);
    expect(String(error)).not.toContain('service-role-secret');
  });

  it('rejects a save answer that is not a list, and skips malformed rows', async () => {
    await expect(
      store(() => new Response('{}', { status: 200 })).s.saveTracks([track]),
    ).rejects.toThrow('no list');
    const ids = await store(
      () =>
        new Response(JSON.stringify([null, { provider_track_id: 1 }, { recording_id: 'x' }]), {
          status: 200,
        }),
    ).s.saveTracks([track]);
    expect(ids.size).toBe(0);
  });
});

describe('handlerFromEnv', () => {
  it('answers provider_unavailable when the Apple secrets are not set', async () => {
    const fetcher = jest.fn(async () => new Response('[]', { status: 200 }));
    const handler = handlerFromEnv(
      (name) =>
        ({ SUPABASE_URL: 'https://project.example.test', SUPABASE_SERVICE_ROLE_KEY: 'k' })[name],
      fetcher,
    );
    const response = await handler(post({ query: 'paper' }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ reason: 'not_configured' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('wires the token, Apple and the database together', async () => {
    const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const env: Record<string, string> = {
      APPLE_MUSIC_TEAM_ID: 'TEAMSYNTH1',
      APPLE_MUSIC_KEY_ID: 'KEYSYNTH01',
      APPLE_MUSIC_PRIVATE_KEY: pem,
      SUPABASE_URL: 'https://project.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    };
    const urls: string[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.endsWith('/consume_catalog_search')) return new Response(null, { status: 204 });
      if (url.endsWith('/save_catalog_tracks')) {
        const { tracks } = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify(
            tracks.map((t: { provider_track_id: string }) => ({
              provider_track_id: t.provider_track_id,
              recording_id: recordingId(t.provider_track_id),
            })),
          ),
          { status: 200 },
        );
      }
      expect((init.headers as Record<string, string>).authorization).toMatch(
        /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,
      );
      return new Response(songs, { status: 200 });
    };
    const response = await handlerFromEnv((name) => env[name], fetcher)(post({ query: 'paper' }));
    expect(response.status).toBe(200);
    expect((await response.json()).results).toHaveLength(5);
    expect(urls.map((url) => url.replace(/\?.*$/, ''))).toEqual([
      'https://project.example.test/rest/v1/rpc/consume_catalog_search',
      'https://api.music.apple.com/v1/catalog/us/search',
      'https://project.example.test/rest/v1/rpc/save_catalog_tracks',
    ]);
  });
});
