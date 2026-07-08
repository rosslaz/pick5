-- 0005: pin manual score overrides against ESPN syncs + membership guards

-- 1) Manual override flag: an admin-corrected game is "pinned" and the
--    sync-games edge function skips it when upserting ESPN data.
alter table public.games
  add column manual_override boolean not null default false;

-- Overriding a score now pins the game.
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
      manual_override = true,
      updated_at = now()
  where id = p_game_id;
end;
$$;

-- Un-pin a game so the next sync can refresh it from ESPN again.
create or replace function public.admin_release_override(p_game_id uuid)
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
  update public.games set manual_override = false where id = p_game_id;
end;
$$;

revoke execute on function public.admin_release_override(uuid) from anon;

-- 2) Membership guards.
--    Joining (or rejoining) grants admin only when the league has no active
--    admin: bootstraps a new league and self-heals an orphaned one. A removed
--    admin who rejoins comes back as a regular player, and an existing member
--    of an admin-less league can claim admin by re-entering the invite code.
create or replace function public.join_league(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league uuid;
  v_role text;
  v_existing public.league_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select id into v_league from public.leagues where invite_code = upper(p_invite_code);
  if v_league is null then
    raise exception 'Invalid invite code';
  end if;

  select case when exists (
    select 1 from public.league_members
    where league_id = v_league and role = 'admin' and status = 'active'
  ) then 'player' else 'admin' end
  into v_role;

  select * into v_existing
  from public.league_members
  where league_id = v_league and user_id = auth.uid();

  if found then
    if v_existing.status = 'removed' then
      update public.league_members
      set status = 'active', role = v_role
      where league_id = v_league and user_id = auth.uid();
    elsif v_role = 'admin' and v_existing.role <> 'admin' then
      -- Admin-less league: an existing member claims it via the invite code.
      update public.league_members
      set role = 'admin'
      where league_id = v_league and user_id = auth.uid();
    end if;
    return v_league;
  end if;

  insert into public.league_members (league_id, user_id, role, status)
  values (v_league, auth.uid(), v_role, 'active');

  return v_league;
end;
$$;

--    Database-level guard: the last active admin can't be demoted or removed,
--    no matter which client or API path attempts it.
create or replace function public.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin' and old.status = 'active'
     and (new.role <> 'admin' or new.status <> 'active') then
    if not exists (
      select 1 from public.league_members
      where league_id = old.league_id
        and user_id <> old.user_id
        and role = 'admin'
        and status = 'active'
    ) then
      raise exception 'A league must keep at least one active admin';
    end if;
  end if;
  return new;
end;
$$;

create trigger league_members_protect_last_admin
  before update on public.league_members
  for each row execute function public.protect_last_admin();
