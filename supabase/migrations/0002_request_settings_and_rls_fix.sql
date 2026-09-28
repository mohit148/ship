-- Run this in the Supabase SQL editor if you already ran the original
-- schema.sql and don't want to drop/recreate tables.
--
-- What this fixes:
-- 1. Adds `accepts_requests` to `users`, so people can opt out of getting
--    ship requests (defaults to true for everyone, including existing rows).
-- 2. Removes two RLS select policies that can never actually match: they're
--    written against `auth.jwt() ->> 'sub'`, but this app authenticates
--    through its own signed session cookie (lib/session.ts), not Supabase
--    Auth, so `auth.jwt()` is always null for every request the app makes.
--    With RLS enabled and no matching policy, those selects were silently
--    returning zero rows to every real user, every time. The app now reads
--    ship_requests / reports through the service-role client instead, with
--    the "only the people involved" check enforced in application code (see
--    app/api/requests/[id]/route.ts and app/api/admin/reports/[id]/route.ts).

alter table users add column if not exists accepts_requests boolean not null default true;

drop policy if exists "Participants can read their requests" on ship_requests;
drop policy if exists "Reporters can read their own reports" on reports;
