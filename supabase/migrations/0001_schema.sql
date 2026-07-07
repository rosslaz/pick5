-- Pick 5 NFL — core schema

create extension if not exists pgcrypto;

-- Profiles mirror auth.users with a display name for the leaderboard.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player',
  email text,
  created_at timestamptz not null default now()
);

-- A profile row is created automatically whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  season int not null default 2026,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'player' check (role in ('admin', 'player')),
  status text not null default 'active' check (status in ('active', 'removed')),
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create index league_members_user_idx on public.league_members (user_id);

-- NFL games are global (shared across leagues), keyed by ESPN's event id.
create table public.games (
  id uuid primary key default gen_random_uuid(),
  espn_id text not null unique,
  season int not null,
  week int not null,
  kickoff timestamptz not null,
  home_team text not null,
  away_team text not null,
  home_abbr text not null,
  away_abbr text not null,
  home_logo text,
  away_logo text,
  home_score int,
  away_score int,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'final')),
  updated_at timestamptz not null default now()
);

create index games_season_week_idx on public.games (season, week);

create table public.picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  picked_home boolean not null,
  pick_order int not null check (pick_order between 1 and 5),
  season int not null,
  week int not null,
  created_at timestamptz not null default now(),
  -- One pick per game per player per league.
  unique (league_id, user_id, game_id),
  -- One team per slot number each week.
  unique (league_id, user_id, season, week, pick_order)
);

create index picks_league_week_idx on public.picks (league_id, season, week);
