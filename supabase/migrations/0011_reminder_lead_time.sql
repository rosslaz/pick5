-- 0011: per-league reminder lead time + a dedupe log so the hourly cron never
-- sends the same (game, type) reminder to the same person twice.

alter table public.league_settings
  add column reminder_lead_hours integer not null default 3
  check (reminder_lead_hours between 1 and 72);

create table public.reminder_log (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 'slate' for the Sunday-1pm lock reminder (one per league/season/week),
  -- or the game id (as text) for a standalone-game reminder.
  reminder_key text not null,
  sent_at timestamptz not null default now(),
  unique (league_id, user_id, reminder_key)
);

alter table public.reminder_log enable row level security;
-- No policies: only the edge function (service role) reads/writes this; it
-- bypasses RLS. Enabling RLS with no policy denies all anon/auth access.

create index reminder_log_lookup on public.reminder_log (league_id, reminder_key);
