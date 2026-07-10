-- 0015: perfect-slate jackpot detection (read-only; the app flags the event,
-- it does not move money or track the pot). Superseded by 0016, which fixes the
-- top-5 pool to winning teams only — this file is the initial version, kept for
-- migration history. See 0016 for the corrected definition.
--
-- A player hits the perfect slate for a fully-final week when:
--   (1) all 5 picked teams WON their games,
--   (2) the 5 picked teams' scores equal the slate's top-5 scores,
--   (3) the player's pick order is those teams ranked by points high->low.
-- Lock gating: returns nothing for a week that isn't entirely final, so it can
-- never leak pick information early.
create or replace function public.get_perfect_slates(
  p_league_id uuid,
  p_season integer,
  p_week integer
)
returns table (user_id uuid)
language sql
stable security definer
set search_path to 'public'
as $function$
  with wk_final as (
    select bool_and(g.status = 'final'
                    and g.home_score is not null and g.away_score is not null) as done,
           count(*) as n
    from public.games g
    where g.season = p_season and g.week = p_week
  ),
  team_scores as (
    select g.home_score as pts
    from public.games g, wk_final f
    where g.season = p_season and g.week = p_week and f.done and f.n > 0
    union all
    select g.away_score
    from public.games g, wk_final f
    where g.season = p_season and g.week = p_week and f.done and f.n > 0
  ),
  slate_top5 as (
    select array_agg(pts order by pts desc) as top5
    from (select pts from team_scores order by pts desc limit 5) t
  ),
  pick_scores as (
    select p.user_id, p.pick_order,
           case when p.picked_home then g.home_score else g.away_score end as pts,
           case when p.picked_home then g.home_score > g.away_score
                else g.away_score > g.home_score end as won
    from public.picks p
    join public.games g on g.id = p.game_id
    where p.league_id = p_league_id
      and p.season = p_season
      and p.week = p_week
  ),
  player_agg as (
    select user_id,
           count(*) as n_picks,
           bool_and(won) as all_won,
           array_agg(pts order by pick_order) as pts_by_order,
           array_agg(pts order by pts desc) as pts_desc
    from pick_scores
    group by user_id
  )
  select pa.user_id
  from player_agg pa, slate_top5 s
  where pa.n_picks = 5
    and pa.all_won
    and pa.pts_desc = s.top5
    and pa.pts_by_order = s.top5;
$function$;

revoke execute on function public.get_perfect_slates(uuid, integer, integer) from anon;
