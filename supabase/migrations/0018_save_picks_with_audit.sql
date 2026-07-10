-- 0018: save_picks now writes a diff to pick_audit. All existing validation and
-- lock behavior is unchanged; the only additions are snapshotting the pre-save
-- picks with team abbreviations and, after the reinsert, diffing old vs new per
-- slot to log add/replace/remove rows.
--
-- NOTE: this version used a temp table with ON COMMIT DROP, which breaks a
-- second save_picks call within the SAME transaction ("relation already
-- exists"). Superseded by 0020, which holds the snapshot in a jsonb variable
-- instead. Kept here for migration-history parity; 0020 replaces the body.
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
begin
  if not public.is_league_member(p_league_id) then
    raise exception 'You are not an active member of this league';
  end if;

  v_count := jsonb_array_length(v_picks);
  if v_count > 5 then
    raise exception 'You can pick at most 5 games';
  end if;

  create temp table _audit_before on commit drop as
  select p.pick_order,
         case when p.picked_home then g.home_abbr else g.away_abbr end as team
  from public.picks p
  join public.games g on g.id = p.game_id
  where p.league_id = p_league_id and p.user_id = v_uid
    and p.season = p_season and p.week = p_week;

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

  insert into public.pick_audit
    (league_id, user_id, season, week, pick_order, change_type, old_team, new_team)
  select p_league_id, v_uid, p_season, p_week,
         coalesce(b.pick_order, a.pick_order),
         case
           when b.team is null then 'add'
           when a.team is null then 'remove'
           else 'replace'
         end,
         b.team, a.team
  from _audit_before b
  full outer join (
    select p.pick_order,
           case when p.picked_home then g.home_abbr else g.away_abbr end as team
    from public.picks p
    join public.games g on g.id = p.game_id
    where p.league_id = p_league_id and p.user_id = v_uid
      and p.season = p_season and p.week = p_week
  ) a on a.pick_order = b.pick_order
  where b.team is distinct from a.team;
end;
$function$;
