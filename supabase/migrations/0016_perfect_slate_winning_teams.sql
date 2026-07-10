-- 0016: FIX perfect-slate definition. The "top 5 scorers" pool must be drawn
-- from WINNING teams only. Otherwise, when a high-scoring team lost (e.g. scored
-- 24 in a 28-24 game), that 24 counted toward the slate top-5, but since the
-- jackpot also requires all 5 picks to have won, no one could ever match it --
-- making the week silently unwinnable. Restricting the pool to winners makes
-- "all 5 won" and "the 5 highest scorers" mutually consistent, so the jackpot
-- is winnable whenever a player nails the 5 best winning performances in order.
--
-- Verified against synthetic slates: a true perfect (TRUE), wrong order (false),
-- a pick outside the top 5 (false), any losing pick (false), a boundary tie
-- where the tied-for-5th teams both won and the player picked one (TRUE), and a
-- week that isn't fully final (no rows — the lock gate holds).
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
    -- Gate: only proceed if EVERY game in the week is final. Otherwise the CTE
    -- is empty and the function returns no rows (nothing leaks pre-lock).
    select bool_and(g.status = 'final'
                    and g.home_score is not null and g.away_score is not null) as done,
           count(*) as n
    from public.games g
    where g.season = p_season and g.week = p_week
  ),
  winning_scores as (
    -- Every WINNING team's points in the slate (a tie is not a win, so the
    -- strict > excludes both sides of a tied game).
    select g.home_score as pts
    from public.games g, wk_final f
    where g.season = p_season and g.week = p_week and f.done and f.n > 0
      and g.home_score > g.away_score
    union all
    select g.away_score
    from public.games g, wk_final f
    where g.season = p_season and g.week = p_week and f.done and f.n > 0
      and g.away_score > g.home_score
  ),
  slate_top5 as (
    -- The five highest WINNING team scores, by value (boundary ties included).
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
    and pa.all_won                 -- (1) all five picks won
    and pa.pts_desc = s.top5       -- (2) their 5 scores == the top-5 winning scores
    and pa.pts_by_order = s.top5;  -- (3) picked in high->low order (ties ok)
$function$;

revoke execute on function public.get_perfect_slates(uuid, integer, integer) from anon;
