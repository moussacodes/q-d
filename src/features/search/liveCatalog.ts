import { createAppleMusicCatalog, type CatalogAdapter } from '@/providers';
import { createEdgeFunctionInvoker, type EdgeFunctionInvoker } from '@/services/edgeFunctions';
import { env } from '@/services/env';
import { getSupabase } from '@/services/supabase';

/**
 * Live canonical search (Forge card "Wire search / add-song to canonical
 * search"): the Apple catalog adapter calling the `catalog-search` Edge
 * Function with the signed-in user's token. Results carry the `recordingId`
 * the server saved, which `enqueue_recording` takes.
 *
 * Built once per app run. Without Supabase settings (mock mode) there's no
 * live catalog, and search uses the labeled mock instead.
 */
let cached: CatalogAdapter | null = null;

/** The signed-in user's access token, or null when signed out. Never logged. */
async function accessToken(): Promise<string | null> {
  const client = getSupabase();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

export function createLiveCatalog(invoke: EdgeFunctionInvoker): CatalogAdapter {
  return createAppleMusicCatalog({ invoke });
}

export function liveCatalog(): CatalogAdapter {
  if (cached) return cached;
  const supabase = env.supabase;
  const invoke: EdgeFunctionInvoker = supabase
    ? createEdgeFunctionInvoker({
        url: supabase.url,
        anonKey: supabase.publishableKey,
        getAccessToken: accessToken,
      })
    : // No project to call: answer like a network failure, which the adapter
      // reports as "search isn't working", never as results.
      async () => ({ status: 503, body: null });
  cached = createLiveCatalog(invoke);
  return cached;
}

/** For tests: build the live catalog again on the next call. */
export function resetLiveCatalog() {
  cached = null;
}
