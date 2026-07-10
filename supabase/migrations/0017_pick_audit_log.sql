-- 0017: forward-only pick audit log. save_picks records one row per changed
-- slot (added / replaced / removed), capturing the human-readable team abbrev
-- before and after plus a timestamp. Only changes from this migration forward
-- are captured (no retroactive history). The admin read (get_pick_audit) is
-- lock-gated, so nothing here can leak current-week picks early.

create table public.pick_audit (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  season integer not null,
  week integer not null,
  pick_order integer not null,
  -- 'add' (empty -> team), 'replace' (team -> team), 'remove' (team -> empty)
  change_type text not null check (change_type in ('add', 'replace', 'remove')),
  old_team text,        -- abbreviation that was there before (null for 'add')
  new_team text,        -- abbreviation saved now (null for 'remove')
  changed_at timestamptz not null default now()
);

alter table public.pick_audit enable row level security;
-- No policies: only the SECURITY DEFINER read function (get_pick_audit) exposes
-- rows, and only for fully-locked weeks. Direct table access is denied.

create index pick_audit_lookup on public.pick_audit (league_id, season, week);
