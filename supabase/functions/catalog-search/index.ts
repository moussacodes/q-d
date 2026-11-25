/**
 * catalog-search Edge Function entry point (Deno, Supabase).
 *
 * Contract: docs/API_CONTRACTS.md § Catalog. The logic is in `handler.ts`;
 * this file only reads the environment and wires the real fetch, token and
 * database.
 *
 * Secrets (set with `supabase secrets set`, never `EXPO_PUBLIC_*`):
 *   APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_PRIVATE_KEY (.p8 text).
 * Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY itself.
 * Without the Apple secrets, search answers `provider_unavailable`.
 *
 * Built, not yet run against the live Apple Music API: the team has no
 * developer key yet.
 */
import { createTokenCache } from './apple.ts';
import { createCatalogStore } from './db.ts';
import { createHandler } from './handler.ts';

// Only what this file uses from the Deno runtime, so TypeScript and Jest can
// check it without Deno's types.
declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
  env: { get(name: string): string | undefined };
};

export function handlerFromEnv(
  env: (name: string) => string | undefined,
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
) {
  const teamId = env('APPLE_MUSIC_TEAM_ID');
  const keyId = env('APPLE_MUSIC_KEY_ID');
  const privateKey = env('APPLE_MUSIC_PRIVATE_KEY');
  const tokens =
    teamId && keyId && privateKey
      ? createTokenCache({ teamId, keyId, privateKey }, () => Math.floor(Date.now() / 1000))
      : null;

  const store = createCatalogStore({
    url: env('SUPABASE_URL') ?? '',
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    fetch: fetcher,
  });

  return createHandler({
    fetch: fetcher,
    tokens,
    consumeSearch: store.consumeSearch,
    saveTracks: store.saveTracks,
  });
}

if (typeof Deno !== 'undefined') {
  Deno.serve(handlerFromEnv((name) => Deno.env.get(name), fetch));
}
