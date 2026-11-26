import { isProviderError } from '@/providers';

import { liveCatalog, resetLiveCatalog } from './liveCatalog';

let mockSession: { access_token: string } | null = null;

jest.mock('@/services/env', () => ({
  ...jest.requireActual('@/services/env'),
  env: {
    ...jest.requireActual('@/services/env').env,
    supabase: { url: 'https://example-project.supabase.co/', publishableKey: 'sb_publishable_x' },
  },
}));

jest.mock('@/services/supabase', () => ({
  ...jest.requireActual('@/services/supabase'),
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: mockSession }, error: null }) },
  }),
}));

const recordingId = 'c0000000-0000-4000-8000-00000000000a';

const answer = {
  storefront: 'us',
  results: [
    {
      recordingId,
      track: {
        provider: 'apple_music',
        providerTrackId: '1440857781',
        title: 'Glass Harbor',
        artists: ['The Paper Lanterns'],
        album: 'Low Tide',
        durationMs: 201_000,
        isrc: null,
        explicit: false,
        artworkUrl: null,
        artworkBackgroundColor: null,
      },
      availableOn: ['apple_music'],
    },
  ],
};

const fetchMock = jest.fn();

beforeEach(() => {
  resetLiveCatalog();
  mockSession = { access_token: 'session-token-value' };
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ status: 200, json: async () => answer });
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('liveCatalog', () => {
  it('searches through the catalog-search Edge Function with the user’s session', async () => {
    const results = await liveCatalog().search('glass harbor', 'US');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example-project.supabase.co/functions/v1/catalog-search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'sb_publishable_x',
          authorization: 'Bearer session-token-value',
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ query: 'glass harbor', storefront: 'us' });
    expect(results).toEqual([
      {
        recordingId,
        track: answer.results[0].track,
        availableOn: ['apple_music'],
        checkedOn: ['apple_music'],
      },
    ]);
  });

  it('is built once per app run', () => {
    expect(liveCatalog()).toBe(liveCatalog());
  });

  it('fails as "unavailable" when signed out, without calling the function', async () => {
    mockSession = null;
    const error = await liveCatalog()
      .search('glass harbor', 'US')
      .catch((e: unknown) => e);
    expect(isProviderError(error) && error.code).toBe('provider_unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads a rate limit with its wait', async () => {
    fetchMock.mockResolvedValue({
      status: 429,
      json: async () => ({ code: 'rate_limited', retry_after_seconds: 12 }),
    });
    const error = await liveCatalog()
      .search('glass harbor', 'US')
      .catch((e: unknown) => e);
    expect(isProviderError(error) && [error.code, error.retryAfterSeconds]).toEqual([
      'rate_limited',
      12,
    ]);
  });

  it('never trusts an answer that doesn’t parse', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ results: 'nope' }) });
    const error = await liveCatalog()
      .search('glass harbor', 'US')
      .catch((e: unknown) => e);
    expect(isProviderError(error) && error.code).toBe('provider_unavailable');
  });
});
