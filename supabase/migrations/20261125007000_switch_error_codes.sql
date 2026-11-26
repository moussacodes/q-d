-- Error codes for switch_playback_provider -------------------------------------
--
-- Integration of the provider-UI stack: API_CONTRACTS.md §2 adds
-- not_between_songs and not_needed for the proposed switch_playback_provider
-- (DECISIONS.md 2026-11-25 · Provider switching between songs). The RPC isn't
-- built yet, but the code list has to match the contract table, so the codes
-- are added here. Nothing raises them until the RPC lands.
create or replace function private.error_codes() returns text[]
language sql immutable
set search_path = ''
as $$
  select array[
    'not_authenticated',
    'profile_incomplete',
    'invalid_input',
    'room_not_found',
    'room_ended',
    'not_member',
    'not_host',
    'not_allowed',
    'room_full',
    'code_invalid',
    'invite_invalid',
    'rate_limited',
    'provider_required',
    'provider_unavailable',
    'already_in_queue',
    'entry_not_found',
    'stale_state',
    'import_in_progress',
    'limit_exceeded',
    'idempotency_conflict',
    'feature_disabled',
    'not_between_songs',
    'not_needed'
  ]
$$;
