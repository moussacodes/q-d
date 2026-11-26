/**
 * Logs and analytics privacy check for the catalog-search Edge Function
 * (Forge card). Supabase keeps whatever a function prints in its logs, so
 * the handler must print nothing, and its error answers must never echo the
 * query, the caller's token or Apple's developer token. Every path runs with
 * canary values while the console is captured.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ServiceError } from '../../functions/catalog-search/errors';
import { createHandler, type CatalogSearchDeps } from '../../functions/catalog-search/handler';

const songs = readFileSync(join(__dirname, '..', 'fixtures', 'apple-search-songs.json'), 'utf8');

const CANARY = {
  query: 'velvet canary lullaby',
  userId: 'ca1a2b3c-0000-4000-8000-00000000ca17',
  developerToken: 'eyJhbGciOiJFUzI1NiJ9.Q2FuYXJ5RGV2ZWxvcGVy.Q2FuYXJ5U2ln',
  title: 'Paper Lanterns', // a title from the Apple fixture
  isrc: 'QZSYN2600001', // its ISRC
} as const;

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const userJwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: CANARY.userId, role: 'authenticated' })}.c2ln`;

let consoleOutput: unknown[][];

beforeEach(() => {
  consoleOutput = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    jest.spyOn(console, method).mockImplementation((...args) => void consoleOutput.push(args));
  }
});

afterEach(() => jest.restoreAllMocks());

function deps(overrides: Partial<CatalogSearchDeps> = {}): CatalogSearchDeps {
  return {
    fetch: async () => new Response(songs, { status: 200 }),
    tokens: { get: async () => CANARY.developerToken, clear: () => {} },
    consumeSearch: async () => {},
    saveTracks: async (tracks) =>
      new Map(
        tracks.map((t) => [
          t.providerTrackId,
          `00000000-0000-4000-8000-${t.providerTrackId.padStart(12, '0')}`,
        ]),
      ),
    ...overrides,
  };
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

const fail = (error: Error) => async () => {
  throw error;
};
const leakyError = () =>
  new Error(`failed for ${CANARY.query} with ${CANARY.developerToken} as ${CANARY.userId}`);

const cases: [string, Partial<CatalogSearchDeps>, Request][] = [
  ['a good search', {}, post({ query: CANARY.query })],
  ['no session', {}, post({ query: CANARY.query }, null)],
  ['a body that isn’t JSON', {}, post(`{"query": "${CANARY.query}"`)],
  ['a query that’s too long', {}, post({ query: `${CANARY.query} ${'x'.repeat(500)}` })],
  [
    'rate limited',
    { consumeSearch: fail(new ServiceError(429, 'rate_limited', { retry_after_seconds: 9 })) },
    post({ query: CANARY.query }),
  ],
  ['the database down', { consumeSearch: fail(leakyError()) }, post({ query: CANARY.query })],
  ['no developer token', { tokens: null }, post({ query: CANARY.query })],
  [
    'the token source failing',
    { tokens: { get: fail(leakyError()), clear: () => {} } },
    post({ query: CANARY.query }),
  ],
  ['Apple unreachable', { fetch: fail(leakyError()) }, post({ query: CANARY.query })],
  [
    'Apple refusing the token',
    { fetch: async () => new Response(`bad token ${CANARY.developerToken}`, { status: 401 }) },
    post({ query: CANARY.query }),
  ],
  [
    'Apple rate limiting',
    { fetch: async () => new Response('', { status: 429 }) },
    post({ query: CANARY.query }),
  ],
  [
    'Apple answering garbage',
    { fetch: async () => new Response(`<html>${CANARY.query}</html>`, { status: 200 }) },
    post({ query: CANARY.query }),
  ],
  ['saving the songs failing', { saveTracks: fail(leakyError()) }, post({ query: CANARY.query })],
];

describe('catalog-search never logs, and its errors echo nothing', () => {
  it.each(cases)('%s', async (_label, overrides, request) => {
    const response = await createHandler(deps(overrides))(request);
    const body = await response.text();

    expect(consoleOutput).toEqual([]);
    if (response.status !== 200) {
      for (const canary of Object.values(CANARY)) expect(body).not.toContain(canary);
      // Errors carry a stable code (or nothing, for a 500) and nothing else of the request.
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      expect(
        Object.keys(parsed).every((key) =>
          ['code', 'field', 'retry_after_seconds', 'provider', 'reason'].includes(key),
        ),
      ).toBe(true);
    } else {
      // A good answer is for the caller only; it never holds the tokens or the query.
      expect(body).not.toContain(CANARY.developerToken);
      expect(body).not.toContain(CANARY.query);
      expect(body).toContain(CANARY.title);
    }
  });
});
