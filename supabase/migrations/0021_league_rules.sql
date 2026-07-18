-- 0021: league rules. Admins can store a rules document per league and
-- optionally require every member to accept it before using the league.
-- Acceptance is recorded per (league, user); enforcement happens in the league
-- layout, which every league page routes through, so all join paths (join page,
-- register-with-code, auto-join) are covered without touching join_league.

alter table public.league_settings
  add column rules_text text,
  add column rules_required boolean not null default false;

create table public.league_rules_accepted (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  accepted_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

alter table public.league_rules_accepted enable row level security;

-- A member may record their own acceptance, and read their own rows.
create policy rules_accept_insert on public.league_rules_accepted
  for insert with check (
    user_id = auth.uid() and public.is_league_member(league_id)
  );
create policy rules_accept_select on public.league_rules_accepted
  for select using (
    user_id = auth.uid() or public.is_league_admin(league_id)
  );

-- Rules text must be readable by any member (not just admins) so the rules
-- page and the acceptance gate can display it. league_settings' existing
-- policies are admin-only, so expose the rules via a function instead.
create or replace function public.get_league_rules(p_league_id uuid)
returns table (rules_text text, rules_required boolean, accepted boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  select ls.rules_text,
         ls.rules_required,
         exists (
           select 1 from public.league_rules_accepted a
           where a.league_id = p_league_id and a.user_id = auth.uid()
         ) as accepted
  from public.league_settings ls
  where ls.league_id = p_league_id
    and public.is_league_member(p_league_id);
$function$;

revoke execute on function public.get_league_rules(uuid) from anon;

-- Record acceptance (idempotent).
create or replace function public.accept_league_rules(p_league_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.league_rules_accepted (league_id, user_id)
  select p_league_id, auth.uid()
  where public.is_league_member(p_league_id)
  on conflict (league_id, user_id) do nothing;
$function$;

revoke execute on function public.accept_league_rules(uuid) from anon;
