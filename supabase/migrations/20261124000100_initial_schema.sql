-- q’d initial schema.
--
-- Tables from docs/ARCHITECTURE.md §5 and docs/PLAN.md §3 "Main database
-- entities", shaped like the domain types in docs/API_CONTRACTS.md §6.
--
-- Rules this file follows:
--   * Postgres is the source of truth. Clients never write room tables; the RPC
--     functions in later migrations do (ARCHITECTURE.md §4.10).
--   * Row level security is switched on for every table here, with no policies
--     yet, so everything is denied until the RLS migration opens reads.
--   * provider_connections holds metadata only. Provider tokens stay on the
--     device (ARCHITECTURE.md §4.11), so no column here stores a credential.
--   * The queue is batch-ready from the start (queue_entries.batch_id).

-- Types ----------------------------------------------------------------------

create type public.music_provider as enum ('apple_music', 'spotify');
create type public.playback_mode as enum ('aux', 'sync');
create type public.room_state as enum ('live', 'paused', 'ended');
create type public.room_audience as enum ('everyone', 'chosen', 'host');
create type public.room_rule as enum ('add_songs', 'control');
create type public.member_role as enum ('host', 'member');
create type public.queue_entry_status as enum ('queued', 'playing', 'played', 'removed');
create type public.playback_status as enum ('playing', 'paused', 'stopped', 'autoplay');
create type public.match_method as enum ('isrc', 'score', 'override');
create type public.match_warning as enum ('low_confidence', 'explicit_conflict');
create type public.slot_readiness as enum ('ready', 'catching_up', 'sitting_out');
create type public.import_batch_status as enum ('previewing', 'importing', 'done', 'undone', 'failed');
create type public.report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');

-- Shared trigger: keep updated_at current -----------------------------------

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Accounts -------------------------------------------------------------------

-- One row per auth user, created by a trigger when the auth user is created.
-- The profile is complete (onboarding step 1 done) once display_name and color
-- are set and adult_confirmed_at is stamped.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (
    display_name is null
    or (char_length(display_name) between 1 and 30 and display_name = btrim(display_name))
  ),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  adult_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Every new auth user gets an empty profile row to fill in during onboarding.
create function public.handle_new_auth_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Which services a user connected. Metadata only: tokens never reach Postgres.
create table public.provider_connections (
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider public.music_provider not null,
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz,
  -- Storefront / market such as 'us', used for catalog lookups. Not personal.
  storefront text check (storefront is null or storefront ~ '^[a-z]{2}$'),
  primary key (user_id, provider)
);

-- Rooms ----------------------------------------------------------------------

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40 and name = btrim(name)),
  -- Null after the host deletes their account (the room is ended first).
  host_id uuid references public.profiles (id) on delete set null,
  mode public.playback_mode not null default 'aux',
  state public.room_state not null default 'live',
  playback_provider public.music_provider not null,
  -- Six characters, uppercase. Shown as QD-XXXXXX.
  code text not null check (code ~ '^[A-Z0-9]{6}$'),
  code_expires_at timestamptz not null,
  add_songs public.room_audience not null default 'everyone',
  control public.room_audience not null default 'host',
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint rooms_ended_at_matches_state check ((state = 'ended') = (ended_at is not null))
);

-- A code belongs to at most one room that hasn't ended. Ended rooms free it.
create unique index rooms_code_active_key on public.rooms (code) where state <> 'ended';
create index rooms_host_id_idx on public.rooms (host_id);

create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- A room holds at most 15 signed-in participants, the host included
-- (PRODUCT_SPEC.md �4). Checked under a lock on the room row, so two joins at
-- the same moment can't both take the last place.
create function public.enforce_room_capacity() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  member_count integer;
begin
  perform 1 from public.rooms where id = new.room_id for update;
  select count(*) into member_count from public.room_members where room_id = new.room_id;
  if member_count >= 15 then
    raise exception using errcode = 'P0001', message = 'room_full';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_room_capacity() from public, anon, authenticated;

