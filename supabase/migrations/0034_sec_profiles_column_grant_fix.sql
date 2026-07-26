-- 0034 (security, fixes 0033): the column-level revoke in 0033 was a no-op.
--
-- PostgreSQL treats a table-level UPDATE grant as covering every column, and
-- REVOKE UPDATE (col) does not subtract from it -- so `authenticated` kept the
-- ability to rewrite profiles.email. Verified by re-running the attack after
-- 0033: the rewrite still succeeded.
--
-- The working form is to drop the table-wide grant and re-grant only the
-- columns a user may legitimately change. display_name is the only one; email
-- is a copy of the verified auth.users address and is written solely by the
-- handle_new_user trigger, which runs SECURITY DEFINER and is unaffected.
--
-- Verified after applying: email rewrite blocked, oversized display_name
-- blocked by the 0033 CHECK, ordinary rename still works.
revoke update on public.profiles from authenticated, anon;
grant  update (display_name) on public.profiles to authenticated;
