-- 0019: admin-only, lock-gated read of the pick audit for a week. Returns rows
-- ONLY when (a) the caller is an active admin of the league, and (b) every game
-- in that week is final -- so the log can never reveal picks before the week is
-- completely locked. Includes display_name so the admin view is readable.
create or replace function public.get_pick_audit(
  p_league_id uuid,
  p_season integer,
  p_week integer
)
returns table (
  display_name text,
  pick_order integer,
  change_type text,
  old_team text,
  new_team text,
  changed_at timestamptz
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with gate as (
    select bool_and(g.status = 'final') as done, count(*) as n
    from public.games g
    where g.season = p_season and g.week = p_week
  )
  select pr.display_name, pa.pick_order, pa.change_type,
         pa.old_team, pa.new_team, pa.changed_at
  from public.pick_audit pa
  join public.profiles pr on pr.id = pa.user_id
  cross join gate
  where pa.league_id = p_league_id
    and pa.season = p_season
    and pa.week = p_week
    and public.is_league_admin(p_league_id)  -- admin-only
    and gate.done and gate.n > 0             -- week fully final (lock gate)
  order by pa.changed_at desc, pr.display_name, pa.pick_order;
$function$;

revoke execute on function public.get_pick_audit(uuid, integer, integer) from anon;
