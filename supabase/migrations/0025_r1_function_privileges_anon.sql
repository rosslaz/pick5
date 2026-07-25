-- 0025 (Release 1, #4 follow-up): revoking from PUBLIC is necessary but not
-- sufficient. Supabase's default privileges grant EXECUTE to `anon` EXPLICITLY
-- on every newly created function in the public schema, so a function needs
-- BOTH revokes. The functions created in 0022/0023 still had that explicit
-- anon grant; older ones were already clean because 0004 had revoked anon.
-- Caught by verifying has_function_privilege('anon', ...) after 0024.
revoke execute on function public.admin_set_score(uuid, uuid, int, int, text) from anon;
revoke execute on function public.admin_release_override(uuid, uuid) from anon;
revoke execute on function public.get_league_roster(uuid) from anon;
revoke execute on function public.get_scoring_window(uuid) from anon;
revoke execute on function public.is_app_admin() from anon, authenticated;
revoke execute on function public.week_reveal_anchor(int, int) from anon;

-- Stop the same trap for anything added later: no automatic anon grant.
alter default privileges in schema public revoke execute on functions from anon;

-- After this, the only anon-callable functions in public are validate_invite
-- (needed during registration) and the two trigger functions, which PostgREST
-- does not expose.
