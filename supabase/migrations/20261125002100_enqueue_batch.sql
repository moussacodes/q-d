-- enqueue_batch and undo_batch: playlist import's queue side
-- (docs/API_CONTRACTS.md § enqueue_batch, § undo_batch). Post-demo, behind
-- the `playlist_import` flag, which is off.
--
-- The queue is batch-ready from the start, so playlist import won't need a
-- redesign: entries carry batch_id, one import runs per room
-- (playlist_import_batches_one_running_key), and the same helper that adds a
-- single song adds each song of a batch.
--
-- The batch row itself comes from the import preview (post-demo card): it
-- reads the playlist, shows the preview and creates a `previewing` batch.
-- enqueue_batch then adds the confirmed songs and marks the batch `done`.

-- Feature flags ------------------------------------------------------------------

-- Server-side switches for features that are built but off. Only the database
-- owner changes them (a migration or the dashboard); API roles can't read or
-- write the table.
create table private.feature_flags (
  flag text primary key check (flag ~ '^[a-z_]{1,64}$'),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table private.feature_flags enable row level security;
revoke all on private.feature_flags from public, anon, authenticated;

insert into private.feature_flags (flag, enabled) values ('playlist_import', false);

create function private.require_feature(flag text) returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not coalesce(
    (select f.enabled from private.feature_flags f where f.flag = require_feature.flag),
    false
  ) then
    perform private.raise_error('feature_disabled', jsonb_build_object('flag', require_feature.flag));
  end if;
end;
$$;

-- Queue helpers ----------------------------------------------------------------

-- Renumbers the room's queued entries 1..n, keeping their order. Every RPC
-- that takes entries out of the middle (or moves them) calls it while holding
-- the room lock. Goes through negative numbers first, so the unique index on
-- queued positions never sees two rows with the same number.
create function private.renumber_queue(room_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.queue_entries e
     set position = -o.n
    from (
      select q.id, row_number() over (order by q.position, q.added_at, q.id) as n
        from public.queue_entries q
       where q.room_id = renumber_queue.room_id and q.status = 'queued'
    ) o
   where e.id = o.id;

  update public.queue_entries e
     set position = -e.position
   where e.room_id = renumber_queue.room_id and e.status = 'queued' and e.position < 0;
end;
$$;

-- enqueue_batch -------------------------------------------------------------------

create function private.batch_limit() returns integer
language sql immutable
set search_path = ''
as $$ select 50 $$;

create function public.enqueue_batch(
  room_id uuid,
  batch_id uuid,
  recording_ids uuid[],
  idempotency_key uuid
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  request jsonb := jsonb_build_object(
    'room_id', enqueue_batch.room_id,
    'batch_id', enqueue_batch.batch_id,
    'recording_ids', to_jsonb(enqueue_batch.recording_ids)
  );
  stored jsonb;
  room public.rooms;
  batch public.playlist_import_batches;
  rid uuid;
  added integer := 0;
  skipped integer := 0;
begin
  stored := private.idempotency_replay('enqueue_batch', enqueue_batch.idempotency_key, request);
  if stored is not null then
    return stored;
  end if;

  perform private.require_feature('playlist_import');

  if enqueue_batch.room_id is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'room_id'));
  end if;
  if enqueue_batch.batch_id is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'batch_id'));
  end if;
  if coalesce(cardinality(enqueue_batch.recording_ids), 0) = 0
     or array_position(enqueue_batch.recording_ids, null) is not null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'recording_ids'));
  end if;
  if cardinality(enqueue_batch.recording_ids) > private.batch_limit() then
    perform private.raise_error('limit_exceeded', jsonb_build_object('limit', private.batch_limit()));
  end if;

  room := private.lock_room(enqueue_batch.room_id);
  -- Permission follows the room's normal add-songs rule (PRODUCT_SPEC.md §8).
  perform private.require_allowed(room, uid, 'add_songs');

  select * into batch from public.playlist_import_batches b
   where b.id = enqueue_batch.batch_id and b.room_id = room.id and b.created_by = uid
   for update;
  if not found then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'batch_id'));
  end if;

  if exists (
    select 1 from public.playlist_import_batches b
     where b.room_id = room.id and b.status = 'importing'
  ) then
    perform private.raise_error('import_in_progress');
  end if;
  if batch.status <> 'previewing' then
    -- Already imported, undone or failed: the caller's view is old.
    perform private.raise_error('stale_state', jsonb_build_object('status', batch.status));
  end if;

  if exists (
    select 1 from unnest(enqueue_batch.recording_ids) as r(id)
     where not exists (select 1 from public.recordings x where x.id = r.id)
  ) then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'recording_ids'));
  end if;

  update public.playlist_import_batches b set status = 'importing' where b.id = batch.id;

  -- Playlist order. A batch can't ask "Already in queue" per song, so songs
  -- that are already queued or playing (or earlier in the same batch) are
  -- skipped and counted.
  foreach rid in array enqueue_batch.recording_ids loop
    if exists (
      select 1 from public.queue_entries e
       where e.room_id = room.id and e.recording_id = rid and e.status in ('playing', 'queued')
    ) then
      skipped := skipped + 1;
    else
      perform private.append_queue_entry(room.id, rid, uid, batch.id);
      added := added + 1;
    end if;
  end loop;

  update public.playlist_import_batches b
     set status = 'done',
         item_count = greatest(b.item_count, cardinality(enqueue_batch.recording_ids)),
         added_count = added,
         skipped_count = skipped,
         finished_at = now()
   where b.id = batch.id;

  -- One hint for the whole batch, not one per song.
  perform private.broadcast_room_event(room.id, 'queue.changed');

  return private.idempotency_store(
    'enqueue_batch',
    enqueue_batch.idempotency_key,
    request,
    jsonb_build_object('batch_id', batch.id, 'added', added, 'skipped', skipped)
  );
