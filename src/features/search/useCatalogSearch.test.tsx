import { act, renderHook, waitFor } from '@testing-library/react-native';

import { mockCatalog } from '@/providers/mock/catalog';
import { ProviderError } from '@/providers/errors';
import type { CatalogAdapter, CatalogResult } from '@/providers/types';

import { searchErrorMessage, useCatalogSearch } from './useCatalogSearch';

/** A catalog whose searches the test resolves by hand. */
function controlledCatalog() {
  const pending: {
    query: string;
    resolve: (results: CatalogResult[]) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const catalog: CatalogAdapter = {
    provider: 'apple_music',
    search: (query) =>
      new Promise((resolve, reject) => {
        pending.push({ query, resolve, reject });
      }),
    resolveLink: () => Promise.reject(new Error('unused')),
    getTrack: () => Promise.reject(new Error('unused')),
  };
  return { catalog, pending };
}

const result = (id: string): CatalogResult => ({
  track: {
    provider: 'apple_music',
    providerTrackId: id,
    title: `Song ${id}`,
    artists: ['A'],
    album: null,
    durationMs: 1000,
    isrc: null,
    explicit: false,
    artworkUrl: null,
    artworkBackgroundColor: null,
  },
  availableOn: ['apple_music'],
  recordingId: `00000000-0000-4000-8000-00000000000${id}`,
});

describe('useCatalogSearch', () => {
  it('searches the mock catalog in mock mode without waiting', async () => {
    const { result: hook } = await renderHook(() => useCatalogSearch('daniel caesar'));
    await waitFor(() => expect(hook.current.status).toBe('done'));
    expect(hook.current.results.map((r) => r.track.title)).toEqual(
      (await mockCatalog.search('daniel caesar', 'US')).map((r) => r.track.title),
    );
    expect(hook.current.error).toBeNull();
  });

  it('is idle for a blank query and never calls the catalog', async () => {
    const { catalog, pending } = controlledCatalog();
    const { result: hook } = await renderHook(() => useCatalogSearch('   ', { catalog }));
    expect(hook.current).toEqual({ results: [], status: 'idle', error: null });
    expect(pending).toEqual([]);
  });

  it('searches the trimmed query and reports loading, then done', async () => {
    const { catalog, pending } = controlledCatalog();
    const { result: hook } = await renderHook(() =>
      useCatalogSearch('  paper  lanterns ', { catalog }),
    );
    expect(hook.current.status).toBe('loading');
    expect(pending.map((p) => p.query)).toEqual(['paper lanterns']);
    await act(async () => pending[0].resolve([result('1')]));
    expect(hook.current).toEqual({ results: [result('1')], status: 'done', error: null });
  });

  it('drops results for a query that changed before they arrived', async () => {
    const { catalog, pending } = controlledCatalog();
    const { result: hook, rerender } = await renderHook(
      ({ query }: { query: string }) => useCatalogSearch(query, { catalog }),
      { initialProps: { query: 'first' } },
    );
    await rerender({ query: 'second' });
    await act(async () => pending[1].resolve([result('2')]));
    await act(async () => pending[0].resolve([result('1')]));
    expect(hook.current.results).toEqual([result('2')]);
  });

  it('keeps the old results while a new query loads', async () => {
    const { catalog, pending } = controlledCatalog();
    const { result: hook, rerender } = await renderHook(
      ({ query }: { query: string }) => useCatalogSearch(query, { catalog }),
      { initialProps: { query: 'first' } },
    );
    await act(async () => pending[0].resolve([result('1')]));
    await rerender({ query: 'second' });
    expect(hook.current).toEqual({ results: [result('1')], status: 'loading', error: null });
  });

  it('does not search again when only whitespace changes', async () => {
    const { catalog, pending } = controlledCatalog();
    const { rerender } = await renderHook(
      ({ query }: { query: string }) => useCatalogSearch(query, { catalog }),
      { initialProps: { query: 'paper' } },
    );
    await rerender({ query: 'paper ' });
    await rerender({ query: ' paper' });
    expect(pending).toHaveLength(1);
  });

  describe('with a debounce (the live catalog)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('searches once, after typing stops', async () => {
      const { catalog, pending } = controlledCatalog();
      const { rerender } = await renderHook(
        ({ query }: { query: string }) => useCatalogSearch(query, { catalog, debounceMs: 300 }),
        { initialProps: { query: 'p' } },
      );
      await act(async () => jest.advanceTimersByTime(200));
      await rerender({ query: 'pa' });
      await act(async () => jest.advanceTimersByTime(200));
      await rerender({ query: 'pap' });
      expect(pending).toEqual([]);
      await act(async () => jest.advanceTimersByTime(300));
      expect(pending.map((p) => p.query)).toEqual(['pap']);
    });

    it('never searches a query cleared before the wait ends', async () => {
      const { catalog, pending } = controlledCatalog();
      const { rerender, result: hook } = await renderHook(
        ({ query }: { query: string }) => useCatalogSearch(query, { catalog, debounceMs: 300 }),
        { initialProps: { query: 'paper' } },
      );
      await rerender({ query: '' });
      await act(async () => jest.advanceTimersByTime(1000));
      expect(pending).toEqual([]);
      expect(hook.current.status).toBe('idle');
    });
  });

  it.each([
    [
      new ProviderError('rate_limited', 'apple_music', 'x', 12),
      { code: 'rate_limited', retryAfterSeconds: 12 },
    ],
    [new ProviderError('provider_unavailable', 'apple_music'), { code: 'provider_unavailable' }],
    [new ProviderError('not_in_this_build', 'apple_music'), { code: 'not_in_this_build' }],
    [new Error('anything else'), { code: 'provider_unavailable' }],
  ])('reports a failed search as an error state (%p)', async (error, expected) => {
    const { catalog, pending } = controlledCatalog();
    const { result: hook } = await renderHook(() => useCatalogSearch('paper', { catalog }));
    await act(async () => pending[0].reject(error));
    expect(hook.current).toEqual({ results: [], status: 'error', error: expected });
  });

  it('clears an error when the next search works', async () => {
    const { catalog, pending } = controlledCatalog();
    const { result: hook, rerender } = await renderHook(
      ({ query }: { query: string }) => useCatalogSearch(query, { catalog }),
      { initialProps: { query: 'first' } },
    );
    await act(async () =>
      pending[0].reject(new ProviderError('provider_unavailable', 'apple_music')),
    );
    await rerender({ query: 'second' });
    expect(hook.current.error).toBeNull();
    await act(async () => pending[1].resolve([result('2')]));
    expect(hook.current).toEqual({ results: [result('2')], status: 'done', error: null });
  });
});

describe('searchErrorMessage', () => {
  it.each([
    [
      { code: 'rate_limited' as const, retryAfterSeconds: 12 },
      'Too many searches. Try again in 12 seconds.',
    ],
    [
      { code: 'rate_limited' as const, retryAfterSeconds: 1 },
      'Too many searches. Try again in 1 second.',
    ],
    [{ code: 'rate_limited' as const }, 'Too many searches. Try again in a moment.'],
    [{ code: 'invalid_argument' as const }, 'Try a shorter search.'],
    [{ code: 'not_in_this_build' as const }, 'Search isn’t available in this build of q’d yet.'],
    [
      { code: 'provider_unavailable' as const },
      'Search isn’t working right now. Try again in a moment.',
    ],
    [{ code: 'not_found' as const }, 'Search isn’t working right now. Try again in a moment.'],
  ])('says %p as plain copy', (error, copy) => {
    expect(searchErrorMessage(error)).toBe(copy);
  });
});