create trigger room_members_enforce_capacity
before insert on public.room_members
for each row execute function public.enforce_room_capacity();

create unique index room_members_one_host_key on public.room_members (room_id) where role = 'host';
create index room_members_user_id_idx on public.room_members (user_id);

-- The people the host chose for a rule set to 'chosen'. Kept while the rule is
-- switched to something else, so switching back restores the list.
create table public.room_rule_members (
  room_id uuid not null,
  rule public.room_rule not null,
  user_id uuid not null,
  chosen_at timestamptz not null default now(),
  primary key (room_id, rule, user_id),
  foreign key (room_id, user_id) references public.room_members (room_id, user_id) on delete cascade
);

-- QR invites. Only a hash of the high-entropy token is stored.
create table public.room_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint room_invites_expiry_after_creation check (expires_at > created_at)
);

-- A new invite replaces the old one, so a room has at most one live invite.
create unique index room_invites_one_active_key on public.room_invites (room_id) where revoked_at is null;

-- Catalog and matching -------------------------------------------------------

-- Canonical recordings (Apple's catalog is canonical).
create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  primary_artist text not null check (char_length(primary_artist) between 1 and 300),
  artists text[] not null default '{}',
  album text,
  duration_ms integer not null check (duration_ms > 0),
  isrc text check (isrc is null or isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
  explicit boolean not null default false,
  version_tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index recordings_isrc_idx on public.recordings (isrc) where isrc is not null;

-- One provider's version of a song.
create table public.provider_tracks (
  provider public.music_provider not null,
  provider_track_id text not null check (char_length(provider_track_id) between 1 and 200),
  title text not null,
  artists text[] not null default '{}',
  duration_ms integer not null check (duration_ms > 0),
  isrc text check (isrc is null or isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
  explicit boolean not null default false,
  -- Artwork is fetched from the provider at runtime and never bundled.
  artwork_url text,
  -- Apple only (see the provider artwork rule, ARCHITECTURE.md §4.2).
  artwork_background_color text check (
    artwork_background_color is null or artwork_background_color ~ '^#[0-9A-Fa-f]{6}$'
  ),
  fetched_at timestamptz not null default now(),
  primary key (provider, provider_track_id)
);

create index provider_tracks_isrc_idx on public.provider_tracks (isrc) where isrc is not null;

-- The link from a recording to a provider track. provider_track_id null means
-- the recording isn't available on that provider.
create table public.track_matches (
  recording_id uuid not null references public.recordings (id) on delete cascade,
  provider public.music_provider not null,
  provider_track_id text,
  confidence smallint not null check (confidence between 0 and 100),
  method public.match_method not null,
  warning public.match_warning,
  matched_at timestamptz not null default now(),
  primary key (recording_id, provider),
  foreign key (provider, provider_track_id) references public.provider_tracks (provider, provider_track_id)
);

-- "Wrong version?" corrections. Rows are never updated, so the table is the
-- audit trail; the newest row for (room, recording, provider) wins.
create table public.track_match_overrides (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  recording_id uuid not null references public.recordings (id) on delete cascade,
  provider public.music_provider not null,
  provider_track_id text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (provider, provider_track_id) references public.provider_tracks (provider, provider_track_id)
);

create index track_match_overrides_lookup_idx
  on public.track_match_overrides (room_id, recording_id, provider, created_at desc);

-- Queue ----------------------------------------------------------------------

-- Post-demo playlist imports (placeholder). Exists now so queue entries can
-- reference a batch without a schema redesign.
create table public.playlist_import_batches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  provider public.music_provider not null,
  source_name text not null check (char_length(source_name) between 1 and 300),
  item_count integer not null default 0 check (item_count between 0 and 50),
  added_count integer not null default 0 check (added_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  status public.import_batch_status not null default 'previewing',
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint playlist_import_batches_counts check (added_count + skipped_count <= item_count)
);

-- Only one import runs per room at a time.
create unique index playlist_import_batches_one_running_key
  on public.playlist_import_batches (room_id) where status = 'importing';

create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  recording_id uuid not null references public.recordings (id),
  -- Assigned by the server. Clients only sort by it.
  position bigint not null,
  -- Null after the person who added it deletes their account ("Deleted user").
  added_by uuid references public.profiles (id) on delete set null,
  batch_id uuid references public.playlist_import_batches (id) on delete set null,
  status public.queue_entry_status not null default 'queued',
  added_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now()
);

-- At most one entry plays per room.
create unique index queue_entries_one_playing_key on public.queue_entries (room_id) where status = 'playing';
create index queue_entries_room_order_idx on public.queue_entries (room_id, status, position);
create index queue_entries_batch_id_idx on public.queue_entries (batch_id) where batch_id is not null;
create index queue_entries_added_by_idx on public.queue_entries (added_by);

-- Playback -------------------------------------------------------------------

-- What the host's player is doing. One row per room, written by the host.
create table public.playback_states (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  entry_id uuid references public.queue_entries (id) on delete set null,
  status public.playback_status not null default 'stopped',
  position_ms integer not null default 0 check (position_ms >= 0),
  reported_at timestamptz not null default now(),
  reported_by uuid references public.profiles (id) on delete set null
);

-- sync (beta) playback slots. Slot 1 is always the host.
create table public.playback_slots (
  room_id uuid not null references public.rooms (id) on delete cascade,
  slot smallint not null check (slot between 1 and 15),
  user_id uuid not null,
  provider public.music_provider not null,
  readiness public.slot_readiness not null default 'catching_up',
  claimed_at timestamptz not null default now(),
  primary key (room_id, slot),
  unique (room_id, user_id),
  foreign key (room_id, user_id) references public.room_members (room_id, user_id) on delete cascade
);

-- Moderation (beta placeholders) --------------------------------------------

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  reported_user_id uuid references public.profiles (id) on delete set null,
  room_id uuid references public.rooms (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 100),
  details text check (details is null or char_length(details) <= 1000),
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index reports_status_idx on public.reports (status, created_at);

-- Analytics (opt-in, placeholder) ------------------------------------------

-- Keyed by an analytics identity, not the user id, and never holds provider or
-- song data (PRODUCT_SPEC.md §7). Kept for 90 days.
create table public.analytics_events (
  id bigint generated always as identity primary key,
  analytics_id uuid not null,
  name text not null check (name ~ '^[a-z][a-z0-9_.]{0,63}$'),
  properties jsonb not null default '{}' check (jsonb_typeof(properties) = 'object'),
  occurred_at timestamptz not null default now()
);

create index analytics_events_occurred_at_idx on public.analytics_events (occurred_at);

-- Idempotency ----------------------------------------------------------------

-- One row per successful mutation: (user, operation, key) → stored result.
-- The RPC foundation migration reads and writes it. Kept at least 24 hours.
create table public.idempotency_keys (
  user_id uuid not null,
  operation text not null check (operation ~ '^[a-z_]{1,64}$'),
  idempotency_key uuid not null,
  request_hash bytea not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  primary key (user_id, operation, idempotency_key)
);

create index idempotency_keys_expires_at_idx on public.idempotency_keys (expires_at);

-- Row level security: on everywhere, opened up by the RLS migration ---------

alter table public.profiles enable row level security;
alter table public.provider_connections enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_rule_members enable row level security;
alter table public.room_invites enable row level security;
alter table public.recordings enable row level security;
alter table public.provider_tracks enable row level security;
alter table public.track_matches enable row level security;
alter table public.track_match_overrides enable row level security;
alter table public.playlist_import_batches enable row level security;
alter table public.queue_entries enable row level security;
alter table public.playback_states enable row level security;
alter table public.playback_slots enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.analytics_events enable row level security;
alter table public.idempotency_keys enable row level security;
