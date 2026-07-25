-- 0024 (Release 1, #4): every "revoke execute ... from anon" in earlier
-- migrations was a no-op. PostgreSQL grants EXECUTE to PUBLIC by default and
-- revoking from anon does not remove the PUBLIC grant, so anon retained access
-- to every function (verified: ACL showed "=X/postgres"). Today the in-function
-- auth.uid() checks cover it, but the codebase was written believing these were
-- locked down. Revoke from PUBLIC and grant explicitly instead.
--
-- CAREFUL: helpers referenced inside RLS policies are executed with the
-- CALLER's privileges, so `authenticated` must keep EXECUTE on them or every
-- policy evaluation fails with "permission denied for function". The trigger
-- functions are intentionally left alone (trigger execution does not check
-- EXECUTE at fire time, and breaking them would break signup).

revoke execute on function public.accept_league_rules(uuid) from public;
revoke execute on function public.admin_release_override(uuid, uuid) from public;
revoke execute on function public.admin_set_score(uuid, uuid, int, int, text) from public;
revoke execute on function public.create_league(text) from public;
revoke execute on function public.generate_invite_code() from public;
revoke execute on function public.get_league_roster(uuid) from public;
revoke execute on function public.get_league_rules(uuid) from public;
revoke execute on function public.get_overall_totals(uuid, integer, integer, integer) from public;
revoke execute on function public.get_perfect_slates(uuid, integer, integer) from public;
revoke execute on function public.get_pick_audit(uuid, integer, integer) from public;
revoke execute on function public.get_pick_slots(uuid, int, int) from public;
revoke execute on function public.get_scoring_window(uuid) from public;
revoke execute on function public.is_app_admin() from public;
revoke execute on function public.is_league_admin(uuid) from public;
revoke execute on function public.is_league_member(uuid) from public;
revoke execute on function public.join_league(text) from public;
revoke execute on function public.regenerate_invite_code(uuid) from public;
revoke execute on function public.save_picks(uuid, int, int, jsonb) from public;
revoke execute on function public.shares_league_with(uuid) from public;
revoke execute on function public.validate_invite(text) from public;
revoke execute on function public.week_reveal_anchor(int, int) from public;

-- Signed-in app surface.
grant execute on function public.accept_league_rules(uuid) to authenticated;
grant execute on function public.admin_release_override(uuid, uuid) to authenticated;
grant execute on function public.admin_set_score(uuid, uuid, int, int, text) to authenticated;
grant execute on function public.create_league(text) to authenticated;
grant execute on function public.get_league_roster(uuid) to authenticated;
grant execute on function public.get_league_rules(uuid) to authenticated;
grant execute on function public.get_overall_totals(uuid, integer, integer, integer) to authenticated;
grant execute on function public.get_perfect_slates(uuid, integer, integer) to authenticated;
grant execute on function public.get_pick_audit(uuid, integer, integer) to authenticated;
grant execute on function public.get_pick_slots(uuid, int, int) to authenticated;
grant execute on function public.get_scoring_window(uuid) to authenticated;
grant execute on function public.join_league(text) to authenticated;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
grant execute on function public.save_picks(uuid, int, int, jsonb) to authenticated;

-- Required by RLS policies, which evaluate as the calling role.
grant execute on function public.is_league_admin(uuid) to authenticated;
grant execute on function public.is_league_member(uuid) to authenticated;
grant execute on function public.shares_league_with(uuid) to authenticated;
grant execute on function public.week_reveal_anchor(int, int) to authenticated;

-- Registration validates an invite code before the account exists.
grant execute on function public.validate_invite(text) to anon, authenticated;
