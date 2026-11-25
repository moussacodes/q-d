-- enqueue_recording: a member adds a song to the room's queue
-- (docs/API_CONTRACTS.md § enqueue_recording).
--
-- Queue positions (ARCHITECTURE.md open decision 3, decided here):
--   * Queued entries hold dense integer positions 1..n in play order. The
--     playing entry holds 0. Played and removed entries keep their last
--     position, which nothing reads.
--   * Only the server writes positions, always while holding the room lock
--     (private.lock_room), so two people adding at the same moment get one
--     authoritative order: whoever takes the lock first is first in line.
--   * A unique index on (room_id, position) for queued entries makes a
--     duplicate position impossible even if a later RPC gets it wrong.
--
-- Checks, in the contract's order: signed in, idempotency replay, arguments,
-- room exists and isn't ended (locks it), member, the add-songs rule, the
-- recording exists, already in the queue. Then it appends the entry, sends
-- queue.changed from inside the transaction and stores the result.

create unique index queue_entries_queued_position_key
  on public.queue_entries (room_id, position) where status = 'queued';

-- Queue helpers ----------------------------------------------------------------

-- How many entries wait to play (the playing one isn't counted).
create function private.queued_count(room_id uuid) returns integer
language sql stable
set search_path = ''
as $$
  select count(*)::integer from public.queue_entries e
   where e.room_id = queued_count.room_id and e.status = 'queued'
$$;

-- Adds one entry at the end of the queue. With nothing playing, the entry
-- plays at once instead (DECISIONS 2026-11-24: adding to an empty room starts
-- that song). The caller must hold the room lock.
create function private.append_queue_entry(
  room_id uuid,
  recording_id uuid,
  added_by uuid,
  batch_id uuid default null
) returns public.queue_entries
language plpgsql
set search_path = ''
as $$
declare
  entry public.queue_entries;
begin
  if not exists (
    select 1 from public.queue_entries e
     where e.room_id = append_queue_entry.room_id and e.status = 'playing'
  ) then
    insert into public.queue_entries (room_id, recording_id, position, added_by, batch_id, status)
    values (
      append_queue_entry.room_id,
      append_queue_entry.recording_id,
      0,
      append_queue_entry.added_by,
      append_queue_entry.batch_id,
      'playing'
    )
    returning * into entry;
    return entry;
  end if;

  insert into public.queue_entries (room_id, recording_id, position, added_by, batch_id, status)
  values (
    append_queue_entry.room_id,
    append_queue_entry.recording_id,
    coalesce(
      (select max(e.position) from public.queue_entries e
        where e.room_id = append_queue_entry.room_id and e.status = 'queued'),
      0
    ) + 1,
    append_queue_entry.added_by,
    append_queue_entry.batch_id,
    'queued'
  )
  returning * into entry;
  return entry;
end;
$$;

-- enqueue_recording --------------------------------------------------------------

create function public.enqueue_recording(
  room_id uuid,
  recording_id uuid,
  idempotency_key uuid,
  allow_duplicate boolean default false
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  request jsonb := jsonb_build_object(
    'room_id', enqueue_recording.room_id,
    'recording_id', enqueue_recording.recording_id,
    'allow_duplicate', enqueue_recording.allow_duplicate
  );
  stored jsonb;
  room public.rooms;
  present public.queue_entry_status;
  entry public.queue_entries;
begin
  stored := private.idempotency_replay('enqueue_recording', enqueue_recording.idempotency_key, request);
  if stored is not null then
    return stored;
  end if;

  if enqueue_recording.room_id is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'room_id'));
  end if;
  if enqueue_recording.recording_id is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'recording_id'));
  end if;
  if enqueue_recording.allow_duplicate is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'allow_duplicate'));
  end if;

  room := private.lock_room(enqueue_recording.room_id);
  perform private.require_allowed(room, uid, 'add_songs');

  if not exists (select 1 from public.recordings r where r.id = enqueue_recording.recording_id) then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'recording_id'));
  end if;

  -- "Already in queue" asks first (PRODUCT_SPEC.md §5). A song counts while
  -- it's queued or playing; details.status tells the app which question to ask.
  if not enqueue_recording.allow_duplicate then
    select e.status into present
      from public.queue_entries e
     where e.room_id = room.id
       and e.recording_id = enqueue_recording.recording_id
       and e.status in ('playing', 'queued')
     order by (e.status = 'playing') desc
     limit 1;
    if found then
      perform private.raise_error('already_in_queue', jsonb_build_object('status', present));
    end if;
  end if;

  entry := private.append_queue_entry(room.id, enqueue_recording.recording_id, uid);
  perform private.broadcast_room_event(room.id, 'queue.changed');

  return private.idempotency_store(
    'enqueue_recording',
    enqueue_recording.idempotency_key,
    request,
    jsonb_build_object(
      'entry_id', entry.id,
      'position', entry.position,
      'queue_length', private.queued_count(room.id)
    )
  );
end;
$$;

revoke execute on all functions in schema private from public;
revoke execute on function public.enqueue_recording(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.enqueue_recording(uuid, uuid, uuid, boolean) to authenticated;
