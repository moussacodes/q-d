-- override_track_match: the host's "Wrong version?" correction
-- (docs/API_CONTRACTS.md § override_track_match, PRODUCT_SPEC.md §6 rule 8).
--
-- Checks, in the contract's order: signed in, idempotency replay, arguments,
-- the room (exists, not ended, locked), member, host, then the operation's own
-- rules: the provider is the one the room plays through, the recording has
-- been queued in this room, and the chosen track is a saved provider track on
-- that provider. Then it appends a track_match_overrides row (the table is the
-- audit trail; the newest row for room, recording and provider wins) and tells
-- the room's phones to refetch the queue.
--
-- An override is scoped to one room. It never changes track_matches, which
-- every room shares.

create function public.override_track_match(
  room_id uuid,
  recording_id uuid,
  provider public.music_provider,
  provider_track_id text,
  idempotency_key uuid
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  request jsonb := jsonb_build_object(
    'room_id', override_track_match.room_id,
    'recording_id', override_track_match.recording_id,
    'provider', override_track_match.provider,
    'provider_track_id', override_track_match.provider_track_id
  );
  stored jsonb;
  room public.rooms;
  latest public.track_match_overrides;
  created public.track_match_overrides;
begin
  stored := private.idempotency_replay(
    'override_track_match',
    override_track_match.idempotency_key,
    request
  );
  if stored is not null then
    return stored;
  end if;

  if override_track_match.room_id is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'room_id'));
  end if;
  if override_track_match.recording_id is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'recording_id'));
  end if;
  if override_track_match.provider is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'provider'));
  end if;
  if override_track_match.provider_track_id is null
     or char_length(override_track_match.provider_track_id) not between 1 and 200
     or override_track_match.provider_track_id <> btrim(override_track_match.provider_track_id) then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'provider_track_id'));
  end if;

  room := private.lock_room(override_track_match.room_id);
  perform private.require_host(room.id, uid);

  -- Only the service the host's phone plays through: that's the only one whose
  -- versions "Wrong version?" lists.
  if override_track_match.provider <> room.playback_provider then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'provider'));
  end if;

  -- The song has been in this room's queue (queued, playing, played or removed).
  if not exists (
    select 1 from public.queue_entries e
     where e.room_id = room.id and e.recording_id = override_track_match.recording_id
  ) then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'recording_id'));
  end if;

  -- The chosen version is a provider track q’d has saved. It needn't be among
  -- today's candidates: the host's choice always wins (DECISIONS 2026-11-24).
  if not exists (
    select 1 from public.provider_tracks t
     where t.provider = override_track_match.provider
       and t.provider_track_id = override_track_match.provider_track_id
  ) then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'provider_track_id'));
  end if;

  select * into latest
    from public.track_match_overrides o
   where o.room_id = room.id
     and o.recording_id = override_track_match.recording_id
     and o.provider = override_track_match.provider
   order by o.created_at desc, o.id desc
   limit 1;

  if found and latest.provider_track_id = override_track_match.provider_track_id then
    -- Already the host's pick: nothing changes, so no new audit row and no broadcast.
    created := latest;
  else
    insert into public.track_match_overrides (room_id, recording_id, provider, provider_track_id, created_by)
    values (
      room.id,
      override_track_match.recording_id,
      override_track_match.provider,
      override_track_match.provider_track_id,
      uid
    )
    returning * into created;
    -- Queue rows show each song's match, so their phones refetch the queue.
    perform private.broadcast_room_event(room.id, 'queue.changed');
  end if;

  return private.idempotency_store(
    'override_track_match',
    override_track_match.idempotency_key,
    request,
    jsonb_build_object(
      'override_id', created.id,
      'recording_id', created.recording_id,
      'provider', created.provider,
      'provider_track_id', created.provider_track_id,
      'created_at', created.created_at
    )
  );
end;
$$;

revoke execute on all functions in schema private from public;
revoke execute on function public.override_track_match(uuid, uuid, public.music_provider, text, uuid) from public, anon;
grant execute on function public.override_track_match(uuid, uuid, public.music_provider, text, uuid) to authenticated;
