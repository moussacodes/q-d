/**
 * delete-account Edge Function (placeholder).
 *
 * Contract: docs/API_CONTRACTS.md § Account, `delete_account`. Steps:
 * docs/PRODUCT_SPEC.md §7 "Account deletion". It runs as an Edge Function
 * because it needs the service role to delete the auth user and to revoke
 * provider authorizations.
 *
 * Not built yet: it checks the request and answers `feature_disabled`, so the
 * app can wire the call and show honest copy. The account-deletion card fills
 * it in (recent re-authentication, end hosted rooms with end_room, "Deleted
 * user" attribution, retries within 24 hours).
 *
 * Runs on Deno in Supabase. `handler` is exported so Jest can test it in Node.
 */

// Only what this file uses from the Deno runtime, so the app's TypeScript and
// the Jest tests can type-check it without Deno's types.
declare const Deno: { serve(handler: (request: Request) => Response | Promise<Response>): unknown };

type ErrorCode = 'not_authenticated' | 'invalid_input' | 'feature_disabled';

const json = (status: number, body: Record<string, unknown>, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Same shape for every q’d error: a stable `code` from API_CONTRACTS.md §2. */
const error = (status: number, code: ErrorCode, headers?: HeadersInit) =>
  json(status, { code }, headers);

export async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return error(405, 'invalid_input', { allow: 'POST' });
  }
  // Supabase verifies the JWT before the function runs (verify_jwt in
  // config.toml). This only rejects a request that arrives without one.
  if (!/^Bearer \S+$/.test(request.headers.get('authorization') ?? '')) {
    return error(401, 'not_authenticated');
  }
  return error(501, 'feature_disabled');
}

if (typeof Deno !== 'undefined') {
  Deno.serve(handler);
}
