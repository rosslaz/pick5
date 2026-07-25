-- 0029 (Release 5):
--   #3  score_override_audit was created in 0022 with RLS on and no policies
--       and no read function, so the accountability trail for the critical
--       score-override fix was permanently unreadable -- including by the app
--       owner. Give it an admin-only read path.
--   #9  join_league logged an attempt for EVERY call, including successful
--       joins, so someone legitimately joining several leagues in an hour
--       could trip the anti-guessing throttle. Only failed lookups count now.

-- ---------------------------------------------------------------- #3
create or replace function public.get_score_overrides(
  p_league_id uuid,
  p_season integer
)
returns table (
  game_label text,
  week integer,
  action text,
  old_home int,
  old_away int,
  new_home int,
  new_away int,
  new_status text,
  actor_name text,
  created_at timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select (g.away_abbr || ' @ ' || g.home_abbr) as game_label,
         g.week,
         a.action,
         a.old_home, a.old_away,
         a.new_home, a.new_away,
         a.new_status,
         coalesce(pr.display_name, 'Unknown') as actor_name,
         a.created_at
  from public.score_override_audit a
  join public.games g on g.id = a.game_id
  left join public.profiles pr on pr.id = a.actor
  where g.season = p_season
    and public.is_league_admin(p_league_id)
  order by a.created_at desc
  limit 100;
$$;

revoke execute on function public.get_score_overrides(uuid, integer) from public, anon;
grant execute on function public.get_score_overrides(uuid, integer) to authenticated;

-- ---------------------------------------------------------------- #9
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
  v_recent int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Throttle check runs first so a blocked caller learns nothing about the code.
  select count(*) into v_recent
  from public.join_attempts
  where user_id = auth.uid() and attempted_at > now() - interval '1 hour';
  if v_recent >= 20 then
    raise exception 'Too many invite code attempts. Please wait an hour and try again.';
  end if;

  select id into v_league from public.leagues where invite_code = upper(p_invite_code);

  if v_league is null then
    -- #9: only a FAILED lookup counts toward the throttle. Successful joins are
    -- not guessing. The insert must happen on a non-exception path (returning
    -- null rather than raising), or it would be rolled back with the error
    -- (see 0028).
    insert into public.join_attempts (user_id) values (auth.uid());
    if random() < 0.02 then
      delete from public.join_attempts where attempted_at < now() - interval '2 days';
    end if;
    return null;
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
