-- 0010: per-league reminder settings + in-database scheduling (Brevo rebuild;
-- see pick5-email-reminders-decision.md for the provider decision).

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.league_settings (
  league_id uuid primary key references public.leagues (id) on delete cascade,
  reminders_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.league_settings enable row level security;

create policy league_settings_select on public.league_settings
  for select using (public.is_league_admin(league_id));
create policy league_settings_insert on public.league_settings
  for insert with check (public.is_league_admin(league_id));
create policy league_settings_update on public.league_settings
  for update using (public.is_league_admin(league_id))
  with check (public.is_league_admin(league_id));

-- The cron schedules are created directly on the live database (not in this
-- file) because they embed the project's API key and a shared secret, which
-- don't belong in a repo. Template for reference:
--
-- select cron.schedule('pick5-reminders-thursday', '0 17 * * 4', $cron$
--   select net.http_post(
--     url := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-reminders',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <ANON_KEY>',
--       'x-reminder-secret', '<REMINDER_SECRET>'),
--     body := '{}'::jsonb);
-- $cron$);
-- select cron.schedule('pick5-reminders-sunday', '30 14 * * 0', $cron$ ...same... $cron$);
