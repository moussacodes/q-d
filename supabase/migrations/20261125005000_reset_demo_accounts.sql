-- reset_demo_accounts: put the demo accounts back in a clean, known state
-- before a rehearsal or the demo (docs/DEMO_RUNBOOK.md § Reset between
-- rehearsals, API_CONTRACTS.md § reset_demo_accounts).
--
-- Operator only. The service role calls it through
-- supabase/scripts/reset-demo-accounts.js; anon and authenticated can't execute
-- it, and it also refuses any call that carries a signed-in user. It runs only
-- where the `demo_reset` server flag is on, which is the demo project alone, so
-- the same migration on the production project can't reset anyone.
--
-- For the users it's given, and nobody else:
--   * every room they host that hasn't ended is ended exactly like end_room
--     does it (private.close_room(): ended, code expired and freed, playback
--     stopped, live invites revoked, room.ended broadcast),
--   * the queues, import batches and memberships of every room they host are
--     deleted, so Home shows no leftover rooms and the next room starts empty.
--     The ended room rows stay, with nobody in them, so their codes stay free,
--   * their idempotency keys and failed join attempts are deleted, so no
--     rehearsal retry replays and no lockout carries over.
-- Profiles and provider connections are left alone: the runbook needs both
-- accounts signed in, onboarded and (for the host) connected. The result
-- reports how many listed accounts aren't, so the operator can fix that by
-- hand in the app.
--
-- Rooms hosted by other people are never touched, even when a demo account is
-- a member; the result counts those memberships so the operator knows.
--
-- `apply = false` (the default) changes nothing and returns the same counts.
-- Running it twice is safe: the second run finds nothing left to do.

-- Ending a room, shared with end_room ---------------------------------------

-- Ends a room that the caller has locked (private.lock_room or FOR UPDATE).
-- `actor` is recorded as who stopped playback.
create function private.close_room(room_id uuid, actor uuid) returns public.rooms
language plpgsql
set search_path = ''
as $$
declare
  room public.rooms;
begin
  update public.rooms r
     set state = 'ended',
         ended_at = now(),
         code_expires_at = least(r.code_expires_at, now())
   where r.id = close_room.room_id and r.state <> 'ended'
  returning * into room;

  if not found then
    raise exception 'close_room: room % is missing or already ended', close_room.room_id;
  end if;

  update public.playback_states p
     set status = 'stopped', reported_at = now(), reported_by = close_room.actor
   where p.room_id = room.id;

  update public.room_invites i
     set revoked_at = now()
   where i.room_id = room.id and i.revoked_at is null;

  perform private.broadcast_room_event(room.id, 'room.ended');
  return room;
end;
$$;

