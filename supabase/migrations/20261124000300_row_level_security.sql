-- Row level security for rooms, queues and everything around them.
--
-- The principle (ARCHITECTURE.md §5 and §4.10): a signed-in user reads a room's
-- data only while they're a member. Nobody inserts into, updates or deletes
-- from room tables directly; writes go through the security-definer RPCs, which
-- run their own checks. So:
--   * every table already has RLS on (initial schema); this adds read policies,
--   * API roles lose insert/update/delete on room, catalog and system tables,
--     so a direct write fails with permission denied instead of silently
--     touching nothing,
--   * anon gets nothing at all,
--   * a user edits their own profile and their own connection metadata, and
--     manages their own blocks, directly.

-- Policy helpers ---------------------------------------------------------------
-- Security definer, so a policy on room_members can ask about room_members
-- without recursing into its own policy. They only ever look at auth.uid().

create function private.is_room_member(room_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
     where m.room_id = is_room_member.room_id and m.user_id = auth.uid()
  )
$$;

create function private.is_room_host(room_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
     where m.room_id = is_room_host.room_id and m.user_id = auth.uid() and m.role = 'host'
  )
$$;

-- Whether the caller and another user are in a room together, so members can
-- see each other's display name and color.
create function private.shares_room_with(user_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.room_members mine
      join public.room_members theirs on theirs.room_id = mine.room_id
     where mine.user_id = auth.uid() and theirs.user_id = shares_room_with.user_id
  )
$$;

-- Realtime Authorization: only members may join a room's private channel.
create function private.can_use_room_topic(topic text) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if topic is null or topic !~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.is_room_member(substr(topic, 6)::uuid);
end;
$$;

-- New functions are executable by PUBLIC by default. Take that back, then
-- grant only these helpers (and usage on the schema) to signed-in users, whose
-- policies call them.
revoke execute on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.is_room_member(uuid) to authenticated;
grant execute on function private.is_room_host(uuid) to authenticated;
grant execute on function private.shares_room_with(uuid) to authenticated;
grant execute on function private.can_use_room_topic(text) to authenticated;

-- Grants -------------------------------------------------------------------------

-- anon reads and writes nothing.
revoke all on all tables in schema public from anon;

-- Signed-in users only read, except where a policy below says otherwise.
revoke insert, update, delete, truncate on all tables in schema public from authenticated;

-- Own profile: only the onboarding fields.
grant update (display_name, color, adult_confirmed_at) on public.profiles to authenticated;

-- Own connection metadata. Tokens never come here (no column holds one).
grant insert (user_id, provider, last_verified_at, storefront) on public.provider_connections to authenticated;
grant update (last_verified_at, storefront) on public.provider_connections to authenticated;
grant delete on public.provider_connections to authenticated;

-- Own blocks.
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;
grant delete on public.blocks to authenticated;

-- Never readable by clients.
revoke select on public.idempotency_keys from authenticated;
revoke select on public.analytics_events from authenticated;

-- Accounts -----------------------------------------------------------------------

create policy profiles_select_self_or_roommate on public.profiles
for select to authenticated
using (id = (select auth.uid()) or private.shares_room_with(id));

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy provider_connections_select_own on public.provider_connections
for select to authenticated
using (user_id = (select auth.uid()));

create policy provider_connections_insert_own on public.provider_connections
for insert to authenticated
with check (user_id = (select auth.uid()));

create policy provider_connections_update_own on public.provider_connections
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy provider_connections_delete_own on public.provider_connections
for delete to authenticated
using (user_id = (select auth.uid()));

-- Rooms --------------------------------------------------------------------------

create policy rooms_select_member on public.rooms
for select to authenticated
using (private.is_room_member(id));

create policy room_members_select_member on public.room_members
for select to authenticated
using (private.is_room_member(room_id));

create policy room_rule_members_select_member on public.room_rule_members
for select to authenticated
using (private.is_room_member(room_id));

-- Only the host sees the invite row (its expiry). It holds a hash, never the token.
create policy room_invites_select_host on public.room_invites
for select to authenticated
using (private.is_room_host(room_id));

-- Queue and playback ---------------------------------------------------------------

create policy queue_entries_select_member on public.queue_entries
for select to authenticated
using (private.is_room_member(room_id));

create policy playback_states_select_member on public.playback_states
for select to authenticated
using (private.is_room_member(room_id));

create policy playback_slots_select_member on public.playback_slots
for select to authenticated
using (private.is_room_member(room_id));

create policy playlist_import_batches_select_member on public.playlist_import_batches
for select to authenticated
using (private.is_room_member(room_id));

create policy track_match_overrides_select_member on public.track_match_overrides
for select to authenticated
using (private.is_room_member(room_id));

-- Catalog: shared by everyone signed in. Written by RPCs and Edge Functions.

create policy recordings_select_signed_in on public.recordings
for select to authenticated
using (true);

create policy provider_tracks_select_signed_in on public.provider_tracks
for select to authenticated
using (true);

create policy track_matches_select_signed_in on public.track_matches
for select to authenticated
using (true);

-- Moderation -----------------------------------------------------------------------

create policy blocks_select_own on public.blocks
for select to authenticated
using (blocker_id = (select auth.uid()));

create policy blocks_insert_own on public.blocks
for insert to authenticated
with check (blocker_id = (select auth.uid()));

create policy blocks_delete_own on public.blocks
for delete to authenticated
using (blocker_id = (select auth.uid()));

-- People see the reports they filed. Filing goes through an RPC (beta).
create policy reports_select_own on public.reports
for select to authenticated
using (reporter_id = (select auth.uid()));

-- Realtime Authorization --------------------------------------------------------------
-- Members may listen on room:<room_id> and track presence there. Clients never
-- send broadcasts themselves; the RPCs do (API_CONTRACTS.md §4).

create policy room_members_receive_room_events on realtime.messages
for select to authenticated
using (
  extension in ('broadcast', 'presence')
  and private.can_use_room_topic((select realtime.topic()))
);

create policy room_members_track_presence on realtime.messages
for insert to authenticated
with check (
  extension = 'presence'
  and private.can_use_room_topic((select realtime.topic()))
);
