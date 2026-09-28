-- ship. — Supabase schema
-- Run this in the Supabase SQL editor, or via `supabase db push`.
-- (Already have the tables from an earlier version? Don't rerun this —
-- run supabase/migrations/0003_backgrounds_avatars_manual_people.sql instead.)

create extension if not exists "pgcrypto";

-- Users are keyed by their Discord ID, since usernames can change.
create table if not exists users (
  discord_id          text primary key,
  username            text not null,
  display_name        text,
  avatar_url          text,
  is_admin            boolean not null default false,
  -- Lets someone opt out of receiving new ship requests.
  accepts_requests    boolean not null default true,
  -- Set when someone uploads their own profile picture (a small URL that
  -- points at /api/avatars/<id>; the image itself lives in user_avatars).
  -- Never touched by the Discord login upsert, so it survives future logins.
  avatar_override_url text,
  created_at          timestamptz not null default now()
);

-- The actual uploaded profile pictures, kept out of `users` so that
-- listing users/ships stays light.
create table if not exists user_avatars (
  discord_id  text primary key references users(discord_id) on delete cascade,
  image_data  text not null,          -- data URL (small, resized in the browser)
  updated_at  timestamptz not null default now()
);

-- Catalog of card backgrounds. Only admins add to it; people can only pick
-- from what's here.
create table if not exists backgrounds (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  image_data  text not null,          -- data URL (resized in the browser before upload)
  created_at  timestamptz not null default now()
);

create sequence if not exists ships_number_seq start 1;

create table if not exists ships (
  id                      uuid primary key default gen_random_uuid(),
  number                  integer not null default nextval('ships_number_seq'),
  -- Real people (logged in with Discord)…
  user_a_id               text references users(discord_id),
  user_b_id               text references users(discord_id),
  -- …or, for ships an admin created by hand, just a display name. Nobody
  -- needs a Discord account connected to appear in a ship.
  person_a_name           text,
  person_b_name           text,
  status                  text not null default 'pending'
                            check (status in ('confirmed', 'pending', 'ended', 'archived')),
  is_two_auth             boolean not null default false,
  custom_text             text,
  -- Both people must agree on bio/background changes on two-auth ships.
  custom_text_pending     text,
  custom_text_proposed_by text references users(discord_id),
  background_id           uuid references backgrounds(id) on delete set null,
  background_pending      uuid references backgrounds(id) on delete set null,
  background_proposed_by  text references users(discord_id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  updated_by              text references users(discord_id),
  ended_at                timestamptz,
  constraint different_people check (user_a_id <> user_b_id),
  constraint unique_pair unique (user_a_id, user_b_id),
  constraint person_a_present check (user_a_id is not null or person_a_name is not null),
  constraint person_b_present check (user_b_id is not null or person_b_name is not null),
  constraint bio_length check (custom_text is null or char_length(custom_text) <= 300)
);

create unique index if not exists ships_number_idx on ships(number);

create table if not exists ship_requests (
  id            uuid primary key default gen_random_uuid(),
  from_user_id  text not null references users(discord_id),
  to_user_id    text not null references users(discord_id),
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  constraint different_people_request check (from_user_id <> to_user_id)
);

create table if not exists ship_history (
  id          uuid primary key default gen_random_uuid(),
  ship_id     uuid not null references ships(id) on delete cascade,
  action      text not null,
  actor_id    text references users(discord_id),
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists reports (
  id               uuid primary key default gen_random_uuid(),
  ship_id          uuid references ships(id) on delete set null,
  -- A report can target a ship/card, or a specific person directly.
  reported_user_id text references users(discord_id),
  reported_by      text not null references users(discord_id),
  reason           text not null,
  status           text not null default 'open'
                     check (status in ('open', 'resolved', 'dismissed')),
  created_at       timestamptz not null default now(),
  constraint reports_target_check check (ship_id is not null or reported_user_id is not null)
);

create table if not exists audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     text references users(discord_id),
  action       text not null,
  target_type  text not null check (target_type in ('ship', 'user', 'request', 'report', 'settings', 'background')),
  target_id    text,
  detail       text,
  created_at   timestamptz not null default now()
);

-- Keep updated_at current on ship writes.
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists ships_set_updated_at on ships;
create trigger ships_set_updated_at
  before update on ships
  for each row execute function set_updated_at();

-- Row Level Security ---------------------------------------------------

alter table users enable row level security;
alter table user_avatars enable row level security;
alter table backgrounds enable row level security;
alter table ships enable row level security;
alter table ship_requests enable row level security;
alter table ship_history enable row level security;
alter table reports enable row level security;
alter table audit_logs enable row level security;

-- Ship data is public read (it's a community list), writes go through
-- server-side route handlers using the service-role key, which bypasses RLS.
-- This keeps consent logic (both people must agree) enforced in one place
-- in application code rather than duplicated in policies.

create policy "Public can read users" on users for select using (true);
create policy "Public can read ships" on ships for select using (true);
create policy "Public can read ship history" on ship_history for select using (true);
create policy "Public can read backgrounds" on backgrounds for select using (true);

-- Requests, reports, audit logs and the raw avatar images have no public
-- policies on purpose. The app never signs people into Supabase Auth (it
-- uses its own signed cookie — see lib/session.ts), so an `auth.jwt()`-based
-- policy could never match a real user. Those tables are read and written
-- through the service-role client from server-side code, with the "only the
-- people involved" checks enforced in application code.
