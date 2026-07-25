-- 0032: the picks page was defaulting to a week nobody could act on.
--
-- computeCurrentWeek() answers "which week has unfinished games", which is the
-- right question for deciding what to re-sync from ESPN, and was also being
-- used to decide which week to show on the Picks page. Those diverged the
-- moment the weekly freeze landed (0030): from Sunday 1:00 PM until the Monday
-- nighter goes final -- roughly 34 hours -- the current week is locked but
-- still has unfinished games, so Picks opened on a board where every game was
-- locked instead of pointing at next week, which is open.
--
-- Verified against the real 2026 schedule: with the week 1 anchor passed and
-- six games left to play, the old logic returned week 1 and this returns 2.
--
-- This answers the other question: the earliest week that still has at least
-- one pickable game, where a game is pickable until LEAST(kickoff, anchor).
-- Falls back to the last week of the season once everything is locked.
create or replace function public.current_pick_week(p_season integer)
returns integer
language sql stable security definer
set search_path = public
as $$
  with wk as (
    select g.week,
           bool_or(
             least(g.kickoff,
                   coalesce(public.week_lock_anchor(p_season, g.week), g.kickoff)) > now()
           ) as has_open_game
    from public.games g
    where g.season = p_season
    group by g.week
  )
  select coalesce(
    (select min(week) from wk where has_open_game),
    (select max(week) from wk)
  );
$$;

revoke execute on function public.current_pick_week(integer) from public, anon;
grant execute on function public.current_pick_week(integer) to authenticated;
