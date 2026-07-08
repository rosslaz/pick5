-- Reveal WHICH slots each league member has filled for a week, without
-- revealing the picks themselves. Lets the leaderboard distinguish
-- "submitted but hidden until kickoff" from "no pick submitted".
create or replace function public.get_pick_slots(
  p_league_id uuid,
  p_season int,
  p_week int
)
returns table (user_id uuid, pick_order int)
language sql
security definer
set search_path = public
stable
as $$
  select p.user_id, p.pick_order
  from public.picks p
  where p.league_id = p_league_id
    and p.season = p_season
    and p.week = p_week
    and public.is_league_member(p_league_id);
$$;

revoke execute on function public.get_pick_slots(uuid, int, int) from anon;
