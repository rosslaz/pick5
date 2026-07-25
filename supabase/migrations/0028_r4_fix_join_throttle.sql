-- 0028 (Release 4, #17 fix): the throttle added in 0027 did nothing. Raising
-- 'Invalid invite code' unwinds the subtransaction, which rolled back the
-- join_attempts row the function had just inserted -- so a wrong guess erased
-- its own evidence and the counter never climbed. Verified: 25 bad guesses
-- logged 0 attempts before this fix, 20 after.
--
-- Return NULL for an unknown code instead of raising. The attempt row then
-- commits and the throttle actually counts. Every caller already handles a
-- null return ("That invite code doesn't match any league."), so the client
-- contract is unchanged.
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

  -- #17: cap invite-code attempts per account (a real person needs one or two).
  select count(*) into v_recent
  from public.join_attempts
  where user_id = auth.uid() and attempted_at > now() - interval '1 hour';
  if v_recent >= 20 then
    raise exception 'Too many invite code attempts. Please wait an hour and try again.';
  end if;
  insert into public.join_attempts (user_id) values (auth.uid());
  -- Opportunistic cleanup so the table cannot grow without bound.
  if random() < 0.02 then
    delete from public.join_attempts where attempted_at < now() - interval '2 days';
  end if;

  select id into v_league from public.leagues where invite_code = upper(p_invite_code);
  if v_league is null then
    -- NOT an exception: raising here would roll back the attempt row above.
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