-- end_room keeps its contract and checks; it now ends the room through the
-- shared helper, so the reset can't drift from it.
create or replace function public.end_room(room_id uuid, idempotency_key uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  request jsonb := jsonb_build_object('room_id', end_room.room_id);
  stored jsonb;
  room public.rooms;
begin
  stored := private.idempotency_replay('end_room', end_room.idempotency_key, request);
  if stored is not null then
    return stored;
  end if;

  room := private.lock_room(end_room.room_id);
  perform private.require_host(room.id, uid);

  room := private.close_room(room.id, uid);

  return private.idempotency_store(
    'end_room',
    end_room.idempotency_key,
    request,
    jsonb_build_object('room_id', room.id, 'ended_at', room.ended_at)
  );
end;
$$;

-- The reset ------------------------------------------------------------------

insert into private.feature_flags (flag, enabled) values ('demo_reset', false);

-- At most this many accounts per call: the demo has two. A longer list is a
-- mistake (for example every user id pasted in), not a demo.
create function private.demo_reset_user_limit() returns integer
language sql immutable
set search_path = ''
as $$ select 10 $$;

create function public.reset_demo_accounts(user_ids uuid[], apply boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  ids uuid[];
  room_ids uuid[];
  live_ids uuid[];
  live_id uuid;
  result jsonb;
begin
  -- Defense in depth: execute is granted to service_role only, and a call that
  -- carries a signed-in user is refused even if a grant is added by mistake.
  if auth.uid() is not null then
    perform private.raise_error('not_allowed');
  end if;
  perform private.require_feature('demo_reset');

  if reset_demo_accounts.apply is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'apply'));
  end if;
  if user_ids is null or cardinality(user_ids) = 0 then
    perform private.raise_error(
      'invalid_input', jsonb_build_object('field', 'user_ids', 'reason', 'empty')
    );
  end if;
  if array_position(user_ids, null) is not null then
    perform private.raise_error(
      'invalid_input', jsonb_build_object('field', 'user_ids', 'reason', 'null_id')
    );
  end if;

  ids := array(select distinct u from unnest(user_ids) as u order by u);
  if cardinality(ids) > private.demo_reset_user_limit() then
    perform private.raise_error(
      'limit_exceeded',
      jsonb_build_object('field', 'user_ids', 'limit', private.demo_reset_user_limit())
    );
  end if;
  -- Every id must be a real account, so a typo can't silently reset nothing.
  -- Only the count is reported, never which ids.
  if exists (
    select 1 from unnest(ids) as u
     where not exists (select 1 from public.profiles p where p.id = u)
  ) then
    perform private.raise_error(
      'invalid_input',
      jsonb_build_object(
        'field', 'user_ids',
        'reason', 'unknown_user',
        'count', (
          select count(*) from unnest(ids) as u
           where not exists (select 1 from public.profiles p where p.id = u)
        )
      )
    );
  end if;

  -- Lock every room the accounts host, in a fixed order, before reading or
  -- changing anything, like every room RPC does. A join or an add that comes
  -- in meanwhile waits and then sees the reset room.
  room_ids := array(
    select r.id from public.rooms r
     where r.host_id = any (ids)
     order by r.id
       for update
  );
  live_ids := array(
    select r.id from public.rooms r
     where r.id = any (room_ids) and r.state <> 'ended'
     order by r.id
  );

  select jsonb_build_object(
    'applied', reset_demo_accounts.apply,
    'users', cardinality(ids),
    'rooms_ended', cardinality(live_ids),
    'invites_revoked', (
      select count(*) from public.room_invites i
       where i.room_id = any (room_ids) and i.revoked_at is null
    ),
    'queue_entries_deleted', (
      select count(*) from public.queue_entries e where e.room_id = any (room_ids)
    ),
    'import_batches_deleted', (
      select count(*) from public.playlist_import_batches b where b.room_id = any (room_ids)
    ),
    'memberships_deleted', (
      select count(*) from public.room_members m where m.room_id = any (room_ids)
    ),
    'idempotency_keys_deleted', (
      select count(*) from public.idempotency_keys k where k.user_id = any (ids)
    ),
    'join_attempts_deleted', (
      select count(*) from private.join_attempts a where a.user_id = any (ids)
    ),
    -- Left alone, reported so the operator can act.
    'memberships_elsewhere', (
      select count(*) from public.room_members m
        join public.rooms r on r.id = m.room_id
       where m.user_id = any (ids) and r.state <> 'ended' and not (r.id = any (room_ids))
    ),
    'profiles_incomplete', (
      select count(*) from public.profiles p
       where p.id = any (ids)
         and (p.display_name is null or p.color is null or p.adult_confirmed_at is null)
    ),
    'users_without_service', (
      select count(*) from unnest(ids) as u
       where not exists (select 1 from public.provider_connections c where c.user_id = u)
    )
  ) into result;

  if not reset_demo_accounts.apply then
    return result;
  end if;

  foreach live_id in array live_ids loop
    perform private.close_room(
      live_id, (select r.host_id from public.rooms r where r.id = live_id)
    );
  end loop;

  -- Invites of rooms that had already ended are revoked by end_room; this
  -- catches any left live by hand.
  update public.room_invites i
     set revoked_at = now()
   where i.room_id = any (room_ids) and i.revoked_at is null;

  -- playback_states.entry_id is set null by its foreign key.
  delete from public.queue_entries e where e.room_id = any (room_ids);
  delete from public.playlist_import_batches b where b.room_id = any (room_ids);
  -- Cascades to room_rule_members and playback_slots.
  delete from public.room_members m where m.room_id = any (room_ids);
  delete from public.idempotency_keys k where k.user_id = any (ids);
  delete from private.join_attempts a where a.user_id = any (ids);

  return result;
end;
$$;

revoke execute on all functions in schema private from public;
revoke execute on function public.reset_demo_accounts(uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.reset_demo_accounts(uuid[], boolean) to service_role;
