-- 0014: FIX overload ambiguity. Migrations 0012 and 0013 added parameters to
-- get_overall_totals with defaults, but Postgres treats a different arity as a
-- NEW function, so the 2-arg (0009), 3-arg (0012), and 4-arg (0013) versions
-- all coexisted. A 2-arg .rpc() call then failed with "function is not unique".
-- Drop the two older arities; the 4-arg version covers every call via defaults.
--
-- (0012 and 0013 on disk were also patched to drop the prior arity before
-- creating, so a from-scratch rebuild never hits this. This migration exists
-- because the live database had already accumulated the duplicates.)
drop function if exists public.get_overall_totals(uuid, integer);
drop function if exists public.get_overall_totals(uuid, integer, integer);
revoke execute on function public.get_overall_totals(uuid, integer, integer, integer) from anon;
