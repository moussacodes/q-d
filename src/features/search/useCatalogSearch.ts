import { useEffect, useState } from 'react';

import { catalog, type CatalogResult } from '@/providers';

export type SearchResult = CatalogResult;

export type CatalogSearch = {
  results: SearchResult[];
  /** `loading` until the current query's answer arrives; `error` when search failed. */
  status: 'loading' | 'done' | 'error';
};

/**
 * Canonical-catalog search (plan.md §2), so anyone can search without a
 * connected service. Results for an older query are dropped if the query
 * changes before they arrive. While a query is out, the screen says so rather
 * than "no songs match", and a failed search says it failed.
 */
export function useCatalogSearch(query: string): CatalogSearch {
  const [answer, setAnswer] = useState<{ query: string; search: CatalogSearch } | null>(null);

  useEffect(() => {
    let current = true;
    catalog.search(query, 'US').then(
      (results) => {
        if (current) setAnswer({ query, search: { results, status: 'done' } });
      },
      () => {
        if (current) setAnswer({ query, search: { results: [], status: 'error' } });
      },
    );
    return () => {
      current = false;
    };
  }, [query]);

  if (answer?.query === query) return answer.search;
  // Keep showing the last results while the next query is out, so the list doesn't blink.
  return { results: answer?.search.results ?? [], status: 'loading' };
}
