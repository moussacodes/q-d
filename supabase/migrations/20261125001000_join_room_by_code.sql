-- join_room_by_code: a signed-in user joins a live room with its six-character
-- code (docs/API_CONTRACTS.md § join_room_by_code and § 7).
--
-- Manual codes are short (32^6 ≈ 1.07 billion), so joining by code needs:
--   * sign-in and a finished profile,
--   * the code's expiry (24 hours, set by create_room) and a live room,
--   * strict attempt limits per user and per IP address, checked before the
--     code is looked up. Wrong and expired codes give the same code_invalid.
--
-- Failed guesses have to be remembered even though the call fails. An
-- exception would roll the record back with everything else, so a wrong code
-- is answered with private.error_response(): the function returns normally,
-- the transaction commits the failed attempt, and PostgREST sends HTTP 400 with
-- the same body a raised q’d error has ({ code: 'P0001', message, details,
-- hint: 'qd' }). supabase-js reports it as `error`, exactly like a raise.
-- Every other error is raised as usual.

-- Error responses that commit ----------------------------------------------------

-- Sets PostgREST's response status and returns the error body that a raised
-- q’d error produces. Only for errors whose side effects must survive (a
-- failed guess); everything else uses private.raise_error().
create function private.error_response(code text, details jsonb default null) returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if code is null or not (code = any (private.error_codes())) then
    raise exception 'unknown q’d error code: %', coalesce(code, 'null');
  end if;
  perform set_config('response.status', '400', true);
  return jsonb_build_object(
    'code', 'P0001',
    'message', code,
    'details', case when details is null then null else details::text end,
    'hint', 'qd'
  );
end;
$$;

-- Attempt limits -----------------------------------------------------------------

-- Failed join attempts (a code or invite token that matched nothing). Never
-- holds the code or token that was tried, and holds the caller's IP address
-- only as a SHA-256 hash. Lives in the private schema, so no API role can
-- read or write it.
create table private.join_attempts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('code', 'invite')),
  user_id uuid not null references public.profiles (id) on delete cascade,
  ip_hash bytea check (ip_hash is null or octet_length(ip_hash) = 32),
  attempted_at timestamptz not null default now()
);

create index join_attempts_user_idx on private.join_attempts (user_id, kind, attempted_at);
create index join_attempts_ip_idx on private.join_attempts (ip_hash, kind, attempted_at)
  where ip_hash is not null;

alter table private.join_attempts enable row level security;
revoke all on private.join_attempts from public, anon, authenticated;

-- The limits (DECISIONS 2026-11-25 · join_room_by_code). A success never
-- resets them: otherwise anyone could clear their count with their own room's
-- code between guesses. They reset only as failures age out of the window.
create function private.join_attempt_window() returns interval
language sql immutable
set search_path = ''
as $$ select interval '10 minutes' $$;

create function private.join_attempt_user_limit() returns integer
language sql immutable
set search_path = ''
as $$ select 5 $$;

create function private.join_attempt_ip_limit() returns integer
language sql immutable
set search_path = ''
as $$ select 20 $$;

-- The caller's IP address, hashed, from the first X-Forwarded-For entry that
-- PostgREST passes in request.headers. Null when there's none or it isn't an
-- address. Behind Supabase's gateway a client can prepend its own entries, so
-- the per-user limit is the one that can't be dodged; the per-IP limit only
-- adds to it.
create function private.request_ip_hash() returns bytea
language plpgsql stable
set search_path = ''
as $$
declare
  headers jsonb;
  first_entry text;
  address inet;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  first_entry := btrim(split_part(headers ->> 'x-forwarded-for', ',', 1));
  if first_entry is null or first_entry = '' then
    return null;
  end if;
  begin
    address := first_entry::inet;
  exception when others then
    return null;
  end;
  return sha256(convert_to(host(address), 'UTF8'));
end;
$$;

-- Seconds until one more attempt is allowed, given the failures in the window
-- (oldest first) and the limit. Null while under the limit.
create function private.join_retry_after(failures timestamptz[], max_failures integer)
returns integer
language sql stable
set search_path = ''
as $$
  select case
    when coalesce(cardinality(failures), 0) < max_failures then null
    else greatest(
      1,
      ceil(extract(epoch from (
        failures[cardinality(failures) - max_failures + 1]
        + private.join_attempt_window() - now()
      )))::integer
    )
  end
$$;

