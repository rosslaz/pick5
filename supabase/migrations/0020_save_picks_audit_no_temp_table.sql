-- 0020: FIX save_picks audit — the temp table with ON COMMIT DROP (0018) broke a
-- second call within the same transaction ("relation already exists"). In
-- production each save is its own transaction so it never surfaced, but it's
-- fragile. Hold the before-snapshot in a jsonb variable instead of a temp table,
-- so the function is safe to call repeatedly in any transaction.
--
-- Verified: single save logs an add; a replace logs old->new; a no-op re-save
-- logs nothing; two saves in one transaction both succeed and log correctly.
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
  v_status text;
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

  v_count := jsonb_array_length(v_picks);
  if v_count > 5 then
    raise exception 'You can pick at most 5 games';
  end if;

  -- Snapshot current picks as {pick_order -> team_abbr}, before any mutation.
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

    select kickoff, status into v_kickoff, v_status
    from public.games
    where id = v_game_id and season = p_season and week = p_week;

    if not found then
      raise exception 'Game does not belong to this week';
    end if;

    select * into v_existing
    from public.picks
    where league_id = p_league_id and user_id = v_uid and game_id = v_game_id;

    if v_kickoff <= now() then
      if not found
         or v_existing.pick_order <> v_order
         or v_existing.picked_home <> v_picked_home then
        raise exception 'That game has kicked off and its pick is locked';
      end if;
    end if;
  end loop;

  for v_existing in
    select p.pick_order, p.game_id
    from public.picks p
    join public.games g on g.id = p.game_id
    where p.league_id = p_league_id and p.user_id = v_uid
      and p.season = p_season and p.week = p_week and g.kickoff <= now()
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
    and g.kickoff > now();

  for v_item in select * from jsonb_array_elements(v_picks) loop
    v_game_id := (v_item ->> 'game_id')::uuid;
    v_picked_home := (v_item ->> 'picked_home')::boolean;
    v_order := (v_item ->> 'pick_order')::int;

    select kickoff into v_kickoff from public.games where id = v_game_id;
    if v_kickoff > now() then
      insert into public.picks
        (league_id, user_id, game_id, picked_home, pick_order, season, week)
      values
        (p_league_id, v_uid, v_game_id, v_picked_home, v_order, p_season, p_week);
    end if;
  end loop;

  -- Snapshot the AFTER state the same way.
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

  -- Diff every slot 1..5; log only slots whose team changed.
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
