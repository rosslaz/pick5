-- 1) FIX: the leaderboard/admin queries embed profiles from league_members,
--    which requires a direct foreign key for the API to resolve the join.
--    user_id only referenced auth.users, so the embed errored and both pages
--    rendered an empty roster. A profile row always exists before membership
--    (created by the signup trigger), so this constraint is always satisfiable.
alter table public.league_members
  add constraint league_members_user_profile_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- 2) Reveal timing: early-week picks (Thu/Fri/Sat and Sunday-morning games)
--    stay hidden until the week's Sunday 1:00 PM ET slate kicks off, so nobody
--    gains an edge from seeing whether an opponent's early pick hit or missed.
--    Games at/after the anchor still reveal at their own kickoff (SNF, MNF).
create or replace function public.week_reveal_anchor(p_season int, p_week int)
returns timestamptz
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select min(g.kickoff)
      from public.games g
      where g.season = p_season
        and g.week = p_week
        and extract(dow from g.kickoff at time zone 'America/New_York') = 0
        and (g.kickoff at time zone 'America/New_York')::time >= time '13:00'
    ),
    (select min(g.kickoff) from public.games g where g.season = p_season and g.week = p_week)
  );
$$;

drop policy if exists picks_select_after_kickoff on public.picks;

create policy picks_select_after_reveal on public.picks
  for select using (
    public.is_league_member(league_id)
    and exists (
      select 1 from public.games g
      where g.id = picks.game_id
        and greatest(g.kickoff, public.week_reveal_anchor(g.season, g.week)) <= now()
    )
  );