-- Raises rate_limited (with retry_after_seconds) when the user or the IP
-- address has used up its failed attempts for this kind of join. Locks the
-- user's and the address's counters for the rest of the transaction, so
-- parallel guesses are counted one after another and can't slip past together.
create function private.check_join_attempts(kind text, user_id uuid, ip_hash bytea)
returns void
language plpgsql
set search_path = ''
as $$
declare
  by_user timestamptz[];
  by_ip timestamptz[];
  wait_seconds integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('join_attempts:user:' || user_id::text, 0));
  if ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('join_attempts:ip:' || encode(ip_hash, 'hex'), 0));
  end if;

  select coalesce(array_agg(a.attempted_at order by a.attempted_at), '{}') into by_user
    from private.join_attempts a
   where a.user_id = check_join_attempts.user_id
     and a.kind = check_join_attempts.kind
     and a.attempted_at > now() - private.join_attempt_window();

  if ip_hash is not null then
    select coalesce(array_agg(a.attempted_at order by a.attempted_at), '{}') into by_ip
      from private.join_attempts a
     where a.ip_hash = check_join_attempts.ip_hash
       and a.kind = check_join_attempts.kind
       and a.attempted_at > now() - private.join_attempt_window();
  end if;

  wait_seconds := greatest(
    private.join_retry_after(by_user, private.join_attempt_user_limit()),
    private.join_retry_after(by_ip, private.join_attempt_ip_limit())
  );
  if wait_seconds is not null then
    perform private.raise_error('rate_limited', jsonb_build_object('retry_after_seconds', wait_seconds));
  end if;
end;
$$;

create function private.record_join_failure(kind text, user_id uuid, ip_hash bytea) returns void
language sql
set search_path = ''
as $$
  insert into private.join_attempts (kind, user_id, ip_hash) values (kind, user_id, ip_hash)
$$;

-- Deletes attempts older than a day. Returns how many. Meant for a scheduled
-- job, like private.purge_expired_idempotency_keys().
create function private.purge_join_attempts() returns integer
language sql
set search_path = ''
as $$
  with gone as (
    delete from private.join_attempts where attempted_at <= now() - interval '1 day' returning 1
  )
  select count(*)::integer from gone
$$;

-- Room codes as people type them --------------------------------------------------

-- The six code characters from what someone typed or pasted: case-insensitive,
-- spaces and dashes ignored, an optional QD prefix dropped. A code can itself
-- start with QD, so the prefix is dropped only from eight characters. Null when
-- the rest isn't six characters of the code alphabet: look-alikes (0, O, 1, I)
-- are never in a code, so they aren't guessed at.
create function private.normalize_room_code(input text) returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  chars text := upper(regexp_replace(coalesce(input, ''), '[[:space:]-]', '', 'g'));
begin
  if char_length(chars) = 8 and left(chars, 2) = 'QD' then
    chars := substr(chars, 3);
  end if;
  if chars !~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$' then
    return null;
  end if;
  return chars;
end;
$$;

-- Joining ------------------------------------------------------------------------------

-- Adds the user to a room they found by code or invite. Locks the room first
-- (room_ended if it ended meanwhile). Already a member: nothing changes.
-- Otherwise checks the 15-person cap (the trigger on room_members checks it
-- again) and tells the room's members to refetch.
create function private.join_room(room_id uuid, user_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  room public.rooms := private.lock_room(room_id);
begin
  if private.member_role(room.id, user_id) is not null then
    return;
  end if;
  if (select count(*) from public.room_members m where m.room_id = room.id) >= 15 then
    perform private.raise_error('room_full');
  end if;
  insert into public.room_members (room_id, user_id, role) values (room.id, user_id, 'member');
  perform private.broadcast_room_event(room.id, 'members.changed');
end;
$$;

-- join_room_by_code --------------------------------------------------------------------

create function public.join_room_by_code(code text, idempotency_key uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  normalized text := private.normalize_room_code(join_room_by_code.code);
  -- The normalized code, so `qd-7k4f9x` and `7K4F9X` are the same request.
  request jsonb := jsonb_build_object('code', coalesce(normalized, join_room_by_code.code));
  stored jsonb;
  ip_hash bytea := private.request_ip_hash();
  found_room_id uuid;
begin
  stored := private.idempotency_replay('join_room_by_code', join_room_by_code.idempotency_key, request);
  if stored is not null then
    return stored;
  end if;

  perform private.require_complete_profile(uid);
  perform private.check_join_attempts('code', uid, ip_hash);

  -- Not six characters of the alphabet: it can't match any code, so it tells
  -- nobody anything and isn't counted. Same error as a wrong code.
  if normalized is null then
    return private.error_response('code_invalid');
  end if;

  select r.id into found_room_id
    from public.rooms r
   where r.code = normalized and r.state <> 'ended' and r.code_expires_at > now();

  if found_room_id is null then
    perform private.record_join_failure('code', uid, ip_hash);
    return private.error_response('code_invalid');
  end if;

  perform private.join_room(found_room_id, uid);

  return private.idempotency_store(
    'join_room_by_code',
    join_room_by_code.idempotency_key,
    request,
    jsonb_build_object('room_id', found_room_id)
  );
end;
$$;

revoke execute on all functions in schema private from public;
revoke execute on function public.join_room_by_code(text, uuid) from public, anon;
grant execute on function public.join_room_by_code(text, uuid) to authenticated;
