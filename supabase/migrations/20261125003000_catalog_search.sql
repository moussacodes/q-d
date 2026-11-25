-- Canonical catalog search (Apple catalog).
-- Contract: docs/API_CONTRACTS.md § Catalog, `catalog-search` (Edge Function).
--
-- The catalog-search Edge Function searches Apple's catalog with a developer
-- token it holds, then calls public.save_catalog_tracks() with the service
-- role to store each song as a canonical recording plus its Apple provider
-- track. Apple's catalog is canonical (PRODUCT_SPEC.md §6), so one recording
-- exists per Apple song id, found again by (source_provider, source_track_id).
-- Mappings to the host's provider (track_matches) are resolved later, when
-- playback needs them, so nothing here writes track_matches.
--
-- public.consume_catalog_search() is the per-user search limit the function
-- checks before it calls Apple. Both functions are callable by the service
-- role only: clients search through the Edge Function.

-- Schema ----------------------------------------------------------------------

-- Matching scores album context (API_CONTRACTS.md §6 ProviderTrack.album).
alter table public.provider_tracks
  add column album text check (album is null or char_length(album) between 1 and 300);

-- Where a canonical recording came from. Both null for a recording made some
-- other way; both set for one saved from a catalog search.
alter table public.recordings
  add column source_provider public.music_provider,
  add column source_track_id text,
  add column updated_at timestamptz not null default now(),
  add constraint recordings_source_pair
    check ((source_provider is null) = (source_track_id is null)),
  add constraint recordings_source_key unique (source_provider, source_track_id),
  add constraint recordings_source_track_fk foreign key (source_provider, source_track_id)
    references public.provider_tracks (provider, provider_track_id);

-- Searches per user per minute. One row per user; the window restarts when it
-- runs out. Private: no API role can read or write it.
create table private.catalog_search_usage (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null,
  count integer not null check (count >= 0)
);

-- Error codes ----------------------------------------------------------------

-- Adds provider_unavailable (API_CONTRACTS.md §2): the music service couldn't
-- answer (unreachable, timed out, misconfigured or an unexpected response).
-- Edge Functions answer with it; the list has to match the contract table.
create or replace function private.error_codes() returns text[]
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
    'provider_unavailable',
    'already_in_queue',
    'entry_not_found',
    'stale_state',
    'import_in_progress',
    'limit_exceeded',
    'idempotency_conflict',
    'feature_disabled'
  ]
$$;

-- Search limit ---------------------------------------------------------------

-- 60 searches a minute is one per second of typing, which the app's debounce
-- stays well under. Apple's own limit is per developer token, shared by
-- everyone, so one person can't use it up for the rest.
create function public.consume_catalog_search(user_id uuid, per_minute integer default 60)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_usage private.catalog_search_usage;
begin
  if consume_catalog_search.user_id is null then
    perform private.raise_error('not_authenticated');
  end if;
  if per_minute is null or per_minute < 1 then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'per_minute'));
  end if;

  insert into private.catalog_search_usage as u (user_id, window_started_at, count)
  values (consume_catalog_search.user_id, now(), 1)
  on conflict on constraint catalog_search_usage_pkey do update
     set window_started_at = case
           when u.window_started_at <= now() - interval '1 minute' then now()
           else u.window_started_at
         end,
         count = case
           when u.window_started_at <= now() - interval '1 minute' then 1
           else u.count + 1
         end
  returning * into current_usage;

  if current_usage.count > per_minute then
    perform private.raise_error(
      'rate_limited',
      jsonb_build_object(
        'retry_after_seconds',
        greatest(1, ceil(extract(epoch from (current_usage.window_started_at + interval '1 minute' - now())))::integer)
      )
    );
  end if;
end;
$$;

-- Saving search results ----------------------------------------------------------

