-- 0022 (Release 1): authorization core.
--   #1  Score overrides are global (games are one shared table), so ANY global
--       override is cross-tenant. Previously admin_set_score only checked that
--       the caller was an admin of *some* league — and anyone can create a
--       league and become its admin, so any signed-in user could rewrite any
--       NFL score for every league. Overrides are now restricted to a named
--       app-owner allowlist, and every override is recorded.
--   #2  Non-admin members couldn't read league_settings (admin-only RLS), so
--       the half-season standings window silently didn't apply for players.
--       Exposed through a member-readable function instead.
--   #3  get_perfect_slates had no authorization check at all.

-- ---------------------------------------------------------------- #1
create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  added_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
-- No policies: readable only through is_app_admin() (security definer).

-- Seed the app owner. Replace with the appropriate id on a fresh deployment.
insert into public.app_admins (user_id, note)
values ('eb19b976-b519-4e8c-8203-9fb8851933fa', 'App owner')
on conflict (user_id) do nothing;

create or replace function public.is_app_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

-- Attributable record of every manual score change.
create table public.score_override_audit (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  league_id uuid references public.leagues (id) on delete set null,
  actor uuid references auth.users (id),
  old_home int, old_away int, old_status text,
  new_home int, new_away int, new_status text,
  action text not null,
  created_at timestamptz not null default now()
);
alter table public.score_override_audit enable row level security;

-- Replace the unscoped versions. Dropping the old signatures explicitly:
-- adding a parameter creates a NEW overload rather than replacing.
drop function if exists public.admin_set_score(uuid, int, int, text);
drop function if exists public.admin_release_override(uuid);

create function public.admin_set_score(
  p_league_id uuid,
  p_game_id uuid,
  p_home_score int,
  p_away_score int,
  p_status text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_old public.games%rowtype;
begin
  -- Must be an app owner AND acting as an admin of the given league.
  if not public.is_app_admin() then
    raise exception 'Score overrides are restricted to the app owner. Ask them to correct this game.';
  end if;
  if not public.is_league_admin(p_league_id) then
    raise exception 'Admins only';
  end if;
  if p_status not in ('scheduled', 'in_progress', 'final') then
    raise exception 'Invalid status';
  end if;
  if p_home_score is null or p_away_score is null
     or p_home_score < 0 or p_away_score < 0
     or p_home_score > 200 or p_away_score > 200 then
    raise exception 'Scores must be between 0 and 200';
  end if;

  select * into v_old from public.games where id = p_game_id;
  if not found then
    raise exception 'Game not found';
  end if;

  update public.games
  set home_score = p_home_score,
      away_score = p_away_score,
      status = p_status,
      manual_override = true,
      updated_at = now()
  where id = p_game_id;

  insert into public.score_override_audit
    (game_id, league_id, actor, old_home, old_away, old_status,
     new_home, new_away, new_status, action)
  values
    (p_game_id, p_league_id, auth.uid(), v_old.home_score, v_old.away_score, v_old.status,
     p_home_score, p_away_score, p_status, 'set');
end;
$$;

create function public.admin_release_override(p_league_id uuid, p_game_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Score overrides are restricted to the app owner.';
  end if;
  if not public.is_league_admin(p_league_id) then
    raise exception 'Admins only';
  end if;
  update public.games set manual_override = false where id = p_game_id;
  insert into public.score_override_audit (game_id, league_id, actor, action)
  values (p_game_id, p_league_id, auth.uid(), 'unpin');
end;
$$;

-- ---------------------------------------------------------------- #2
-- Members (not just admins) need the scoring window so the leaderboard shows
-- the same standings to everyone.
create or replace function public.get_scoring_window(p_league_id uuid)
returns integer
language sql stable security definer
set search_path = public
as $$
  select ls.score_from_week
  from public.league_settings ls
  where ls.league_id = p_league_id
    and public.is_league_member(p_league_id);
$$;

-- ---------------------------------------------------------------- #3
create or replace function public.get_perfect_slates(
  p_league_id uuid, p_season integer, p_week integer
)
returns table (user_id uuid)
language sql stable security definer
set search_path to 'public'
as $function$
  with wk_final as (
    select bool_and(g.status = 'final'
                    and g.home_score is not null and g.away_score is not null) as done,
           count(*) as n
    from public.games g
    where g.season = p_season and g.week = p_week
  ),
  winning_scores as (
    select g.home_score as pts from public.games g, wk_final f
    where g.season = p_season and g.week = p_week and f.done and f.n > 0
      and g.home_score > g.away_score
    union all
    select g.away_score from public.games g, wk_final f
    where g.season = p_season and g.week = p_week and f.done and f.n > 0
      and g.away_score > g.home_score
  ),
  slate_top5 as (
    select array_agg(pts order by pts desc) as top5
    from (select pts from winning_scores order by pts desc limit 5) t
  ),
  pick_scores as (
    select p.user_id, p.pick_order,
           case when p.picked_home then g.home_score else g.away_score end as pts,
           case when p.picked_home then g.home_score > g.away_score
                else g.away_score > g.home_score end as won
    from public.picks p
    join public.games g on g.id = p.game_id
    where p.league_id = p_league_id and p.season = p_season and p.week = p_week
  ),
  player_agg as (
    select user_id, count(*) as n_picks, bool_and(won) as all_won,
           array_agg(pts order by pick_order) as pts_by_order,
           array_agg(pts order by pts desc) as pts_desc
    from pick_scores group by user_id
  )
  select pa.user_id
  from player_agg pa, slate_top5 s
  where public.is_league_member(p_league_id)   -- FIX #3: was missing entirely
    and pa.n_picks = 5
    and pa.all_won
    and pa.pts_desc = s.top5
    and pa.pts_by_order = s.top5;
$function$;
