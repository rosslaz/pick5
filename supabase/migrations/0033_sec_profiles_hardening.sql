-- 0033 (security): profiles was fully user-writable and unvalidated.
--
-- FINDING 1a: any signed-in user could rewrite public.profiles.email to an
-- arbitrary address while auth.users.email (the verified one) stayed unchanged.
-- send-reminders reads profiles.email for both recipients and the commissioner
-- reply-to, so a member could aim the app's outbound mail at a stranger who
-- never signed up -- abusing our Brevo sender reputation. profiles.email is a
-- convenience copy written by the signup trigger; nothing in the app updates
-- it. handle_new_user is SECURITY DEFINER (owned by postgres) and unaffected.
--
-- NOTE: the column-level revoke below is a NO-OP on its own. PostgreSQL treats
-- a table-level UPDATE grant as covering every column and REVOKE UPDATE (col)
-- does not subtract from it. See 0034, which does the working version.
revoke update (email) on public.profiles from authenticated, anon;

-- FINDING 1b: no length limits anywhere on text the whole league renders. The
-- register form's maxLength={40} is client-side only, so display_name was
-- effectively unbounded and shows on every leaderboard for every member.
alter table public.profiles
  add constraint profiles_display_name_len
    check (display_name is null or char_length(display_name) between 1 and 40),
  add constraint profiles_email_len
    check (email is null or char_length(email) <= 254);

alter table public.leagues
  add constraint leagues_name_len
    check (char_length(btrim(name)) between 1 and 60);

-- rules_text is fetched in the league layout on EVERY page load, so an
-- unbounded document would degrade every request for that league.
alter table public.league_settings
  add constraint league_settings_rules_len
    check (rules_text is null or char_length(rules_text) <= 20000);

-- create_league validated nothing server-side (client maxLength only).
create or replace function public.create_league(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if char_length(v_name) = 0 then
    raise exception 'League name is required';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'League name must be 60 characters or fewer';
  end if;

  insert into public.leagues (name, created_by)
  values (v_name, auth.uid())
  returning id into v_id;

  insert into public.league_members (league_id, user_id, role, status)
  values (v_id, auth.uid(), 'admin', 'active');

  return v_id;
end;
$$;

revoke execute on function public.create_league(text) from public, anon;
grant execute on function public.create_league(text) to authenticated;