-- Saves Apple catalog songs as provider tracks and canonical recordings and
-- returns [{ provider_track_id, recording_id }] in input order. Idempotent: the
-- same song saved again keeps its recording id and refreshes its metadata.
-- `tracks` is a JSON array (at most 25) of
--   { provider_track_id, title, artists[], album, duration_ms, isrc, explicit,
--     artwork_url, artwork_background_color, version_tags[] }
-- with provider 'apple_music'. A bad element fails the whole call with
-- invalid_input and `details.field` / `details.index`, and nothing is saved.
create function public.save_catalog_tracks(tracks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  idx integer := 0;
  saved jsonb := '[]'::jsonb;
  track_id text;
  title text;
  artists text[];
  album text;
  duration_ms integer;
  isrc text;
  explicit boolean;
  artwork_url text;
  artwork_color text;
  version_tags text[];
  recording_id uuid;
begin
  if tracks is null or jsonb_typeof(tracks) <> 'array' then
    perform private.raise_error('invalid_input', jsonb_build_object('field', 'tracks'));
  end if;
  if jsonb_array_length(tracks) > 25 then
    perform private.raise_error('limit_exceeded', jsonb_build_object('field', 'tracks', 'max', 25));
  end if;

  for item in select value from jsonb_array_elements(tracks) loop
    begin
      if jsonb_typeof(item) is distinct from 'object'
         or jsonb_typeof(item -> 'artists') is distinct from 'array'
         or jsonb_typeof(item -> 'version_tags') is distinct from 'array'
         or jsonb_typeof(item -> 'explicit') is distinct from 'boolean'
         or jsonb_typeof(item -> 'duration_ms') is distinct from 'number' then
        raise exception using errcode = '22023', message = 'shape';
      end if;
      track_id := item ->> 'provider_track_id';
      title := btrim(item ->> 'title');
      artists := array(select btrim(a) from jsonb_array_elements_text(item -> 'artists') a);
      album := nullif(btrim(coalesce(item ->> 'album', '')), '');
      duration_ms := (item ->> 'duration_ms')::integer;
      isrc := item ->> 'isrc';
      explicit := (item ->> 'explicit')::boolean;
      artwork_url := item ->> 'artwork_url';
      artwork_color := item ->> 'artwork_background_color';
      version_tags := array(select jsonb_array_elements_text(item -> 'version_tags'));
    exception when others then
      perform private.raise_error('invalid_input', jsonb_build_object('field', 'tracks', 'index', idx));
    end;

    if track_id is null or track_id !~ '^[0-9]{1,30}$'
       or title is null or char_length(title) not between 1 and 300
       or cardinality(artists) < 1
       or exists (select 1 from unnest(artists) a where char_length(a) not between 1 and 300)
       or (album is not null and char_length(album) > 300)
       or duration_ms is null or duration_ms < 1
       or (isrc is not null and isrc !~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$')
       or (artwork_url is not null and (artwork_url !~ '^https://' or char_length(artwork_url) > 2000))
       or (artwork_color is not null and artwork_color !~ '^#[0-9A-Fa-f]{6}$')
       or exists (select 1 from unnest(version_tags) t where t !~ '^[a-z][a-z0-9_]*$') then
      perform private.raise_error('invalid_input', jsonb_build_object('field', 'tracks', 'index', idx));
    end if;

    insert into public.provider_tracks as p (
      provider, provider_track_id, title, artists, album, duration_ms, isrc, explicit,
      artwork_url, artwork_background_color, fetched_at
    ) values (
      'apple_music', track_id, title, artists, album, duration_ms, isrc, explicit,
      artwork_url, artwork_color, now()
    )
    on conflict (provider, provider_track_id) do update
       set title = excluded.title,
           artists = excluded.artists,
           album = excluded.album,
           duration_ms = excluded.duration_ms,
           isrc = excluded.isrc,
           explicit = excluded.explicit,
           artwork_url = excluded.artwork_url,
           artwork_background_color = excluded.artwork_background_color,
           fetched_at = excluded.fetched_at;

    insert into public.recordings as r (
      title, primary_artist, artists, album, duration_ms, isrc, explicit, version_tags,
      source_provider, source_track_id
    ) values (
      title, artists[1], artists, album, duration_ms, isrc, explicit, version_tags,
      'apple_music', track_id
    )
    on conflict on constraint recordings_source_key do update
       set title = excluded.title,
           primary_artist = excluded.primary_artist,
           artists = excluded.artists,
           album = excluded.album,
           duration_ms = excluded.duration_ms,
           isrc = excluded.isrc,
           explicit = excluded.explicit,
           version_tags = excluded.version_tags,
           updated_at = now()
    returning r.id into recording_id;

    saved := saved || jsonb_build_array(
      jsonb_build_object('provider_track_id', track_id, 'recording_id', recording_id)
    );
    idx := idx + 1;
  end loop;

  return saved;
end;
$$;

-- Grants ------------------------------------------------------------------------

revoke all on private.catalog_search_usage from public;
revoke execute on all functions in schema private from public;
revoke execute on function public.consume_catalog_search(uuid, integer) from public, anon, authenticated;
revoke execute on function public.save_catalog_tracks(jsonb) from public, anon, authenticated;
grant execute on function public.consume_catalog_search(uuid, integer) to service_role;
grant execute on function public.save_catalog_tracks(jsonb) to service_role;
