import { useEffect, useState } from 'react';

import { catalog, type CatalogResult } from '@/providers';

export type SearchResult = CatalogResult;

/**
 * Canonical-catalog search (plan.md §2), so anyone can search without a
 * connected service. Results for an older query are dropped if the query
 * changes before they arrive.
 */
export function useCatalogSearch(query: string): SearchResult[] {
  const [found, setFound] = useState<SearchResult[]>([]);

  useEffect(() => {
    let current = true;
    catalog.search(query, 'US').then((results) => {
      if (current) setFound(results);
    });
    return () => {
      current = false;
    };
  }, [query]);

  return found;
}
