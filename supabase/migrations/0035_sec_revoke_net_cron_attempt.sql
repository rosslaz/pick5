-- 0035 (security): ATTEMPTED revoke of pg_net / pg_cron from the client roles.
--
-- net.http_post/get/delete is a server-side-request-forgery primitive and
-- cron.schedule is a scheduler primitive, and both were EXECUTE-able by anon
-- and authenticated.
--
-- THIS MIGRATION IS A NO-OP. It is kept for history and to document why.
--
-- Two reasons it cannot work from here:
--   1. The grant is held by PUBLIC, not by anon/authenticated directly, so
--      revoking from those roles subtracts nothing (the same trap as 0024).
--   2. The `net` and `cron` schemas are owned by supabase_admin while
--      migrations run as postgres. A non-owner without grant option cannot
--      revoke; PostgreSQL emits a warning and does nothing. Confirmed by
--      re-querying has_function_privilege afterwards -- still true.
--
-- Mitigating control (verified, not assumed): PostgREST exposes only the
-- `public` schema. Probing /rest/v1/rpc/http_get with the public anon key
-- returns 404 PGRST202 ("Could not find the function public.http_get"), so
-- there is no route from a client to these functions. Removing the grants
-- outright would need Supabase support or a dashboard-level change.
--
-- Do NOT "fix" this by revoking from PUBLIC without first granting explicitly
-- to postgres: the hourly reminders cron job runs as postgres and holds its
-- EXECUTE on net.http_post only through that same PUBLIC grant.
revoke all on schema net from anon, authenticated;
revoke all on all functions in schema net from anon, authenticated;
revoke all on all tables in schema net from anon, authenticated;

revoke all on schema cron from anon, authenticated;
revoke all on all functions in schema cron from anon, authenticated;
revoke all on all tables in schema cron from anon, authenticated;
