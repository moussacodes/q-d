-- QR invitations (docs/API_CONTRACTS.md § create_room_invite, § join_room_by_invite
-- and § 7). A QR invite carries its own high-entropy token, never the short
-- room code, so neither can be worked out from the other.
--
-- * The token is 32 bytes from two version 4 UUIDs (244 random bits), written
--   as 43 URL-safe base64 characters. Only its SHA-256 hash is stored
--   (room_invites.token_hash); the token itself exists only in the response.
-- * Only the host creates an invite. A new one replaces (revokes) the old one,
--   so a room has at most one live invite. It works for 24 hours.
-- * Joining by invite follows join_room_by_code: sign-in, replay, finished
--   profile, attempt limits, then the lookup. A token that matches nothing is
--   counted like a wrong code and kept through private.error_response().

-- Tokens -----------------------------------------------------------------------------

create function private.generate_invite_token() returns text
language sql volatile
set search_path = ''
as $$
  -- uuid_send gives 16 bytes per UUID; gen_random_uuid() draws them from the
  -- server's strong random source. base64url, no padding: 43 characters.
  select rtrim(
    translate(
      encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'),
      '+/',
      '-_'
    ),
    '='
  )
$$;

create function private.invite_token_hash(token text) returns bytea
language sql immutable
set search_path = ''
as $$ select sha256(convert_to(token, 'UTF8')) $$;

-- How long a QR invite works (DECISIONS 2026-11-25 · QR invitations).
create function private.invite_lifetime() returns interval
language sql immutable
set search_path = ''
as $$ select interval '24 hours' $$;

-- create_room_invite -------------------------------------------------------------------

-- The idempotency result keeps the invite's id and expiry, never the token, so
-- the database holds no usable token. A replay (the response was lost, so the
-- app retries with the same key) gives the same invite a fresh token: same
-- invite, same expiry, and the token nobody received stops working. If that
-- invite is no longer live (replaced, expired or its room ended), the key
-- counts as new and goes through every check.
create function public.create_room_invite(room_id uuid, idempotency_key uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  request jsonb := jsonb_build_object('room_id', create_room_invite.room_id);
  stored jsonb;
  room public.rooms;
  token text := private.generate_invite_token();
  invite public.room_invites;
begin
  stored := private.idempotency_replay('create_room_invite', create_room_invite.idempotency_key, request);
  if stored is not null then
    update public.room_invites i
       set token_hash = private.invite_token_hash(token)
     where i.id = (stored ->> 'invite_id')::uuid
       and i.revoked_at is null
       and i.expires_at > now()
       and exists (select 1 from public.rooms r where r.id = i.room_id and r.state <> 'ended')
    returning * into invite;
    if found then
      return jsonb_build_object('token', token, 'expires_at', invite.expires_at);
    end if;
    delete from public.idempotency_keys k
     where k.user_id = uid and k.operation = 'create_room_invite'
       and k.idempotency_key = create_room_invite.idempotency_key;
  end if;

  room := private.lock_room(create_room_invite.room_id);
  perform private.require_host(room.id, uid);

  update public.room_invites i set revoked_at = now()
   where i.room_id = room.id and i.revoked_at is null;

  insert into public.room_invites (room_id, token_hash, created_by, expires_at)
  values (room.id, private.invite_token_hash(token), uid, now() + private.invite_lifetime())
  returning * into invite;

  perform private.idempotency_store(
    'create_room_invite',
    create_room_invite.idempotency_key,
    request,
    jsonb_build_object('invite_id', invite.id, 'expires_at', invite.expires_at)
  );
  return jsonb_build_object('token', token, 'expires_at', invite.expires_at);
end;
$$;

-- join_room_by_invite --------------------------------------------------------------------

create function public.join_room_by_invite(token text, idempotency_key uuid) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  hashed bytea := private.invite_token_hash(coalesce(join_room_by_invite.token, ''));
  -- Only a hash of the token reaches the idempotency table.
  request jsonb := jsonb_build_object('token_hash', encode(hashed, 'hex'));
  stored jsonb;
  ip_hash bytea := private.request_ip_hash();
  invite public.room_invites;
begin
  stored := private.idempotency_replay('join_room_by_invite', join_room_by_invite.idempotency_key, request);
  if stored is not null then
    return stored;
  end if;

  perform private.require_complete_profile(uid);
  perform private.check_join_attempts('invite', uid, ip_hash);

  -- Not shaped like a token: it can't match one, so it isn't counted.
  if join_room_by_invite.token is null or join_room_by_invite.token !~ '^[A-Za-z0-9_-]{43}$' then
    return private.error_response('invite_invalid');
  end if;

  select * into invite from public.room_invites i where i.token_hash = hashed;
  if not found then
    perform private.record_join_failure('invite', uid, ip_hash);
    return private.error_response('invite_invalid');
  end if;

  -- A real token: say so if the room ended (its invites were revoked with it),
  -- otherwise the invite must still be live. Neither is a guess, so neither is
  -- counted.
  perform private.lock_room(invite.room_id);
  select * into invite from public.room_invites i where i.id = invite.id;
  if invite.revoked_at is not null or invite.expires_at <= now() then
    perform private.raise_error('invite_invalid');
  end if;

  perform private.join_room(invite.room_id, uid);

  return private.idempotency_store(
    'join_room_by_invite',
    join_room_by_invite.idempotency_key,
    request,
    jsonb_build_object('room_id', invite.room_id)
  );
end;
$$;

revoke execute on all functions in schema private from public;
revoke execute on function public.create_room_invite(uuid, uuid) from public, anon;
grant execute on function public.create_room_invite(uuid, uuid) to authenticated;
revoke execute on function public.join_room_by_invite(text, uuid) from public, anon;
grant execute on function public.join_room_by_invite(text, uuid) to authenticated;
