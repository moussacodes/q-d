import { z } from 'zod';

import { musicProviderSchema } from './music-provider';
import { idSchema } from './primitives';
import { providerTrackSchema } from './recording';

/**
 * Canonical catalog search (docs/API_CONTRACTS.md § Catalog): what the
 * `catalog-search` Edge Function answers. The app parses every answer with
 * these schemas before using it.
 */

/** Longest query the search accepts, after trimming. */
export const CATALOG_QUERY_MAX_LENGTH = 100;
/** Most results one search returns (Apple's page size). */
export const CATALOG_SEARCH_MAX_LIMIT = 25;

export const catalogSearchResultSchema = z.object({
  /** The canonical recording the server saved for this song; `enqueue_recording` takes it. */
  recordingId: idSchema,
  track: providerTrackSchema,
  /** Services the song is known to be on. Search only knows the canonical (Apple) one. */
  availableOn: z.array(musicProviderSchema).min(1),
});
export type CatalogSearchResult = z.infer<typeof catalogSearchResultSchema>;

export const catalogSearchResponseSchema = z.object({
  /** Apple storefront searched, lowercase (`us`). */
  storefront: z.string().regex(/^[a-z]{2}$/),
  results: z.array(catalogSearchResultSchema).max(CATALOG_SEARCH_MAX_LIMIT),
});
export type CatalogSearchResponse = z.infer<typeof catalogSearchResponseSchema>;

/** An Edge Function error answer: `{ code, …details }`. */
export const edgeFunctionErrorSchema = z.object({
  code: z.string().min(1),
  field: z.string().optional(),
  retry_after_seconds: z.number().int().positive().optional(),
  reason: z.string().optional(),
});
export type EdgeFunctionError = z.infer<typeof edgeFunctionErrorSchema>;

/** The query as the server will read it: trimmed, inner whitespace collapsed. */
export function normalizeCatalogQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}
