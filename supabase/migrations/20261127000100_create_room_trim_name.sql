-- create_room review fix: trim every kind of whitespace from the room name.
--
-- btrim() only strips spaces, so a name made of tabs, newlines or no-break
-- spaces counted as 1–40 characters and created a room with a blank name. The
-- app trims with JavaScript's String.prototype.trim(), so the server now
-- strips the same set: ASCII whitespace plus the Unicode space separators,
-- the line and paragraph separators and the BOM. Inner whitespace stays as
-- typed. Everything else in create_room is unchanged.

create function private.trim_room_name(name text) returns text
language sql immutable
set search_path = ''
as $$
  select regexp_replace(
    name,
    '^[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '',
    'g'
  )
$$;

create or replace function public.create_room(
  name text,
  playback_provider public.music_provider,
  idempotency_key uuid,
  add_songs public.room_audience default 'everyone',
  control public.room_audience default 'host',
  mode public.playback_mode default 'aux'
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  request jsonb := jsonb_build_object(
    'name', create_room.name,
    'playback_provider', create_room.playback_provider,
    'add_songs', create_room.add_songs,
    'control', create_room.control,
    'mode', create_room.mode
  );
  stored jsonb;
  room_name text := private.trim_room_name(create_room.name);
  new_room public.rooms;
  attempts integer := 0;
begin
  stored := private.idempotency_replay('create_room', create_room.idempotency_key, request);
  if stored is not null then
    return stored;
  end if;

  perform private.require_complete_profile(uid);

  if create_room.mode is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'mode'));
  end if;
  if create_room.mode <> 'aux' then
    perform private.raise_error('feature_disabled', jsonb_build_object('flag', 'sync'));
  end if;
  if room_name is null or char_length(room_name) not between 1 and 40 then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'name'));
  end if;
  if create_room.playback_provider is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'playback_provider'));
  end if;
  if create_room.add_songs is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'add_songs'));
  end if;
  if create_room.control is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'control'));
  end if;

  -- Hosting needs a connected service: the host's phone plays the music.
  if not exists (
    select 1 from public.provider_connections c
     where c.user_id = uid and c.provider = create_room.playback_provider
  ) then
    perform private.raise_error(
      'provider_required',
      jsonb_build_object('provider', create_room.playback_provider)
    );
  end if;

  -- A code is unique among rooms that haven't ended. Retry on the rare collision.
  loop
    attempts := attempts + 1;
    begin
      insert into public.rooms (name, host_id, mode, playback_provider, code, code_expires_at, add_songs, control)
      values (
        room_name,
        uid,
        'aux',
        create_room.playback_provider,
        private.generate_room_code(),
        now() + private.room_code_lifetime(),
        create_room.add_songs,
        create_room.control
      )
      returning * into new_room;
      exit;
    exception when unique_violation then
      if attempts >= 10 then
        raise exception 'could not generate a unique room code';
      end if;
    end;
  end loop;

  -- The host is the first member. Nobody is chosen yet (DECISIONS 2026-11-20).
  insert into public.room_members (room_id, user_id, role) values (new_room.id, uid, 'host');
  insert into public.playback_states (room_id, status, reported_by) values (new_room.id, 'stopped', uid);

  return private.idempotency_store(
    'create_room',
    create_room.idempotency_key,
    request,
    jsonb_build_object(
      'room_id', new_room.id,
      'code', new_room.code,
      'code_expires_at', new_room.code_expires_at
    )
  );
end;
$$;

revoke execute on all functions in schema private from public;
revoke execute on function public.create_room(text, public.music_provider, uuid, public.room_audience, public.room_audience, public.playback_mode) from public, anon;
grant execute on function public.create_room(text, public.music_provider, uuid, public.room_audience, public.room_audience, public.playback_mode) to authenticated;
