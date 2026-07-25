-- 0023 (Release 1, #11): league mates could read each other's email addresses
-- directly through the profiles table (profiles_select allows any league mate,
-- and RLS can't restrict columns). Expose the roster through a function that
-- returns email ONLY to league admins; the tightening of the profiles table
-- itself follows in 0026, once the app is deployed against this.
create or replace function public.get_league_roster(p_league_id uuid)
returns table (
  user_id uuid,
  display_name text,
  email text,
  role text,
  status text,
  joined_at timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select lm.user_id,
         pr.display_name,
         case when public.is_league_admin(p_league_id) then pr.email else null end as email,
         lm.role,
         lm.status,
         lm.joined_at
  from public.league_members lm
  join public.profiles pr on pr.id = lm.user_id
  where lm.league_id = p_league_id
    and public.is_league_member(p_league_id)
  order by lm.joined_at asc;
$$;
