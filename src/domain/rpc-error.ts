/**
 * The error codes RPCs answer with (docs/API_CONTRACTS.md §2). The app maps
 * each one to copy and never shows a raw database message. `invalid_input`
 * comes from DECISIONS.md 2026-11-24 · RPC contracts.
 */
export type RpcErrorCode =
  | 'not_authenticated'
  | 'profile_incomplete'
  | 'room_not_found'
  | 'room_ended'
  | 'not_member'
  | 'not_host'
  | 'not_allowed'
  | 'room_full'
  | 'code_invalid'
  | 'invite_invalid'
  | 'rate_limited'
  | 'provider_required'
  | 'provider_unavailable'
  | 'already_in_queue'
  | 'entry_not_found'
  | 'stale_state'
  | 'import_in_progress'
  | 'limit_exceeded'
  | 'idempotency_conflict'
  | 'feature_disabled'
  | 'invalid_input'
  /** `switch_playback_provider` (proposed): the song has started. */
  | 'not_between_songs'
  /** `switch_playback_provider` (proposed): nothing to switch. */
  | 'not_needed';

export type RpcError =
  | { code: Exclude<RpcErrorCode, 'rate_limited'> }
  /** `rate_limited` says when to try again. */
  | { code: 'rate_limited'; retryAfterSeconds: number };

/** What an RPC answers: its result, or one error from the list above. */
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError };
