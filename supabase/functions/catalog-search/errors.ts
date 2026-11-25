/**
 * Errors the catalog-search function answers with. Every one carries a stable
 * code from docs/API_CONTRACTS.md §2, as `{ "code": … }` plus any extra fields.
 */

export type ErrorCode =
  'not_authenticated' | 'invalid_input' | 'rate_limited' | 'provider_unavailable';

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export const isServiceError = (error: unknown): error is ServiceError =>
  error instanceof ServiceError;

/** Browsers (the web preview) call the function cross-origin. */
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

export function errorResponse(error: ServiceError): Response {
  const headers: Record<string, string> = {};
  if (error.code === 'rate_limited' && typeof error.details.retry_after_seconds === 'number') {
    headers['retry-after'] = String(error.details.retry_after_seconds);
  }
  if (error.status === 405) headers.allow = 'POST, OPTIONS';
  return json(error.status, { code: error.code, ...error.details }, headers);
}
