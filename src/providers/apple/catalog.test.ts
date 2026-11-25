import { providerTrackSchema } from '@/domain/recording';
import { EdgeFunctionNetworkError, type EdgeFunctionResponse } from '@/services/edgeFunctions';

import { isProviderError } from '../errors';
import { createAppleMusicCatalog } from './catalog';

/**
 * The live Apple catalog adapter against a fake catalog-search function. The
 * function itself is tested in supabase/tests/functions.
 */

const track = (id: string) => ({
  provider: 'apple_music' as const,
  providerTrackId: id,
  title: `Song ${id}`,
  artists: ['The Fixture Band'],
  album: null,
  durationMs: 200000,
  isrc: null,
  explicit: false,
  artworkUrl: 'https://artwork.example.test/{w}x{h}bb.jpg',
  artworkBackgroundColor: '#1A2B3C',
});
const recordingId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const okBody = {
  storefront: 'us',
  results: [
    { recordingId: recordingId(1), track: track('1'), availableOn: ['apple_music'] },
    { recordingId: recordingId(2), track: track('2'), availableOn: ['apple_music'] },
  ],
};

function adapter(answer: EdgeFunctionResponse | (() => Promise<EdgeFunctionResponse>)) {
  const calls: { name: string; body: unknown }[] = [];
  const catalog = createAppleMusicCatalog({
    invoke: async (name, body) => {
      calls.push({ name, body });
      return typeof answer === 'function' ? answer() : answer;
    },
  });
  return { catalog, calls };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('Apple Music catalog (live, through catalog-search)', () => {
  it('is the Apple Music catalog', () => {
    expect(adapter({ status: 200, body: okBody }).catalog.provider).toBe('apple_music');
  });

  it('asks the function with the trimmed query, the page size and the storefront', async () => {
    const { catalog, calls } = adapter({ status: 200, body: okBody });
    await catalog.search('  paper   lanterns ', 'US');
    expect(calls).toEqual([
      { name: 'catalog-search', body: { query: 'paper lanterns', limit: 25, storefront: 'us' } },
    ]);
  });

  it('returns valid tracks with their recording ids, in order', async () => {
    const results = await adapter({ status: 200, body: okBody }).catalog.search('paper', 'US');
    expect(results.map((r) => r.recordingId)).toEqual([recordingId(1), recordingId(2)]);
    for (const { track: t, availableOn } of results) {
      expect(providerTrackSchema.parse(t)).toEqual(t);
      expect(availableOn).toEqual(['apple_music']);
    }
  });

  it('does not call the server for a blank query', async () => {
    const { catalog, calls } = adapter({ status: 200, body: okBody });
    expect(await catalog.search('  \n ', 'US')).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('sends at most 100 characters', async () => {
    const { catalog, calls } = adapter({ status: 200, body: okBody });
    await catalog.search(`${'a'.repeat(99)} ${'b'.repeat(50)}`, 'US');
    expect((calls[0].body as { query: string }).query).toBe('a'.repeat(99));
  });

  it.each<[string, EdgeFunctionResponse, string, number | undefined]>([
    [
      'rate_limited',
      { status: 429, body: { code: 'rate_limited', retry_after_seconds: 12 } },
      'rate_limited',
      12,
    ],
    [
      'rate_limited without a time',
      { status: 429, body: { code: 'rate_limited' } },
      'rate_limited',
      30,
    ],
    [
      'a 429 from the gateway without q’d’s body',
      { status: 429, body: { code: 429, message: 'Too many requests' } },
      'rate_limited',
      30,
    ],
    ['a 429 that is not JSON', { status: 429, body: null }, 'rate_limited', 30],
    [
      'rate_limited with an unusable time',
      { status: 429, body: { code: 'rate_limited', retry_after_seconds: 0 } },
      'rate_limited',
      30,
    ],
    [
      'invalid_input',
      { status: 400, body: { code: 'invalid_input', field: 'query' } },
      'invalid_argument',
      undefined,
    ],
    [
      'provider_unavailable',
      { status: 502, body: { code: 'provider_unavailable', reason: 'timeout' } },
      'provider_unavailable',
      undefined,
    ],
    [
      'not_authenticated',
      { status: 401, body: { code: 'not_authenticated' } },
      'provider_unavailable',
      undefined,
    ],
    ['a 500 without a code', { status: 500, body: {} }, 'provider_unavailable', undefined],
    ['a body that is not JSON', { status: 502, body: null }, 'provider_unavailable', undefined],
    [
      'a 200 that does not parse',
      { status: 200, body: { results: 'nope' } },
      'provider_unavailable',
      undefined,
    ],
    [
      'a 200 with a bad result',
      {
        status: 200,
        body: {
          storefront: 'us',
          results: [{ recordingId: 'x', track: track('1'), availableOn: [] }],
        },
      },
      'provider_unavailable',
      undefined,
    ],
  ])('maps %s to a ProviderError', async (_name, answer, code, retryAfterSeconds) => {
    const error = await rejection(adapter(answer).catalog.search('paper', 'US'));
    expect(isProviderError(error)).toBe(true);
    expect(error).toMatchObject({ code, provider: 'apple_music', retryAfterSeconds });
  });

  it.each(['network', 'timeout', 'not_authenticated'] as const)(
    'maps a %s failure to provider_unavailable',
    async (reason) => {
      const error = await rejection(
        adapter(async () => {
          throw new EdgeFunctionNetworkError(reason);
        }).catalog.search('paper', 'US'),
      );
      expect(error).toMatchObject({ code: 'provider_unavailable' });
    },
  );

  it('lets an unexpected programming error through', async () => {
    const error = await rejection(
      adapter(async () => {
        throw new RangeError('bug');
      }).catalog.search('paper', 'US'),
    );
    expect(error).toBeInstanceOf(RangeError);
  });

  it('says track and link lookups are not in this build yet', async () => {
    const { catalog } = adapter({ status: 200, body: okBody });
    await expect(catalog.getTrack('1')).rejects.toMatchObject({ code: 'not_in_this_build' });
    await expect(catalog.resolveLink('https://music.apple.com/us/song/x/1')).rejects.toMatchObject({
      code: 'not_in_this_build',
    });
  });

  it('logs nothing, so queries never reach a log', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => {}),
    );
    await adapter({ status: 200, body: okBody }).catalog.search('paper', 'US');
    await rejection(adapter({ status: 500, body: {} }).catalog.search('paper', 'US'));
    spies.forEach((spy) => {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
