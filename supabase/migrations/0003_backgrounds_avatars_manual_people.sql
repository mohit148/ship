-- Run this in the Supabase SQL editor if you already have the earlier
-- tables. Safe to run more than once.
--
-- Adds: uploaded profile pictures, the admin-managed background catalog,
-- background changes on ships (with the same approve-by-the-other-person
-- flow as bios), ships made of just two names (no Discord account needed),
-- and reports that can target a person directly.
-- Also removes the short-lived BGM columns, if you'd added them.

alter table users add column if not exists avatar_override_url text;

create table if not exists user_avatars (
  discord_id  text primary key references users(discord_id) on delete cascade,
  image_data  text not null,
  updated_at  timestamptz not null default now()
);

create table if not exists backgrounds (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  image_data  text not null,
  created_at  timestamptz not null default now()
);

alter table user_avatars enable row level security;
alter table backgrounds enable row level security;
drop policy if exists "Public can read backgrounds" on backgrounds;
create policy "Public can read backgrounds" on backgrounds for select using (true);

-- Ships: background + pending background change, and names-only people.
alter table ships add column if not exists background_id uuid references backgrounds(id) on delete set null;
alter table ships add column if not exists background_pending uuid references backgrounds(id) on delete set null;
alter table ships add column if not exists background_proposed_by text references users(discord_id);
alter table ships add column if not exists person_a_name text;
alter table ships add column if not exists person_b_name text;
alter table ships alter column user_a_id drop not null;
alter table ships alter column user_b_id drop not null;
alter table ships drop constraint if exists person_a_present;
alter table ships drop constraint if exists person_b_present;
alter table ships add constraint person_a_present check (user_a_id is not null or person_a_name is not null);
alter table ships add constraint person_b_present check (user_b_id is not null or person_b_name is not null);
alter table ships drop constraint if exists bio_length;
alter table ships add constraint bio_length check (custom_text is null or char_length(custom_text) <= 300) not valid;

-- BGM was removed.
alter table ships drop column if exists bgm_url;
alter table ships drop column if exists bgm_pending;
alter table ships drop column if exists bgm_proposed_by;

-- Reports can target a person directly.
alter table reports add column if not exists reported_user_id text references users(discord_id);
alter table reports alter column ship_id drop not null;
alter table reports drop constraint if exists reports_target_check;
alter table reports add constraint reports_target_check check (ship_id is not null or reported_user_id is not null);

-- Audit log can record background changes.
alter table audit_logs drop constraint if exists audit_logs_target_type_check;
alter table audit_logs add constraint audit_logs_target_type_check
  check (target_type in ('ship', 'user', 'request', 'report', 'settings', 'background'));
