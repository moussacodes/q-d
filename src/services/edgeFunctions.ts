/**
 * Calls a Supabase Edge Function over HTTP. Where data leaves the device, so
 * it lives in services (ARCHITECTURE.md §4.7). Plain `fetch`, so it runs in
 * Expo Go and on the web; the Supabase client card can swap in
 * `supabase.functions.invoke` behind the same `EdgeFunctionInvoker` type.
 *
 * It never logs: requests can carry search queries, and headers carry the
 * user's session token.
 */

/** What came back, unparsed. Callers validate `body` with a Zod schema. */
export type EdgeFunctionResponse = {
  status: number;
  /** Parsed JSON, or `null` when the body wasn't JSON. */
  body: unknown;
};

export type EdgeFunctionInvoker = (name: string, body: unknown) => Promise<EdgeFunctionResponse>;

export type EdgeFunctionConfig = {
  /** The Supabase project URL, e.g. `https://<project>.supabase.co`. */
  url: string;
  /** The project's publishable (anon) key. Public by design. */
  anonKey: string;
  /** The signed-in user's access token, or `null` when signed out. */
  getAccessToken: () => Promise<string | null>;
  fetch?: typeof fetch;
  /** How long to wait for an answer. Default 10 s. */
  timeoutMs?: number;
};

/** The request never reached the function, or no answer came in time. */
export class EdgeFunctionNetworkError extends Error {
  override readonly name = 'EdgeFunctionNetworkError';

  constructor(readonly reason: 'network' | 'timeout' | 'not_authenticated') {
    super(reason);
  }
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;

export function createEdgeFunctionInvoker(config: EdgeFunctionConfig): EdgeFunctionInvoker {
  const doFetch = config.fetch ?? fetch;
  const base = config.url.replace(/\/+$/, '');

  return async (name, body) => {
    if (!NAME.test(name)) throw new Error(`Bad Edge Function name: ${name}`);
    const token = await config.getAccessToken();
    if (!token) throw new EdgeFunctionNetworkError('not_authenticated');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
    let response: Response;
    try {
      response = await doFetch(`${base}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
          apikey: config.anonKey,
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new EdgeFunctionNetworkError(controller.signal.aborted ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }

    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  };
}
