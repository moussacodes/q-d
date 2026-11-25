-- end_room: the host ends the room (docs/API_CONTRACTS.md § end_room).
--
-- Checks, in the contract's order: signed in, idempotency replay (answered
-- before the other checks, so retrying after success still succeeds), the room
-- exists and hasn't ended, the caller is its host. Then, in one transaction:
--   * the room is marked ended, which frees its code for new rooms (the unique
--     index only covers rooms that haven't ended) and expires it,
--   * playback is stopped,
--   * every invite still live is revoked,
--   * members get a room.ended broadcast and leave the room screen.
-- History (members, queue) is kept; the 90-day cleanup is a later card.
-- delete_account will call this as the user, before deleting the account.

create function public.end_room(room_id uuid, idempotency_key uuid) returns jsonb
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

  update public.rooms r
     set state = 'ended',
         ended_at = now(),
         code_expires_at = least(r.code_expires_at, now())
   where r.id = room.id
  returning * into room;

  update public.playback_states p
     set status = 'stopped', reported_at = now(), reported_by = uid
   where p.room_id = room.id;

  update public.room_invites i
     set revoked_at = now()
   where i.room_id = room.id and i.revoked_at is null;

  perform private.broadcast_room_event(room.id, 'room.ended');

  return private.idempotency_store(
    'end_room',
    end_room.idempotency_key,
    request,
    jsonb_build_object('room_id', room.id, 'ended_at', room.ended_at)
  );
end;
$$;

revoke execute on all functions in schema private from public;
revoke execute on function public.end_room(uuid, uuid) from public, anon;
grant execute on function public.end_room(uuid, uuid) to authenticated;
