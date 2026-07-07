-- Lock down function execution grants (defense in depth on top of the
-- auth.uid() / membership / admin checks already inside each function).

-- Internal helpers: not API endpoints. Revoke all direct execution; they still
-- run inside other security-definer functions and RLS policies.
revoke execute on function public.is_league_member(uuid) from anon, authenticated;
revoke execute on function public.is_league_admin(uuid) from anon, authenticated;
revoke execute on function public.shares_league_with(uuid) from anon, authenticated;
revoke execute on function public.generate_invite_code() from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;

-- RPCs that require a signed-in user: block the anon role outright.
revoke execute on function public.join_league(text) from anon;
revoke execute on function public.create_league(text) from anon;
revoke execute on function public.regenerate_invite_code(uuid) from anon;
revoke execute on function public.admin_set_score(uuid, int, int, text) from anon;
revoke execute on function public.save_picks(uuid, int, int, jsonb) from anon;

-- validate_invite stays callable by anon: registration validates the code
-- before the user account exists.
