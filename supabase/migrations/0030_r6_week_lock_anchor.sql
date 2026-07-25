-- 0030: CORRECT THE LOCK RULE.
--
-- The app was built assuming picks lock per game at that game's kickoff. The
-- league's actual rule is that the whole slate freezes when the Sunday 1:00 ET
-- games start: after that nobody can add or change a pick for the 4:25 window,
-- Sunday night, or Monday night. Only games kicking off BEFORE the anchor lock
-- earlier, at their own kickoff.
--
-- Effective lock for a pick = LEAST(game kickoff, that week's Sunday 1:00 ET
-- anchor). Six to seven games per week were editable after the lock.
--
-- Note this is deliberately NOT week_reveal_anchor: that function falls back to
-- the week's first kickoff when no Sunday 1:00 game exists, which is right for
-- hiding picks but would wrongly freeze an entire week at its first game. Here
-- a missing anchor means "no weekly freeze", so each game locks at kickoff.
create or replace function public.week_lock_anchor(p_season int, p_week int)
returns timestamptz
language sql
security definer
set search_path = public
stable
as $$
  select min(g.kickoff)
  from public.games g
  where g.season = p_season
    and g.week = p_week
    and extract(dow from g.kickoff at time zone 'America/New_York') = 0
    and (g.kickoff at time zone 'America/New_York')::time >= time '13:00';
$$;

revoke execute on function public.week_lock_anchor(int, int) from public, anon;
grant execute on function public.week_lock_anchor(int, int) to authenticated;

create or replace function public.save_picks(
  p_league_id uuid,
  p_season integer,
  p_week integer,
  p_picks jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_picks jsonb := coalesce(p_picks, '[]'::jsonb);
  v_item jsonb;
  v_game_id uuid;
  v_picked_home boolean;
  v_order int;
  v_kickoff timestamptz;
  v_lock timestamptz;
  v_anchor timestamptz;
  v_seen_games uuid[] := '{}';
  v_seen_orders int[] := '{}';
  v_count int;
  v_existing record;
  v_uid uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
begin
  if not public.is_league_member(p_league_id) then
    raise exception 'You are not an active member of this league';
  end if;

  if not public.is_league_admin(p_league_id)
     and exists (
       select 1 from public.league_settings ls
       where ls.league_id = p_league_id
         and ls.rules_required
         and coalesce(ls.rules_text, '') <> ''
     )
     and not exists (
       select 1 from public.league_rules_accepted a
       where a.league_id = p_league_id and a.user_id = v_uid
     )
  then
    raise exception 'You need to accept the league rules before making picks';
  end if;

  v_count := jsonb_array_length(v_picks);
  if v_count > 5 then
    raise exception 'You can pick at most 5 games';
  end if;

  -- The weekly freeze. Null means this week has no Sunday 1:00 slate, in which
  -- case each game simply locks at its own kickoff.
  v_anchor := public.week_lock_anchor(p_season, p_week);

  select coalesce(jsonb_object_agg(pick_order::text, team), '{}'::jsonb)
    into v_before
  from (
    select p.pick_order,
           case when p.picked_home then g.home_abbr else g.away_abbr end as team
    from public.picks p
    join public.games g on g.id = p.game_id
    where p.league_id = p_league_id and p.user_id = v_uid
      and p.season = p_season and p.week = p_week
  ) s;

  for v_item in select * from jsonb_array_elements(v_picks) loop
    v_game_id := (v_item ->> 'game_id')::uuid;
    v_picked_home := (v_item ->> 'picked_home')::boolean;
    v_order := (v_item ->> 'pick_order')::int;

    if v_order is null or v_order < 1 or v_order > 5 then
      raise exception 'Pick order must be between 1 and 5';
    end if;
    if v_game_id = any(v_seen_games) then
      raise exception 'You can only pick one team per game';
    end if;
    if v_order = any(v_seen_orders) then
      raise exception 'Duplicate pick order %', v_order;
    end if;
    v_seen_games := array_append(v_seen_games, v_game_id);
    v_seen_orders := array_append(v_seen_orders, v_order);

    select kickoff into v_kickoff
    from public.games
    where id = v_game_id and season = p_season and week = p_week;

    if not found then
      raise exception 'Game does not belong to this week';
    end if;

    v_lock := least(v_kickoff, coalesce(v_anchor, v_kickoff));

    select * into v_existing
    from public.picks
    where league_id = p_league_id and user_id = v_uid and game_id = v_game_id;

    if v_lock <= now() then
      if not found
         or v_existing.pick_order <> v_order
         or v_existing.picked_home <> v_picked_home then
        raise exception 'Picks are locked for this week';
      end if;
    end if;
  end loop;

  -- A locked pick may not be silently dropped by omitting it.
  for v_existing in
    select p.pick_order, p.game_id
    from public.picks p
    join public.games g on g.id = p.game_id
    where p.league_id = p_league_id and p.user_id = v_uid
      and p.season = p_season and p.week = p_week
      and least(g.kickoff, coalesce(v_anchor, g.kickoff)) <= now()
  loop
    if not (v_existing.game_id = any(v_seen_games)) then
      raise exception 'A locked pick is missing from your submission';
    end if;
  end loop;

  delete from public.picks p
  using public.games g
  where p.game_id = g.id
    and p.league_id = p_league_id and p.user_id = v_uid
    and p.season = p_season and p.week = p_week
    and least(g.kickoff, coalesce(v_anchor, g.kickoff)) > now();

  for v_item in select * from jsonb_array_elements(v_picks) loop
    v_game_id := (v_item ->> 'game_id')::uuid;
    v_picked_home := (v_item ->> 'picked_home')::boolean;
    v_order := (v_item ->> 'pick_order')::int;

    select kickoff into v_kickoff from public.games where id = v_game_id;
    if least(v_kickoff, coalesce(v_anchor, v_kickoff)) > now() then
      insert into public.picks
        (league_id, user_id, game_id, picked_home, pick_order, season, week)
      values
        (p_league_id, v_uid, v_game_id, v_picked_home, v_order, p_season, p_week);
    end if;
  end loop;

  select coalesce(jsonb_object_agg(pick_order::text, team), '{}'::jsonb)
    into v_after
  from (
    select p.pick_order,
           case when p.picked_home then g.home_abbr else g.away_abbr end as team
    from public.picks p
    join public.games g on g.id = p.game_id
    where p.league_id = p_league_id and p.user_id = v_uid
      and p.season = p_season and p.week = p_week
  ) s;

  insert into public.pick_audit
    (league_id, user_id, season, week, pick_order, change_type, old_team, new_team)
  select p_league_id, v_uid, p_season, p_week, slot,
         case when ob is null then 'add' when nw is null then 'remove' else 'replace' end,
         ob, nw
  from (
    select s as slot,
           v_before ->> s::text as ob,
           v_after  ->> s::text as nw
    from generate_series(1, 5) s
  ) d
  where ob is distinct from nw;
end;
$function$;
