import { useCallback, useRef, useState } from 'react';

import type { RpcCallError } from '@/domain/rpc-error';

import { newIdempotencyKey } from './mockServer';

/** Where a call to the server is: not started, waiting for its answer, or failed with an error. */
export type CallState =
  { status: 'idle' } | { status: 'pending' } | { status: 'failed'; error: RpcCallError };

export type CallResult<T> = { ok: true; value: T } | { ok: false; error: RpcCallError };

const idle: CallState = { status: 'idle' };

/** No answer, so the server may or may not have done it: a retry must reuse the key. */
const unanswered = (error: RpcCallError) => error.code === 'network' || error.code === 'unexpected';

/**
 * One server call at a time: while one is pending, another tap does nothing,
 * so a double tap can't send two.
 *
 * Idempotency (API_CONTRACTS.md §1): each tap is one intent with its own key.
 * When a call got no answer (`network`, `unexpected`), the server may have
 * done it already, so trying the same thing again reuses that key and the
 * server answers with the stored result instead of doing it twice. An
 * answered error (a wrong code, a full room) was rejected and stored
 * nothing, so the next tap is a new intent with a new key.
 */
export function useCall<A, T>(call: (args: A, idempotencyKey: string) => Promise<CallResult<T>>) {
  const [state, setState] = useState<CallState>(idle);
  const busy = useRef(false);
  /** The key of a call that got no answer, with its arguments, for a retry. */
  const pending = useRef<{ args: string; key: string } | null>(null);
  const run = useCallback(
    async (args: A): Promise<T | null> => {
      if (busy.current) return null;
      busy.current = true;
      setState({ status: 'pending' });
      const argsKey = JSON.stringify(args ?? null);
      const key =
        pending.current && pending.current.args === argsKey
          ? pending.current.key
          : newIdempotencyKey();
      try {
        const result = await call(args, key);
        pending.current = !result.ok && unanswered(result.error) ? { args: argsKey, key } : null;
        setState(result.ok ? idle : { status: 'failed', error: result.error });
        return result.ok ? result.value : null;
      } catch {
        // A call that throws didn't get an answer either. The button must
        // not stay stuck on busy, and the person is told.
        pending.current = { args: argsKey, key };
        setState({ status: 'failed', error: { code: 'network' } });
        return null;
      } finally {
        busy.current = false;
      }
    },
    [call],
  );
  const reset = useCallback(() => setState(idle), []);
  return { state, run, reset };
}
