-- Extend season aggregates with each player's pick record (wins-losses).
-- A pick counts toward the record once its game is final AND revealed under
-- the Sunday-slate rule. A tied game counts as a loss (no winner was picked).
drop function if exists public.get_overall_totals(uuid, int);

create function public.get_overall_totals(p_league_id uuid, p_season int)
returns table (user_id uuid, total int, weeks_won int, wins int, losses int)
language sql
security definer
set search_path = public
stable
as $$
  with anchors as (
    select w.week, public.week_reveal_anchor(p_season, w.week) as reveal_floor
    from (select distinct week from public.games where season = p_season) w
  ),
  pick_pts as (
    select p.user_id, p.week, p.pick_order,
           case
             when g.status = 'final'
              and g.home_score is not null and g.away_score is not null
              and g.home_score <> g.away_score
              and ((p.picked_home and g.home_score > g.away_score)
                or ((not p.picked_home) and g.away_score > g.home_score))
             then case when p.picked_home then g.home_score else g.away_score end
             else 0
           end as pts,
           (g.status = 'final' and g.home_score is not null and g.away_score is not null)
             as counted,
           (g.status = 'final'
            and g.home_score is not null and g.away_score is not null
            and g.home_score <> g.away_score
            and ((p.picked_home and g.home_score > g.away_score)
              or ((not p.picked_home) and g.away_score > g.home_score)))
             as is_win
    from public.picks p
    join public.games g on g.id = p.game_id
    join anchors a on a.week = g.week
    where p.league_id = p_league_id
      and p.season = p_season
      and greatest(g.kickoff, a.reveal_floor) <= now()
  ),
  records as (
    select user_id,
           count(*) filter (where counted and is_win)::int as wins,
           count(*) filter (where counted and not is_win)::int as losses
    from pick_pts
    group by 1
  ),
  slots as (
    select u.user_id, w.week, s.ord, coalesce(pp.pts, 0) as pts
    from (select distinct user_id from pick_pts) u
    cross join (select distinct week from pick_pts) w
    cross join generate_series(1, 5) as s(ord)
    left join pick_pts pp
      on pp.user_id = u.user_id and pp.week = w.week and pp.pick_order = s.ord
  ),
  weekly as (
    select user_id, week, sum(pts)::int as total,
           array_agg(pts order by ord) as slot_arr
    from slots
    group by 1, 2
  ),
  complete_weeks as (
    select week from public.games
    where season = p_season
    group by week
    having bool_and(status = 'final')
  ),
  ranked as (
    select w.user_id, w.week, w.total,
           rank() over (partition by w.week
                        order by (array[w.total] || w.slot_arr) desc) as rk
    from weekly w
    join complete_weeks cw on cw.week = w.week
  ),
  wins as (
    select user_id, count(*)::int as weeks_won
    from ranked
    where rk = 1 and total > 0
    group by 1
  ),
  totals as (
    select user_id, sum(total)::int as total from weekly group by 1
  )
  select m.user_id,
         coalesce(t.total, 0) as total,
         coalesce(wn.weeks_won, 0) as weeks_won,
         coalesce(r.wins, 0) as wins,
         coalesce(r.losses, 0) as losses
  from public.league_members m
  left join totals t on t.user_id = m.user_id
  left join wins wn on wn.user_id = m.user_id
  left join records r on r.user_id = m.user_id
  where m.league_id = p_league_id
    and m.status = 'active'
    and public.is_league_member(p_league_id);
$$;

revoke execute on function public.get_overall_totals(uuid, int) from anon;