end;
$$;

-- undo_batch -----------------------------------------------------------------------

create function public.undo_batch(
  room_id uuid,
  batch_id uuid,
  idempotency_key uuid
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  request jsonb := jsonb_build_object(
    'room_id', undo_batch.room_id,
    'batch_id', undo_batch.batch_id
  );
  stored jsonb;
  room public.rooms;
  batch public.playlist_import_batches;
  removed integer;
begin
  stored := private.idempotency_replay('undo_batch', undo_batch.idempotency_key, request);
  if stored is not null then
    return stored;
  end if;

  perform private.require_feature('playlist_import');

  if undo_batch.room_id is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'room_id'));
  end if;
  if undo_batch.batch_id is null then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'batch_id'));
  end if;

  room := private.lock_room(undo_batch.room_id);
  perform private.require_host(room.id, uid);

  select * into batch from public.playlist_import_batches b
   where b.id = undo_batch.batch_id and b.room_id = room.id
   for update;
  if not found then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'batch_id'));
  end if;
  if batch.status <> 'done' then
    perform private.raise_error('stale_state', jsonb_build_object('status', batch.status));
  end if;

  -- Only songs still waiting: the playing one and played ones stay.
  with gone as (
    update public.queue_entries e
       set status = 'removed', status_changed_at = now()
     where e.room_id = room.id and e.batch_id = batch.id and e.status = 'queued'
    returning 1
  )
  select count(*)::integer into removed from gone;

  perform private.renumber_queue(room.id);
  update public.playlist_import_batches b set status = 'undone' where b.id = batch.id;
  perform private.broadcast_room_event(room.id, 'queue.changed');

  return private.idempotency_store(
    'undo_batch',
    undo_batch.idempotency_key,
    request,
    jsonb_build_object('batch_id', batch.id, 'removed', removed)
  );
end;
$$;

revoke execute on all functions in schema private from public;
revoke execute on function public.enqueue_batch(uuid, uuid, uuid[], uuid) from public, anon;
revoke execute on function public.undo_batch(uuid, uuid, uuid) from public, anon;
grant execute on function public.enqueue_batch(uuid, uuid, uuid[], uuid) to authenticated;
grant execute on function public.undo_batch(uuid, uuid, uuid) to authenticated;
