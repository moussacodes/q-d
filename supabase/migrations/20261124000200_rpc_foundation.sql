-- RPC foundation: the machinery every room and queue mutation uses.
-- Contract: docs/API_CONTRACTS.md §1 (conventions) and §2 (error codes).
--
-- * Errors: private.raise_error(code) raises SQLSTATE P0001 with the stable
--   q’d code as the message. PostgREST returns it as `error.message`, extra
--   fields (for example retry_after_seconds) as JSON in `error.details`, and
--   `error.hint` is 'qd' so the app can tell a q’d error from any other.
-- * Idempotency: private.idempotency_replay() and private.idempotency_store()
--   wrap each mutation. A replay returns the stored result; the same key with
--   different arguments fails with idempotency_conflict.
-- * Checks, in the contract's order: private.require_user(),
--   private.require_complete_profile(), private.lock_room(),
--   private.require_member(), private.require_host() / private.require_allowed().
-- * Broadcasts: private.broadcast_room_event() sends the refetch hint from
--   inside the RPC (ARCHITECTURE.md open decision 2), through realtime.send().
--
-- The private schema isn't exposed by the API (config.toml exposes `public`
-- only). API roles get no usage on it, and every migration that adds private
-- functions ends by revoking execute from public, so nothing in it is callable
-- by a client unless a later migration grants it on purpose.

create schema private;
revoke all on schema private from public;

-- Errors ---------------------------------------------------------------------

-- Every code an RPC may raise. API_CONTRACTS.md §2 lists the same set.
create function private.error_codes() returns text[]
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
    'already_in_queue',
    'entry_not_found',
    'stale_state',
    'import_in_progress',
    'limit_exceeded',
    'idempotency_conflict',
    'feature_disabled'
  ]
$$;

create function private.raise_error(code text, details jsonb default null) returns void
language plpgsql
set search_path = ''
as $$
begin
  if code is null or not (code = any (private.error_codes())) then
    raise exception 'unknown q’d error code: %', coalesce(code, 'null');
  end if;
  if details is null then
    raise exception using errcode = 'P0001', message = code, hint = 'qd';
  end if;
  raise exception using errcode = 'P0001', message = code, detail = details::text, hint = 'qd';
end;
$$;

-- Sign-in and profile --------------------------------------------------------

create function private.require_user() returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    perform private.raise_error('not_authenticated');
  end if;
  return uid;
end;
$$;

create function private.require_complete_profile(uid uuid) returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = uid
       and p.display_name is not null
       and p.color is not null
       and p.adult_confirmed_at is not null
  ) then
    perform private.raise_error('profile_incomplete');
  end if;
end;
$$;

-- Idempotency ----------------------------------------------------------------

create function private.require_idempotency_key(idempotency_key uuid) returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if idempotency_key is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'idempotency_key'));
  end if;
end;
$$;

create function private.request_hash(request jsonb) returns bytea
language sql immutable
set search_path = ''
as $$
  -- jsonb's text form is canonical (keys sorted, whitespace normalized), so the
  -- same arguments always hash the same.
  select sha256(convert_to(coalesce(request, 'null'::jsonb)::text, 'UTF8'))
$$;

