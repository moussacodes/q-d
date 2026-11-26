import type { z } from 'zod';

import { isRpcErrorCode, type RpcCallError } from '@/domain/rpc-error';

import { log } from './logger';

/**
 * The typed RPC client (docs/API_CONTRACTS.md §1). Every room and queue change
 * goes through a Postgres function called with `supabase.rpc`, and comes back
 * as an `RpcCallResult`: the parsed result, or an error the app has copy for.
 * It never throws and never shows a raw database message.
 *
 * The error transport: an RPC raises SQLSTATE `P0001` with our code as the
 * message, extra fields as JSON in `details`, and the hint `qd`. Errors that
 * must keep a side effect (a failed join attempt) come back through
 * `private.error_response()` as an HTTP 400 with the same body, which
 * supabase-js reports as the same `error`. Both read the same here.
 */

export type { RpcCallError };

export type RpcCallResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: RpcCallError;
      /** Extra fields the server sent with the error (`details`), e.g. `status`, `field`. */
      details: Record<string, unknown>;
    };

/** What supabase-js puts in `error` for an RPC (a `PostgrestError`, or a fetch failure). */
export type PostgrestErrorLike = {
  message?: string;
  code?: string;
  details?: unknown;
  hint?: string | null;
};

/** The part of a `SupabaseClient` the RPC client uses. */
export interface RpcClientLike {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: PostgrestErrorLike | null; status?: number }>;
}

/** How long to wait when `rate_limited` arrives without `retry_after_seconds`. */
export const DEFAULT_RETRY_AFTER_SECONDS = 30;

const rpcLog = log.child('rpc');

function readDetails(details: unknown): Record<string, unknown> {
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    return details as Record<string, unknown>;
  }
  if (typeof details !== 'string' || details === '') return {};
  try {
    const parsed: unknown = JSON.parse(details);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** A fetch that never got an answer: offline, DNS, a timeout or an aborted request. */
function isNetworkFailure(error: PostgrestErrorLike | null, status: number | undefined): boolean {
  if (status === 0) return true;
  const message = error?.message ?? '';
  return (
    !error?.code && /network|fetch|timed? ?out|abort|offline|connection|load failed/i.test(message)
  );
}

/** Maps supabase-js's `error` to our error. Exported for tests. */
export function rpcErrorFrom(
  error: PostgrestErrorLike | null,
  status?: number,
): { error: RpcCallError; details: Record<string, unknown> } {
  if (error?.hint === 'qd' && isRpcErrorCode(error.message)) {
    const details = readDetails(error.details);
    if (error.message === 'rate_limited') {
      const seconds = Number(details.retry_after_seconds);
      return {
        error: {
          code: 'rate_limited',
          retryAfterSeconds:
            Number.isFinite(seconds) && seconds > 0
              ? Math.ceil(seconds)
              : DEFAULT_RETRY_AFTER_SECONDS,
        },
        details,
      };
    }
    return { error: { code: error.message }, details };
  }
  if (isNetworkFailure(error, status)) return { error: { code: 'network' }, details: {} };
  return { error: { code: 'unexpected' }, details: {} };
}

/**
 * Calls the RPC `name` with snake_case `args` and parses its result with
 * `schema`. Logs the operation and our code, never the arguments, the
 * server's message or the result (they can hold codes, tokens or names).
 */
export async function callRpc<T>(
  client: RpcClientLike,
  name: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<RpcCallResult<T>> {
  let answer: Awaited<ReturnType<RpcClientLike['rpc']>>;
  try {
    answer = await client.rpc(name, args);
  } catch (error) {
    rpcLog.warn('RPC call threw', { operation: name, error });
    return { ok: false, error: { code: 'network' }, details: {} };
  }
  if (answer.error) {
    const failure = rpcErrorFrom(answer.error, answer.status);
    rpcLog.info('RPC refused', {
      operation: name,
      result: failure.error.code,
      status: answer.status,
      postgresCode: answer.error.code,
    });
    return { ok: false, ...failure };
  }
  const parsed = schema.safeParse(answer.data);
  if (!parsed.success) {
    rpcLog.warn('RPC result did not parse', {
      operation: name,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
      })),
    });
    return { ok: false, error: { code: 'unexpected' }, details: {} };
  }
  return { ok: true, value: parsed.data };
}
