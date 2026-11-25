-- Test-only stand-in for the parts of a Supabase project that the migrations
-- rely on. Loaded into PGlite before supabase/migrations/*.sql. Never applied
-- to a real project: Supabase already provides all of this.
--
-- What it mirrors:
--   * the API roles anon, authenticated and service_role,
--   * Supabase's default grants on the public schema (RLS is what protects
--     tables, not missing grants),
--   * auth.users, auth.uid(), auth.role() and auth.jwt(), which read the
--     request.jwt.* settings the way PostgREST sets them,
--   * realtime.messages, realtime.topic() and realtime.send(), so broadcasts
--     sent by the RPCs can be asserted.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- auth -----------------------------------------------------------------------

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);

create function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    auth.jwt() ->> 'sub'
  )::uuid
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.jwt() ->> 'role'
  )::text
$$;

-- realtime -------------------------------------------------------------------

create schema realtime;
grant usage on schema realtime to anon, authenticated, service_role;

create table realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  extension text not null,
  event text,
  payload jsonb,
  private boolean not null default false,
  inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to anon, authenticated;

-- The channel a client is joining. Supabase Realtime sets it per subscription.
create function realtime.topic() returns text
language sql stable
as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;

create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void
language plpgsql security definer
as $$
begin
  insert into realtime.messages (topic, extension, event, payload, private)
  values (topic, 'broadcast', event, payload, private);
end;
$$;
