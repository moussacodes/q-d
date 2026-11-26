import {
  CATALOG_QUERY_MAX_LENGTH,
  CATALOG_SEARCH_MAX_LIMIT,
  catalogSearchResponseSchema,
  edgeFunctionErrorSchema,
  normalizeCatalogQuery,
} from '@/domain/catalog';
import {
  EdgeFunctionNetworkError,
  type EdgeFunctionInvoker,
  type EdgeFunctionResponse,
} from '@/services/edgeFunctions';

import { ProviderError } from '../errors';
import type { CatalogAdapter, CatalogResult, ProviderEntity, ProviderTrack } from '../types';

/**
 * The Apple Music canonical catalog (PRODUCT_SPEC.md §6). Search runs in the
 * `catalog-search` Edge Function, which holds the Apple Music API developer
 * token and saves each result as a canonical recording, so anyone can search:
 * guests without a music service, Android and the web included
 * (ARCHITECTURE.md open decision 1, decided 2026-11-25).
 *
 * Built, not yet tested against the live Apple Music API (no developer key
 * yet). The app keeps using the mock catalog while data mode is `mock`.
 *
 * Looking up one track or a share link needs its own function; until then
 * `getTrack` and `resolveLink` say "not in this build".
 */

export const CATALOG_SEARCH_FUNCTION = 'catalog-search';

const fail = (code: ConstructorParameters<typeof ProviderError>[0], retryAfterSeconds?: number) =>
  new ProviderError(code, 'apple_music', `Apple catalog search: ${code}`, retryAfterSeconds);

/** Maps an error answer to the adapter's error codes. */
function errorFor(response: EdgeFunctionResponse): ProviderError {
  const parsed = edgeFunctionErrorSchema.safeParse(response.body);
  // A 429 without q’d's body (for example from Supabase's own gateway) is
  // still "too many searches", not "search is broken".
  const code = parsed.success ? parsed.data.code : response.status === 429 ? 'rate_limited' : null;
  switch (code) {
    case 'rate_limited':
      return fail('rate_limited', parsed.data?.retry_after_seconds ?? 30);
    case 'invalid_input':
      return fail('invalid_argument');
    default:
      // provider_unavailable, not_authenticated (search needs a session), a
      // 500 without a code, or anything unexpected.
      return fail('provider_unavailable');
  }
}

export type AppleCatalogOptions = {
  invoke: EdgeFunctionInvoker;
  /** Results per search, 1–25. Default 25. */
  limit?: number;
};

export function createAppleMusicCatalog({
  invoke,
  limit = CATALOG_SEARCH_MAX_LIMIT,
}: AppleCatalogOptions): CatalogAdapter {
  return {
    provider: 'apple_music',

    async search(query, market): Promise<CatalogResult[]> {
      const term = normalizeCatalogQuery(query);
      if (term.length === 0) return [];
      // A longer query can't find anything a person typed; ask with its start.
      const capped = term.slice(0, CATALOG_QUERY_MAX_LENGTH).trim();

      let response: EdgeFunctionResponse;
      try {
        response = await invoke(CATALOG_SEARCH_FUNCTION, {
          query: capped,
          limit,
          storefront: market.toLowerCase(),
        });
      } catch (error) {
        if (error instanceof EdgeFunctionNetworkError) throw fail('provider_unavailable');
        throw error;
      }
      if (response.status !== 200) throw errorFor(response);

      const parsed = catalogSearchResponseSchema.safeParse(response.body);
      // An answer that doesn't parse is treated like no answer (API_CONTRACTS.md §1).
      if (!parsed.success) throw fail('provider_unavailable');
      return parsed.data.results.map(({ recordingId, track, availableOn }) => ({
        recordingId,
        track,
        availableOn,
        // Search knows only the canonical catalog; other services aren't matched yet.
        checkedOn: ['apple_music'],
      }));
    },

    resolveLink(): Promise<ProviderEntity> {
      return Promise.reject(fail('not_in_this_build'));
    },

    getTrack(): Promise<ProviderTrack> {
      return Promise.reject(fail('not_in_this_build'));
    },
  };
}
