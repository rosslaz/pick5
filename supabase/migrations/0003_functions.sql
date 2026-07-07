-- Security-definer RPCs. These run as the table owner and enforce all the
-- game rules that RLS alone can't express.

-- Random, unambiguous 6-character invite code (no 0/O/1/I/L).
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
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.leagues where invite_code = code);
  end loop;
  return code;
end;
$$;

-- True if an invite code matches a league (used to validate before sign-up).
create or replace function public.validate_invite(p_invite_code text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.leagues where invite_code = upper(p_invite_code)
  );
$$;

-- Join a league by invite code. The first member of a brand-new league becomes
-- its admin. A previously removed member is reactivated in place.
create or replace function public.join_league(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league uuid;
  v_count int;
  v_existing public.league_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select id into v_league from public.leagues where invite_code = upper(p_invite_code);
  if v_league is null then
    raise exception 'Invalid invite code';
  end if;

  select * into v_existing
  from public.league_members
  where league_id = v_league and user_id = auth.uid();

  if found then
    if v_existing.status = 'removed' then
      update public.league_members set status = 'active'
      where league_id = v_league and user_id = auth.uid();
    end if;
    return v_league;
  end if;

  select count(*) into v_count from public.league_members where league_id = v_league;

  insert into public.league_members (league_id, user_id, role, status)
  values (v_league, auth.uid(), case when v_count = 0 then 'admin' else 'player' end, 'active');

  return v_league;
end;
$$;

-- Create a new league; the creator becomes commissioner (admin).
create or replace function public.create_league(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'League name is required';
  end if;

  v_code := public.generate_invite_code();

  insert into public.leagues (name, invite_code, created_by)
  values (trim(p_name), v_code, auth.uid())
  returning id into v_league;

  insert into public.league_members (league_id, user_id, role, status)
  values (v_league, auth.uid(), 'admin', 'active');

  return v_league;
end;
$$;

-- Rotate a league's invite code (admin only).
create or replace function public.regenerate_invite_code(p_league_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_league_admin(p_league_id) then
    raise exception 'Admins only';
  end if;
  v_code := public.generate_invite_code();
  update public.leagues set invite_code = v_code where id = p_league_id;
  return v_code;
end;
$$;

-- Manual score override for any league admin (ESPN wrong/late). Games are
-- global, so this updates the shared row for everyone.
create or replace function public.admin_set_score(
  p_game_id uuid,
  p_home_score int,
  p_away_score int,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.league_members
    where user_id = auth.uid() and role = 'admin' and status = 'active'
  ) then
    raise exception 'Admins only';
  end if;
  if p_status not in ('scheduled', 'in_progress', 'final') then
    raise exception 'Invalid status';
  end if;

  update public.games
  set home_score = p_home_score,
      away_score = p_away_score,
      status = p_status,
      updated_at = now()
  where id = p_game_id;
end;
$$;

-- Atomically save a week's picks. Validates membership, the 5-pick cap, one
-- team per game, and unique 1..N ordering. Picks whose game has kicked off are
-- frozen: they must be resubmitted unchanged (same team, same order), and any
-- new or reordered pick must belong to a game that hasn't started.
create or replace function public.save_picks(
  p_league_id uuid,
  p_season int,
  p_week int,
  p_picks jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
begin
  if not public.is_league_member(p_league_id) then
    raise exception 'You are not an active member of this league';
  end if;

  v_count := jsonb_array_length(v_picks);
  if v_count > 5 then
    raise exception 'You can pick at most 5 games';
  end if;

  -- Validate every incoming pick.
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

    -- Is this pick already stored exactly as-is?
    select * into v_existing
    from public.picks
    where league_id = p_league_id and user_id = auth.uid() and game_id = v_game_id;

    if v_kickoff <= now() then
      -- Locked game: only allowed if it exactly matches what's already stored.
      if not found
         or v_existing.pick_order <> v_order
         or v_existing.picked_home <> v_picked_home then
        raise exception 'That game has kicked off and its pick is locked';
      end if;
    end if;
  end loop;

  -- Guard against silently dropping a locked pick by omitting it.
  for v_existing in
    select p.pick_order, p.game_id
    from public.picks p
    join public.games g on g.id = p.game_id
    where p.league_id = p_league_id and p.user_id = auth.uid()
      and p.season = p_season and p.week = p_week and g.kickoff <= now()
  loop
    if not (v_existing.game_id = any(v_seen_games)) then
      raise exception 'A locked pick is missing from your submission';
    end if;
  end loop;

  -- Replace this week's picks: delete only the unlocked ones, then insert.
  delete from public.picks p
  using public.games g
  where p.game_id = g.id
    and p.league_id = p_league_id and p.user_id = auth.uid()
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
        (p_league_id, auth.uid(), v_game_id, v_picked_home, v_order, p_season, p_week);
    end if;
  end loop;
end;
$$;

-- Seed league so the commissioner can register through the normal flow.
insert into public.leagues (name, invite_code, season)
values ('Birmingham Pick 5', 'LIONUP', 2026)
on conflict (invite_code) do nothing;