-- Returns the stored result when (caller, operation, key) already succeeded,
-- null when it's new. Raises idempotency_conflict when the key was used with
-- different arguments. Takes a transaction-level lock on the key first, so a
-- second request with the same key waits for the first to commit or fail.
create function private.idempotency_replay(operation text, idempotency_key uuid, request jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  stored public.idempotency_keys;
begin
  perform private.require_idempotency_key(idempotency_key);
  perform pg_advisory_xact_lock(
    hashtextextended(uid::text || ':' || operation || ':' || idempotency_key::text, 0)
  );

  select * into stored
    from public.idempotency_keys k
   where k.user_id = uid and k.operation = idempotency_replay.operation
     and k.idempotency_key = idempotency_replay.idempotency_key;

  if not found then
    return null;
  end if;

  if stored.expires_at <= now() then
    delete from public.idempotency_keys k
     where k.user_id = uid and k.operation = idempotency_replay.operation
       and k.idempotency_key = idempotency_replay.idempotency_key;
    return null;
  end if;

  if stored.request_hash <> private.request_hash(request) then
    perform private.raise_error('idempotency_conflict');
  end if;

  return stored.result;
end;
$$;

-- Stores a successful result and returns it. Call it last, so a failure
-- anywhere before rolls back and leaves the key free for a retry.
create function private.idempotency_store(
  operation text,
  idempotency_key uuid,
  request jsonb,
  result jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  insert into public.idempotency_keys (user_id, operation, idempotency_key, request_hash, result)
  values (private.require_user(), operation, idempotency_key, private.request_hash(request), result);
  return result;
end;
$$;

-- Deletes expired keys. Returns how many. Meant for a scheduled job.
create function private.purge_expired_idempotency_keys() returns integer
language sql
set search_path = ''
as $$
  with gone as (
    delete from public.idempotency_keys where expires_at <= now() returning 1
  )
  select count(*)::integer from gone
$$;

-- Rooms and permissions ------------------------------------------------------

-- Locks the room row for the rest of the transaction, so concurrent mutations
-- of one room run one after another. Raises room_not_found or room_ended.
create function private.lock_room(room_id uuid) returns public.rooms
language plpgsql
set search_path = ''
as $$
declare
  room public.rooms;
begin
  select * into room from public.rooms r where r.id = lock_room.room_id for update;
  if not found then
    perform private.raise_error('room_not_found');
  end if;
  if room.state = 'ended' then
    perform private.raise_error('room_ended');
  end if;
  return room;
end;
$$;

create function private.member_role(room_id uuid, user_id uuid) returns public.member_role
language sql stable
set search_path = ''
as $$
  select m.role from public.room_members m
   where m.room_id = member_role.room_id and m.user_id = member_role.user_id
$$;

create function private.require_member(room_id uuid, user_id uuid) returns public.member_role
language plpgsql stable
set search_path = ''
as $$
declare
  role public.member_role := private.member_role(room_id, user_id);
begin
  if role is null then
    perform private.raise_error('not_member');
  end if;
  return role;
end;
$$;

create function private.require_host(room_id uuid, user_id uuid) returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if private.require_member(room_id, user_id) <> 'host' then
    perform private.raise_error('not_host');
  end if;
end;
$$;

-- Whether a member may act under one of the room's rules
-- (PRODUCT_SPEC.md §4 "Who can do what"). The host can always do everything.
create function private.is_allowed(room public.rooms, user_id uuid, rule public.room_rule)
returns boolean
language sql stable
set search_path = ''
as $$
  select case
    when role is null then false
    when role = 'host' then true
    else case (case rule when 'add_songs' then room.add_songs else room.control end)
      when 'everyone' then true
      when 'host' then false
      when 'chosen' then exists (
        select 1 from public.room_rule_members c
         where c.room_id = room.id and c.rule = is_allowed.rule and c.user_id = is_allowed.user_id
      )
    end
  end
  from (select private.member_role(room.id, user_id) as role) as m
$$;

create function private.require_allowed(room public.rooms, user_id uuid, rule public.room_rule)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  perform private.require_member(room.id, user_id);
  if not private.is_allowed(room, user_id, rule) then
    perform private.raise_error('not_allowed');
  end if;
end;
$$;

-- Realtime -------------------------------------------------------------------

-- Sends a refetch hint on the room's private channel (API_CONTRACTS.md §4).
-- Carries ids and a version only, never names or song details.
create function private.broadcast_room_event(room_id uuid, event_type text) returns void
language plpgsql
set search_path = ''
as $$
begin
  if event_type not in ('queue.changed', 'playback.changed', 'members.changed', 'room.ended') then
    raise exception 'unknown room event type: %', event_type;
  end if;
  perform realtime.send(
    jsonb_build_object(
      'v', 1,
      'type', event_type,
      'roomId', room_id,
      'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    event_type,
    'room:' || room_id::text,
    true
  );
end;
$$;

-- sync (beta) placeholders ---------------------------------------------------

-- Defined so the contract exists, but sync is behind a flag that's off. They
-- check sign-in, then fail with feature_disabled.
create function public.claim_playback_slot(room_id uuid, idempotency_key uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  perform private.raise_error('feature_disabled', jsonb_build_object('flag', 'sync'));
  return null;
end;
$$;

create function public.release_playback_slot(room_id uuid, idempotency_key uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  perform private.raise_error('feature_disabled', jsonb_build_object('flag', 'sync'));
  return null;
end;
$$;

revoke execute on function public.claim_playback_slot(uuid, uuid) from public, anon;
revoke execute on function public.release_playback_slot(uuid, uuid) from public, anon;
grant execute on function public.claim_playback_slot(uuid, uuid) to authenticated;
grant execute on function public.release_playback_slot(uuid, uuid) to authenticated;

-- Nothing in private is callable by API roles.
revoke execute on all functions in schema private from public;
