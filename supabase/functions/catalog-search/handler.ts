/**
 * catalog-search: canonical catalog search for everyone, with or without a
 * music service (PRODUCT_SPEC.md §6, ARCHITECTURE.md open decision 1).
 *
 * POST { query, limit?, storefront? } with the caller's Supabase JWT.
 *   1. Check the request and the caller's per-minute search limit.
 *   2. Search Apple's catalog with the developer token this function holds.
 *   3. Save each song as a canonical recording plus its Apple provider track.
 *   4. Answer { storefront, results: [{ recordingId, track, availableOn }] }.
 *
 * `createHandler` takes everything with a side effect (Apple's fetch, the
 * token, the database) as arguments, so Jest runs it without Deno, Apple or
 * Postgres. `index.ts` wires the real ones.
 *
 * Nothing here logs: a query is listening intent and the token is a secret.
 */
import {
  type CatalogTrack,
  DEFAULT_LIMIT,
  DEFAULT_STOREFRONT,
  isSearchResponse,
  MAX_LIMIT,
  MAX_QUERY_LENGTH,
  normalizeSearchResponse,
  searchUrl,
} from './apple.ts';
import { CORS_HEADERS, errorResponse, isServiceError, json, ServiceError } from './errors.ts';

export type CatalogSearchDeps = {
  /** Calls Apple. Tests pass a fake that returns recorded fixtures. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * The Apple Music developer token source, or `null` when the function's
   * secrets aren't set. Search then answers `provider_unavailable`.
   */
  tokens: { get(): Promise<string>; clear(): void } | null;
  /** Counts one search for the caller; rejects with `rate_limited` over the limit. */
  consumeSearch(userId: string): Promise<void>;
  /** Saves the tracks; returns each Apple id's canonical recording id. */
  saveTracks(tracks: CatalogTrack[]): Promise<Map<string, string>>;
  /** How long to wait for Apple. Default 8 s. */
  timeoutMs?: number;
};

export type SearchRequest = { query: string; limit: number; storefront: string };

/** What the app gets back (camelCase, the domain's `ProviderTrack` shape). */
export type SearchResponse = {
  storefront: string;
  results: {
    recordingId: string;
    track: Omit<CatalogTrack, 'versionTags'>;
    availableOn: ['apple_music'];
  }[];
};

const invalid = (field: string) => new ServiceError(400, 'invalid_input', { field });

/** Validates the body. Throws `invalid_input` with the offending field. */
export function parseSearchRequest(body: unknown): SearchRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('body');
  const { query, limit, storefront } = body as Record<string, unknown>;

  if (typeof query !== 'string') throw invalid('query');
  const trimmed = query.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 1 || trimmed.length > MAX_QUERY_LENGTH) throw invalid('query');

  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit))) {
    throw invalid('limit');
  }
  const pageSize = limit ?? DEFAULT_LIMIT;
  if (pageSize < 1 || pageSize > MAX_LIMIT) throw invalid('limit');

  if (
    storefront !== undefined &&
    (typeof storefront !== 'string' || !/^[a-z]{2}$/i.test(storefront))
  ) {
    throw invalid('storefront');
  }
  return {
    query: trimmed,
    limit: pageSize,
    storefront: storefront ? storefront.toLowerCase() : DEFAULT_STOREFRONT,
  };
}

/**
 * The caller's user id from their JWT. Supabase checks the signature before
 * the function runs (`verify_jwt` in config.toml), so this only reads `sub`.
 * The anon key is a JWT too, but without a `sub`: it isn't a signed-in user.
 */
export function userIdFrom(authorization: string | null): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/.exec(
    authorization ?? '',
  );
  if (!match) return null;
  try {
    const padded = match[2].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)));
    const sub = payload?.sub;
    return typeof sub === 'string' && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

/** Seconds from a Retry-After header (seconds or an HTTP date), kept to 1…3600. */
export function retryAfterSeconds(header: string | null, nowMs: number): number {
  let seconds = 30;
  if (header && /^\d+$/.test(header.trim())) {
    seconds = Number(header.trim());
  } else if (header && !Number.isNaN(Date.parse(header))) {
    seconds = Math.ceil((Date.parse(header) - nowMs) / 1000);
  }
  return Math.min(3600, Math.max(1, seconds));
}

const unavailable = (reason: string) =>
  new ServiceError(502, 'provider_unavailable', { provider: 'apple_music', reason });

async function searchApple(
  deps: CatalogSearchDeps,
  request: SearchRequest,
  token: string,
): Promise<CatalogTrack[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8000);
  let response: Response;
  try {
    response = await deps.fetch(searchUrl(request.storefront, request.query, request.limit), {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    throw unavailable(controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    throw new ServiceError(429, 'rate_limited', {
      retry_after_seconds: retryAfterSeconds(response.headers.get('retry-after'), Date.now()),
    });
  }
  if (response.status === 401 || response.status === 403) {
    // A rejected token is mint-again, not retry-the-same.
    deps.tokens?.clear();
    throw unavailable('unauthorized');
  }
  // Apple answers an unknown storefront with 404, and a malformed request with 400.
  if (response.status === 404) throw invalid('storefront');
  if (response.status === 400) throw invalid('query');
  if (!response.ok) throw unavailable('upstream_error');

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw unavailable('bad_response');
  }
  if (!isSearchResponse(body)) throw unavailable('bad_response');
  return normalizeSearchResponse(body).tracks;
}

export function createHandler(deps: CatalogSearchDeps) {
  return async function handler(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    try {
      if (request.method !== 'POST')
        throw new ServiceError(405, 'invalid_input', { field: 'method' });

      const userId = userIdFrom(request.headers.get('authorization'));
      if (!userId) throw new ServiceError(401, 'not_authenticated');

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw invalid('body');
      }
      const search = parseSearchRequest(body);

      if (!deps.tokens) throw unavailable('not_configured');
      await deps.consumeSearch(userId);

      let token: string;
      try {
        token = await deps.tokens.get();
      } catch {
        throw unavailable('not_configured');
      }

      const tracks = await searchApple(deps, search, token);
      const recordingIds = tracks.length > 0 ? await deps.saveTracks(tracks) : new Map();

      const results: SearchResponse['results'] = [];
      for (const { versionTags: _tags, ...track } of tracks) {
        const recordingId = recordingIds.get(track.providerTrackId);
        if (recordingId) results.push({ recordingId, track, availableOn: ['apple_music'] });
      }
      const answer: SearchResponse = { storefront: search.storefront, results };
      return json(200, answer);
    } catch (error) {
      if (isServiceError(error)) return errorResponse(error);
      // Unexpected (for example the database is down): no code, so the app
      // shows its generic copy. Nothing about the request is echoed back.
      return json(500, {});
    }
  };
}
