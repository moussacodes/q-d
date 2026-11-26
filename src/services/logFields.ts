import type { z } from 'zod';

/**
 * Safe, structured log fields built outside the log call, so the call site
 * names only what it logs (src/services/privacyGuard.test.ts reads names at
 * the call site).
 */

/**
 * Where a parsed value went wrong: each Zod issue's field path and Zod's
 * issue kind (`invalid_type`, `too_small`…). Never the value or Zod's message,
 * which can quote the input.
 */
export function zodIssueFields(error: z.ZodError): { path: string; kind: string }[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), kind: issue.code }));
}

/**
 * A PostgREST / SQLSTATE code (`PGRST116`, `23505`, `P0001`), safe to log.
 * Anything that isn't code-shaped is logged as `other`; a room code (six
 * characters) never fits.
 */
export function loggableDbCode(code: string | null | undefined): string | null {
  if (code === null || code === undefined || code === '') return null;
  return /^[A-Z0-9]{5}$|^PGRST\d{1,4}$/.test(code) ? code : 'other';
}
