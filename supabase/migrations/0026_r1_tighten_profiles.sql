-- 0026 (Release 1, #11 completion): now that the app reads the roster through
-- get_league_roster (security definer, which returns email only to admins),
-- nothing needs direct access to other people's profile rows. Restrict the
-- table to self-access so member email addresses are no longer readable
-- through the API by any league mate.
--
-- Held back until the app was deployed against 0023: tightening this while the
-- old build was live would have rendered every player as "Unknown".
drop policy if exists profiles_select on public.profiles;

create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

-- shares_league_with() is now unused by any policy but is left in place: it is
-- harmless, still revoked from anon, and useful if a profile-sharing feature
-- returns later.
