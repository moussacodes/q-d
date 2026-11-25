/**
 * The database side of catalog-search, through PostgREST with the service
 * role (the only role allowed to run these functions; see
 * supabase/migrations/20261125003000_catalog_search.sql). Plain `fetch`, so
 * there's no client library to bundle and tests pass a fake.
 */
import type { CatalogTrack } from './apple.ts';
import { ServiceError } from './errors.ts';

export type CatalogStoreConfig = {
  /** SUPABASE_URL, which Supabase sets for every Edge Function. */
  url: string;
  /** SUPABASE_SERVICE_ROLE_KEY. Never leaves the function. */
  serviceRoleKey: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
};

/** A PostgREST error body for a q’d error (API_CONTRACTS.md §1). */
type PostgrestError = { message?: unknown; details?: unknown; hint?: unknown };

function parseDetails(details: unknown): Record<string, unknown> {
  if (typeof details !== 'string') return {};
  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function createCatalogStore(config: CatalogStoreConfig) {
  const rpc = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const response = await config.fetch(`${config.url.replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) return body;

    const error = (body ?? {}) as PostgrestError;
    if (error.hint === 'qd' && error.message === 'rate_limited') {
      const details = parseDetails(error.details);
      const retry = Number(details.retry_after_seconds);
      throw new ServiceError(429, 'rate_limited', {
        retry_after_seconds: Number.isFinite(retry) && retry > 0 ? retry : 60,
      });
    }
    // Anything else is a server fault, not something the caller can fix.
    throw new Error(`${name} failed with HTTP ${response.status}`);
  };

  return {
    async consumeSearch(userId: string): Promise<void> {
      await rpc('consume_catalog_search', { user_id: userId });
    },

    async saveTracks(tracks: CatalogTrack[]): Promise<Map<string, string>> {
      const saved = await rpc('save_catalog_tracks', {
        tracks: tracks.map((track) => ({
          provider_track_id: track.providerTrackId,
          title: track.title,
          artists: track.artists,
          album: track.album,
          duration_ms: track.durationMs,
          isrc: track.isrc,
          explicit: track.explicit,
          artwork_url: track.artworkUrl,
          artwork_background_color: track.artworkBackgroundColor,
          version_tags: track.versionTags,
        })),
      });
      if (!Array.isArray(saved)) throw new Error('save_catalog_tracks returned no list');
      const ids = new Map<string, string>();
      for (const row of saved) {
        const { provider_track_id: trackId, recording_id: recordingId } = (row ?? {}) as Record<
          string,
          unknown
        >;
        if (typeof trackId === 'string' && typeof recordingId === 'string') {
          ids.set(trackId, recordingId);
        }
      }
      return ids;
    },
  };
}
