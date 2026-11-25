-- reorder_queue and remove_queue_entry (docs/API_CONTRACTS.md § reorder_queue,
-- § remove_queue_entry).
--
-- Who may: the room's control rule (Everyone / Chosen / Only you) governs both
-- (DECISIONS 2026-11-20, "Room rules the host chooses"). The person who added
-- an entry may also remove it while it's still queued, for the Undo on the
-- "added" toast (DECISIONS 2026-11-24, "RPC contracts").
--
-- Both run under the room lock and keep queued positions dense (1..n), the
-- representation decided in the enqueue_recording migration. Retries are safe:
-- a replay returns the stored result, and a new request against an entry that
-- already moved on fails with entry_not_found or stale_state instead of acting
-- twice.

-- The entry the caller named, in this room. Raises entry_not_found when it
-- doesn't exist here or was removed or played, and stale_state when it's
-- playing now (the caller still saw it waiting). Locks the row.
create function private.require_queued_entry(room_id uuid, entry_id uuid, field text)
returns public.queue_entries
language plpgsql
set search_path = ''
as $$
declare
  entry public.queue_entries;
begin
  select * into entry from public.queue_entries e
   where e.id = require_queued_entry.entry_id and e.room_id = require_queued_entry.room_id
   for update;
  if not found or entry.status in ('removed', 'played') then
    perform private.raise_error('entry_not_found', jsonb_build_object('field', field));
  end if;
  if entry.status = 'playing' then
    perform private.raise_error('stale_state', jsonb_build_object('field', field, 'status', entry.status));
  end if;
  return entry;
end;
$$;

-- reorder_queue -----------------------------------------------------------------

create function public.reorder_queue(
  room_id uuid,
  entry_id uuid,
  after_entry_id uuid,
  idempotency_key uuid
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  request jsonb := jsonb_build_object(
    'room_id', reorder_queue.room_id,
    'entry_id', reorder_queue.entry_id,
    'after_entry_id', reorder_queue.after_entry_id
  );
  stored jsonb;
  room public.rooms;
  moving public.queue_entries;
  anchor public.queue_entries;
  -- The anchor's position: 0 means "to the top".
  after_position bigint := 0;
  target bigint;
begin
  stored := private.idempotency_replay('reorder_queue', reorder_queue.idempotency_key, request);
  if stored is not null then
    return stored;
  end if;

  if reorder_queue.room_id is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'room_id'));
  end if;
  if reorder_queue.entry_id is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'entry_id'));
  end if;
  if reorder_queue.after_entry_id = reorder_queue.entry_id then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'after_entry_id'));
  end if;

  room := private.lock_room(reorder_queue.room_id);
  perform private.require_allowed(room, uid, 'control');

  moving := private.require_queued_entry(room.id, reorder_queue.entry_id, 'entry_id');

  if reorder_queue.after_entry_id is not null then
    select * into anchor from public.queue_entries e
     where e.id = reorder_queue.after_entry_id and e.room_id = room.id;
    if not found then
      perform private.raise_error('entry_not_found', jsonb_build_object('field', 'after_entry_id'));
    end if;
    if anchor.status in ('removed', 'played') then
      -- The song it was meant to follow is gone: the caller's view is old.
      perform private.raise_error(
        'stale_state',
        jsonb_build_object('field', 'after_entry_id', 'status', anchor.status)
      );
    end if;
    -- After the playing song is the top of the queue.
    if anchor.status = 'queued' then
      after_position := anchor.position;
    end if;
  end if;

  target := case when moving.position > after_position then after_position + 1 else after_position end;

  if target <> moving.position then
    -- Shift the entries in between by one and place the moving one. Goes
    -- through negative numbers so the unique index on queued positions never
    -- sees two rows with the same number.
    update public.queue_entries e
       set position = -(case
         when e.id = moving.id then target
         when moving.position > target and e.position between target and moving.position - 1
           then e.position + 1
         when moving.position < target and e.position between moving.position + 1 and target
           then e.position - 1
         else e.position
       end)
     where e.room_id = room.id and e.status = 'queued';

    update public.queue_entries e
       set position = -e.position
     where e.room_id = room.id and e.status = 'queued' and e.position < 0;

    perform private.broadcast_room_event(room.id, 'queue.changed');
  end if;

  return private.idempotency_store(
    'reorder_queue',
    reorder_queue.idempotency_key,
    request,
    jsonb_build_object(
      'entry_id', moving.id,
      'position', target,
      'queue_length', private.queued_count(room.id)
    )
  );
end;
$$;

-- remove_queue_entry ---------------------------------------------------------------

create function public.remove_queue_entry(
  room_id uuid,
  entry_id uuid,
  idempotency_key uuid
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  request jsonb := jsonb_build_object(
    'room_id', remove_queue_entry.room_id,
    'entry_id', remove_queue_entry.entry_id
  );
  stored jsonb;
  room public.rooms;
  entry public.queue_entries;
begin
  stored := private.idempotency_replay('remove_queue_entry', remove_queue_entry.idempotency_key, request);
  if stored is not null then
    return stored;
  end if;

  if remove_queue_entry.room_id is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'room_id'));
  end if;
  if remove_queue_entry.entry_id is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'entry_id'));
  end if;

  room := private.lock_room(remove_queue_entry.room_id);
  perform private.require_member(room.id, uid);

  -- Whether the caller may depends on who added the entry, so find it first.
  entry := private.require_queued_entry(room.id, remove_queue_entry.entry_id, 'entry_id');

  if not private.is_allowed(room, uid, 'control') and entry.added_by is distinct from uid then
    perform private.raise_error('not_allowed');
  end if;

  update public.queue_entries e
     set status = 'removed', status_changed_at = now()
   where e.id = entry.id;
  perform private.renumber_queue(room.id);
  perform private.broadcast_room_event(room.id, 'queue.changed');

  return private.idempotency_store(
    'remove_queue_entry',
    remove_queue_entry.idempotency_key,
    request,
    jsonb_build_object('entry_id', entry.id, 'queue_length', private.queued_count(room.id))
  );
end;
$$;

revoke execute on all functions in schema private from public;
revoke execute on function public.reorder_queue(uuid, uuid, uuid, uuid) from public, anon;
revoke execute on function public.remove_queue_entry(uuid, uuid, uuid) from public, anon;
grant execute on function public.reorder_queue(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.remove_queue_entry(uuid, uuid, uuid) to authenticated;
