import { useEffect, useState } from 'react';

import { normalizeCatalogQuery } from '@/domain/catalog';
import {
  catalog as appCatalog,
  isProviderError,
  type CatalogAdapter,
  type CatalogResult,
  type ProviderErrorCode,
} from '@/providers';
import { isMockMode } from '@/services/dataMode';

import { liveCatalog } from './liveCatalog';

/**
 * The catalog search uses: the labeled mock in mock mode, and in live mode
 * the canonical (Apple) catalog through the `catalog-search` Edge Function.
 */
const defaultCatalog = (): CatalogAdapter => (isMockMode ? appCatalog : liveCatalog());

export type SearchResult = CatalogResult;

export type SearchError = {
  code: ProviderErrorCode;
  /** With `rate_limited`: when another search can work. */
  retryAfterSeconds?: number;
};

export type CatalogSearchState = {
  /** The latest results. Kept while a newer query loads, so the list doesn't flash. */
  results: SearchResult[];
  status: 'idle' | 'loading' | 'done' | 'error';
  error: SearchError | null;
};

export type CatalogSearchOptions = {
  /** Defaults to the app's catalog: the labeled mock in mock mode, canonical search when live. */
  catalog?: CatalogAdapter;
  /**
   * Wait this long after the last keystroke before searching. The live
   * catalog searches through the server, which limits searches per minute,
   * so it waits 300 ms; the mock answers locally and doesn't wait.
   */
  debounceMs?: number;
};

const idle: CatalogSearchState = { results: [], status: 'idle', error: null };

/**
 * Canonical-catalog search (PRODUCT_SPEC.md §6), so anyone can search without
 * a connected service. Results for an older query are dropped if the query
 * changes before they arrive.
 */
export function useCatalogSearch(
  query: string,
  { catalog = defaultCatalog(), debounceMs = isMockMode ? 0 : 300 }: CatalogSearchOptions = {},
): CatalogSearchState {
  /** The last search that finished, and the query it was for. */
  const [settled, setSettled] = useState<CatalogSearchState & { term: string }>({
    ...idle,
    term: '',
  });
  const term = normalizeCatalogQuery(query);

  useEffect(() => {
    if (term === '') return;
    let current = true;

    const run = () => {
      catalog.search(term, 'US').then(
        (results) => {
          if (current) setSettled({ term, results, status: 'done', error: null });
        },
        (error: unknown) => {
          if (!current) return;
          setSettled({
            term,
            results: [],
            status: 'error',
            error: isProviderError(error)
              ? {
                  code: error.code,
                  ...(error.retryAfterSeconds !== undefined
                    ? { retryAfterSeconds: error.retryAfterSeconds }
                    : {}),
                }
              : { code: 'provider_unavailable' },
          });
        },
      );
    };

    if (debounceMs <= 0) {
      run();
      return () => {
        current = false;
      };
    }
    const timer = setTimeout(run, debounceMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term, catalog, debounceMs]);

  if (term === '') return idle;
  if (settled.term !== term) {
    // A newer query is on its way: keep the last results so the list doesn't flash.
    return { results: settled.results, status: 'loading', error: null };
  }
  const { term: _term, ...state } = settled;
  return state;
}

/** What Add a song says when a search fails. Never shows a raw error. */
export function searchErrorMessage(error: SearchError): string {
  switch (error.code) {
    case 'rate_limited': {
      const seconds = error.retryAfterSeconds;
      return seconds
        ? `Too many searches. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
        : 'Too many searches. Try again in a moment.';
    }
    case 'invalid_argument':
      return 'Try a shorter search.';
    case 'not_in_this_build':
      return 'Search isn’t available in this build of q’d yet.';
    default:
      return 'Search isn’t working right now. Try again in a moment.';
  }
}
