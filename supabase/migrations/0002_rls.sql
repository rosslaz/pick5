-- Row Level Security

alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.games enable row level security;
alter table public.picks enable row level security;

-- Security-definer helpers bypass RLS internally to avoid recursive policy
-- evaluation (a policy on league_members that itself queries league_members).
create or replace function public.is_league_member(p_league uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.league_members
    where league_id = p_league and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.is_league_admin(p_league uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.league_members
    where league_id = p_league and user_id = auth.uid()
      and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.shares_league_with(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.league_members me
    join public.league_members them on them.league_id = me.league_id
    where me.user_id = auth.uid() and me.status = 'active'
      and them.user_id = p_user and them.status = 'active'
  );
$$;

-- Profiles: you can see yourself and anyone who shares a league with you.
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.shares_league_with(id));
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Leagues: members can read their leagues; admins can update settings.
create policy leagues_select on public.leagues
  for select using (public.is_league_member(id));
create policy leagues_update on public.leagues
  for update using (public.is_league_admin(id)) with check (public.is_league_admin(id));

-- League members: members can read the roster; admins can change roles/status.
-- Inserts happen through security-definer RPCs, not directly.
create policy members_select on public.league_members
  for select using (public.is_league_member(league_id));
create policy members_update on public.league_members
  for update using (public.is_league_admin(league_id))
  with check (public.is_league_admin(league_id));

-- Games: any authenticated user can read; writes come only from the service
-- role (edge function) or the admin_set_score RPC, never from the browser.
create policy games_select on public.games
  for select to authenticated using (true);

-- Picks:
--   * you can always read and write your own;
--   * you can read a league mate's pick only after that game has kicked off.
create policy picks_select_own on public.picks
  for select using (user_id = auth.uid());

create policy picks_select_after_kickoff on public.picks
  for select using (
    public.is_league_member(league_id)
    and exists (
      select 1 from public.games g
      where g.id = picks.game_id and g.kickoff <= now()
    )
  );

-- Direct writes are disabled; save_picks (security definer) handles all changes
-- so the locking rules are enforced in one place. No insert/update/delete
-- policies are defined, so RLS denies those to normal clients by default.
