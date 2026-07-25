-- 0027 (Release 4):
--   #8  The rules-acceptance gate was a layout redirect only, so a player who
--       had not accepted could still save picks by calling the RPC directly.
--       Enforced in save_picks now. Admins stay exempt, matching the UI gate
--       (they bypass the accept page so they can reach Admin -> Rules).
--   #17 Invite codes could be enumerated. Restricting validate_invite would
--       not have fixed it: join_league reveals validity too and any signed-up
--       user can hammer it. The real mitigations are entropy and a throttle.
--
-- NOTE: the throttle added here was broken and is corrected in 0028 -- see
-- that file. Kept as applied for migration-history parity.

-- ---------------------------------------------------------------- #8
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

  -- #8: server-side rules gate. The layout redirect is UI only; this is the
  -- actual enforcement boundary.
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

-- ---------------------------------------------------------------- #17
-- Longer codes. 31^6 is ~887 million, which a determined attacker could sweep
-- in days at high request rates; 31^8 is ~852 billion, which is not worth
-- anyone's time. Existing 6-character codes keep working (lookup is by exact
-- match) -- a commissioner who wants the longer form just regenerates.
create or replace function public.generate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.leagues where invite_code = code);
  end loop;
  return code;
end;
$$;

create table public.join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);
alter table public.join_attempts enable row level security;
create index join_attempts_lookup on public.join_attempts (user_id, attempted_at desc);
