-- ============================================================================
-- Pick 5 — full-season simulation / regression suite
-- ============================================================================
--
-- WHAT IT DOES
--   Builds a throwaway league (season 9999) with five simulated players and a
--   realistic multi-week schedule, plays it out, and asserts the app's rules.
--   Covers: scoring, ties, partial slates, removed members, tiebreaks, the
--   perfect-slate jackpot, half-season resets, the Sunday 1:00 ET lock, flex
--   scheduling, postponed games, pick validation, the audit trail, the rules
--   gate, score-override authorisation, and pick reveal timing.
--
-- HOW TO RUN
--   Paste the whole file into the Supabase SQL editor and run it. The output
--   is a table of assertions with PASS/FAIL and a TOTAL row at the bottom.
--
-- SAFETY
--   Everything runs inside a single transaction that ends in ROLLBACK. No
--   rows survive — not the simulated auth users, not the league, not the
--   games. It touches season 9999 only, never your real season. If you abort
--   it midway the transaction is discarded too.
--
-- WHY auth.users IS WRITTEN TO
--   picks.user_id and profiles.id both reference auth.users, so simulating
--   more than one player requires inserting there. Those inserts are rolled
--   back with everything else, and the signup trigger creates the matching
--   profiles automatically (which is itself worth exercising).
--
-- WHEN AN ASSERTION FAILS
--   Read the expected/actual columns. Test-ordering mistakes look like real
--   failures: mutating a game's kickoff earlier in the script can lock or
--   reveal a later week. Check the sequence before assuming the app is wrong.
-- ============================================================================

begin;

create temp table sim_results (
  id serial primary key, area text, scenario text,
  expected text, actual text, pass boolean
) on commit drop;

create function pg_temp.expect(a text, s text, e text, act text) returns void
language sql as $f$
  insert into sim_results(area,scenario,expected,actual,pass)
  values (a,s,e,act, e is not distinct from act);
$f$;

-- Impersonate a player. auth.uid() reads request.jwt.claims, so this is enough
-- for the SECURITY DEFINER functions; RLS tests additionally SET LOCAL ROLE.
create function pg_temp.act_as(u uuid) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub',u,'role','authenticated')::text, true);
$f$;

create function pg_temp.uid(n int) returns uuid language sql as $f$
  select ('9000000'||n||'-0000-0000-0000-000000000001')::uuid;
$f$;

-- ------------------------------------------------------------------ players
-- Ada = commissioner, Ben/Cal/Dee = players, Eve = removed member.
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,
                        created_at,updated_at,raw_user_meta_data)
select pg_temp.uid(n),'00000000-0000-0000-0000-000000000000',
       'authenticated','authenticated','sim'||n||'@test.invalid','x',now(),now(),
       json_build_object('display_name',(array['Ada','Ben','Cal','Dee','Eve'])[n])::jsonb
from generate_series(1,5) n;

insert into public.leagues (id,name,invite_code,season,created_by)
values ('7e57de51-0000-0000-0000-00000000000a','Sim League','SIMTEST9',9999,pg_temp.uid(1));

insert into public.league_members (league_id,user_id,role,status)
select '7e57de51-0000-0000-0000-00000000000a', pg_temp.uid(n),
       case when n=1 then 'admin' else 'player' end,
       case when n=5 then 'removed' else 'active' end
from generate_series(1,5) n;

-- ----------------------------------------------------------------- schedule
-- Weeks 1-2: played out. Week 3: a postponed game leaves the slate incomplete.
-- Week 4: the Sunday anchor has passed but a later game has not kicked off.
-- Week 5: entirely in the future, anchored on a real upcoming Sunday 1:00 ET.
-- (Jan 4/11/18/25 2026 are Sundays; 18:00Z = 1:00 PM EST.)
insert into public.games (id,espn_id,season,week,kickoff,home_team,away_team,
                          home_abbr,away_abbr,home_score,away_score,status) values
 ('a0000000-0000-0000-0000-000000000001','sim-w1-thu',9999,1,'2026-01-02 01:15+00','Kansas City','Baltimore','KC','BAL',31,27,'final'),
 ('a0000000-0000-0000-0000-000000000002','sim-w1-a',  9999,1,'2026-01-04 18:00+00','Buffalo','NY Jets','BUF','NYJ',24,20,'final'),
 ('a0000000-0000-0000-0000-000000000003','sim-w1-b',  9999,1,'2026-01-04 18:00+00','Detroit','Chicago','DET','CHI',38,10,'final'),
 ('a0000000-0000-0000-0000-000000000004','sim-w1-tie',9999,1,'2026-01-04 18:00+00','Green Bay','Minnesota','GB','MIN',17,17,'final'),
 ('a0000000-0000-0000-0000-000000000005','sim-w1-c',  9999,1,'2026-01-04 18:00+00','Philadelphia','Dallas','PHI','DAL',28,24,'final'),
 ('a0000000-0000-0000-0000-000000000006','sim-w1-425',9999,1,'2026-01-04 21:25+00','San Francisco','Seattle','SF','SEA',21,14,'final'),
 ('a0000000-0000-0000-0000-000000000007','sim-w1-snf',9999,1,'2026-01-05 01:20+00','LA Rams','Arizona','LAR','ARI',30,13,'final'),
 ('a0000000-0000-0000-0000-000000000008','sim-w1-mnf',9999,1,'2026-01-06 01:15+00','Tampa Bay','New Orleans','TB','NO',26,23,'final'),
 ('b0000000-0000-0000-0000-000000000001','sim-w2-a',  9999,2,'2026-01-11 18:00+00','New England','Miami','NE','MIA',34,14,'final'),
 ('b0000000-0000-0000-0000-000000000002','sim-w2-b',  9999,2,'2026-01-11 18:00+00','Cincinnati','Pittsburgh','CIN','PIT',27,24,'final'),
 ('b0000000-0000-0000-0000-000000000003','sim-w2-c',  9999,2,'2026-01-11 18:00+00','Houston','Indianapolis','HOU','IND',20,10,'final'),
 ('b0000000-0000-0000-0000-000000000004','sim-w2-d',  9999,2,'2026-01-11 18:00+00','Las Vegas','Denver','LV','DEN',13,30,'final'),
 ('b0000000-0000-0000-0000-000000000005','sim-w2-mnf',9999,2,'2026-01-12 01:15+00','Jacksonville','Tennessee','JAX','TEN',21,17,'final'),
 ('c0000000-0000-0000-0000-000000000001','sim-w3-a',  9999,3,'2026-01-18 18:00+00','Carolina','Atlanta','CAR','ATL',20,17,'final'),
 ('c0000000-0000-0000-0000-000000000002','sim-w3-ppd',9999,3,'2026-01-18 18:00+00','Cleveland','Washington','CLE','WAS',null,null,'scheduled'),
 ('d0000000-0000-0000-0000-000000000001','sim-w4-anc',9999,4,'2026-01-25 18:00+00','Baltimore','Cleveland','BAL','CLE',24,21,'final'),
 ('d0000000-0000-0000-0000-000000000002','sim-w4-late',9999,4, now()+interval '3 days','Seattle','Arizona','SEA','ARI',null,null,'scheduled');

insert into public.games (id,espn_id,season,week,kickoff,home_team,away_team,home_abbr,away_abbr,status)
select ('e0000000-0000-0000-0000-00000000000'||n)::uuid,'sim-w5-'||n,9999,5,
  case n
    when 1 then ((date_trunc('week',(now() at time zone 'America/New_York')+interval '2 weeks')+interval '3 days 20 hours') at time zone 'America/New_York')
    else        ((date_trunc('week',(now() at time zone 'America/New_York')+interval '2 weeks')+interval '6 days 13 hours') at time zone 'America/New_York')
  end,
  'Home'||n, 'Away'||n, 'H'||n, 'A'||n, 'scheduled'
from generate_series(1,6) n;

-- ------------------------------------------------------------ played weeks
-- Week 1 top-five WINNING scores: DET 38, KC 31, LAR 30, PHI 28, TB 26.
-- (GB/MIN 17-17 is a tie, so neither team is eligible for the top five.)
--   Ada  DET,KC,LAR,PHI,TB  in that order -> perfect slate, 153
--   Ben  same but SF(21) 5th             -> 148, no jackpot
--   Cal  right five, first two swapped   -> 153, no jackpot (order matters)
--   Dee  the tie + DET + KC, 3 picks     -> 69
--   Eve  removed member                  -> excluded everywhere
insert into public.picks (league_id,user_id,game_id,picked_home,pick_order,season,week) values
 ('7e57de51-0000-0000-0000-00000000000a','90000001-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003',true,1,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000001-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',true,2,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000001-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000007',true,3,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000001-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005',true,4,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000001-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000008',true,5,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000002-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003',true,1,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000002-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',true,2,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000002-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000007',true,3,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000002-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005',true,4,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000002-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000006',true,5,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000003-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',true,1,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000003-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003',true,2,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000003-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000007',true,3,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000003-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005',true,4,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000003-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000008',true,5,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000004-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004',true,1,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000004-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003',true,2,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000004-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',true,3,9999,1),
 ('7e57de51-0000-0000-0000-00000000000a','90000005-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003',true,1,9999,1),
 -- Week 2: Ada loses all five, Ben has a big week, Cal picks two.
 ('7e57de51-0000-0000-0000-00000000000a','90000001-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',false,1,9999,2),
 ('7e57de51-0000-0000-0000-00000000000a','90000001-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',false,2,9999,2),
 ('7e57de51-0000-0000-0000-00000000000a','90000001-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000003',false,3,9999,2),
 ('7e57de51-0000-0000-0000-00000000000a','90000001-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000004',true,4,9999,2),
 ('7e57de51-0000-0000-0000-00000000000a','90000001-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000005',false,5,9999,2),
 ('7e57de51-0000-0000-0000-00000000000a','90000002-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',true,1,9999,2),
 ('7e57de51-0000-0000-0000-00000000000a','90000002-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000004',false,2,9999,2),
 ('7e57de51-0000-0000-0000-00000000000a','90000002-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',true,3,9999,2),
 ('7e57de51-0000-0000-0000-00000000000a','90000002-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000005',true,4,9999,2),
 ('7e57de51-0000-0000-0000-00000000000a','90000002-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000003',true,5,9999,2),
 ('7e57de51-0000-0000-0000-00000000000a','90000003-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',true,1,9999,2),
 ('7e57de51-0000-0000-0000-00000000000a','90000003-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',true,2,9999,2);

select pg_temp.act_as(pg_temp.uid(1));

-- =================================================================== SETUP
select pg_temp.expect('setup','week 5 anchor resolves to a Sunday 1:00 PM ET','Sun 13:00',
 to_char(public.week_lock_anchor(9999,5) at time zone 'America/New_York','Dy HH24:MI'));
select pg_temp.expect('setup','week 3 left incomplete by a postponed game','1 unfinished',
 (select count(*) filter (where status<>'final') from public.games where season=9999 and week=3)::text||' unfinished');

-- ================================================================= SCORING
select pg_temp.expect('scoring','Ada week 1 total, five correct picks','153',
 (select total::text from public.get_overall_totals('7e57de51-0000-0000-0000-00000000000a',9999,1) where user_id=pg_temp.uid(1)));
select pg_temp.expect('scoring','Dee: tie scores 0, only three picks made','69',
 (select total::text from public.get_overall_totals('7e57de51-0000-0000-0000-00000000000a',9999,1) where user_id=pg_temp.uid(4)));
select pg_temp.expect('scoring','a tie counts as a loss on the W-L record','2-1',
 (select wins||'-'||losses from public.get_overall_totals('7e57de51-0000-0000-0000-00000000000a',9999,1) where user_id=pg_temp.uid(4)));
select pg_temp.expect('scoring','removed member excluded from standings','0',
 (select count(*)::text from public.get_overall_totals('7e57de51-0000-0000-0000-00000000000a',9999) where user_id=pg_temp.uid(5)));
select pg_temp.expect('scoring','Ada takes week 1 on the Pick-1 tiebreak (both on 153)','1',
 (select weeks_won::text from public.get_overall_totals('7e57de51-0000-0000-0000-00000000000a',9999,1) where user_id=pg_temp.uid(1)));
select pg_temp.expect('scoring','Cal loses that tiebreak','0',
 (select weeks_won::text from public.get_overall_totals('7e57de51-0000-0000-0000-00000000000a',9999,1) where user_id=pg_temp.uid(3)));
select pg_temp.expect('scoring','Ada blanks week 2, season total unchanged','153',
 (select total::text from public.get_overall_totals('7e57de51-0000-0000-0000-00000000000a',9999) where user_id=pg_temp.uid(1)));
select pg_temp.expect('scoring','Ben season total after two weeks','280',
 (select total::text from public.get_overall_totals('7e57de51-0000-0000-0000-00000000000a',9999) where user_id=pg_temp.uid(2)));

-- =========================================================== HALF-SEASON
select pg_temp.expect('reset','counting from week 2 only: Ben','132',
 (select total::text from public.get_overall_totals('7e57de51-0000-0000-0000-00000000000a',9999,null,2) where user_id=pg_temp.uid(2)));
select pg_temp.expect('reset','counting from week 2 only: Ada','0',
 (select total::text from public.get_overall_totals('7e57de51-0000-0000-0000-00000000000a',9999,null,2) where user_id=pg_temp.uid(1)));
select pg_temp.expect('movement','Ada leads the table through week 1','1',
 (select (rank() over (order by total desc, weeks_won desc))::text
  from public.get_overall_totals('7e57de51-0000-0000-0000-00000000000a',9999,1) where user_id=pg_temp.uid(1) limit 1));

-- ================================================================= JACKPOT
select pg_temp.expect('jackpot','Ada hits the perfect slate in week 1','1',
 (select count(*)::text from public.get_perfect_slates('7e57de51-0000-0000-0000-00000000000a',9999,1) where user_id=pg_temp.uid(1)));
select pg_temp.expect('jackpot','Ben missed the fifth-highest winner: no jackpot','0',
 (select count(*)::text from public.get_perfect_slates('7e57de51-0000-0000-0000-00000000000a',9999,1) where user_id=pg_temp.uid(2)));
select pg_temp.expect('jackpot','Cal had the right five in the wrong order: no jackpot','0',
 (select count(*)::text from public.get_perfect_slates('7e57de51-0000-0000-0000-00000000000a',9999,1) where user_id=pg_temp.uid(3)));
select pg_temp.expect('jackpot','exactly one winner league-wide, tie excluded from top five','1',
 (select count(*)::text from public.get_perfect_slates('7e57de51-0000-0000-0000-00000000000a',9999,1)));
select pg_temp.expect('jackpot','postponed game keeps week 3 ineligible','0',
 (select count(*)::text from public.get_perfect_slates('7e57de51-0000-0000-0000-00000000000a',9999,3)));

-- ==================================================================== LOCK
select pg_temp.act_as(pg_temp.uid(2));
do $$ begin
  perform public.save_picks('7e57de51-0000-0000-0000-00000000000a',9999,4,
    '[{"game_id":"d0000000-0000-0000-0000-000000000002","picked_home":true,"pick_order":1}]'::jsonb);
  perform pg_temp.expect('lock','Monday-night game after the Sunday 1:00 freeze','blocked','allowed');
exception when others then perform pg_temp.expect('lock','Monday-night game after the Sunday 1:00 freeze','blocked','blocked'); end $$;

select pg_temp.act_as(pg_temp.uid(1));
select public.save_picks('7e57de51-0000-0000-0000-00000000000a',9999,5,
 '[{"game_id":"e0000000-0000-0000-0000-000000000001","picked_home":true,"pick_order":1},
   {"game_id":"e0000000-0000-0000-0000-000000000002","picked_home":true,"pick_order":2},
   {"game_id":"e0000000-0000-0000-0000-000000000003","picked_home":false,"pick_order":3}]'::jsonb);
select pg_temp.expect('lock','picks accepted while the week is still open','3',
 (select count(*)::text from public.picks where season=9999 and week=5 and user_id=pg_temp.uid(1)));

-- ============================================================== VALIDATION
do $$ begin
  perform public.save_picks('7e57de51-0000-0000-0000-00000000000a',9999,5,
   '[{"game_id":"e0000000-0000-0000-0000-000000000001","picked_home":true,"pick_order":1},
     {"game_id":"e0000000-0000-0000-0000-000000000002","picked_home":true,"pick_order":2},
     {"game_id":"e0000000-0000-0000-0000-000000000003","picked_home":true,"pick_order":3},
     {"game_id":"e0000000-0000-0000-0000-000000000004","picked_home":true,"pick_order":4},
     {"game_id":"e0000000-0000-0000-0000-000000000005","picked_home":true,"pick_order":5},
     {"game_id":"e0000000-0000-0000-0000-000000000006","picked_home":true,"pick_order":5}]'::jsonb);
  perform pg_temp.expect('validation','a sixth pick','rejected','accepted');
exception when others then perform pg_temp.expect('validation','a sixth pick','rejected','rejected'); end $$;
do $$ begin
  perform public.save_picks('7e57de51-0000-0000-0000-00000000000a',9999,5,
   '[{"game_id":"e0000000-0000-0000-0000-000000000001","picked_home":true,"pick_order":1},
     {"game_id":"e0000000-0000-0000-0000-000000000002","picked_home":true,"pick_order":1}]'::jsonb);
  perform pg_temp.expect('validation','duplicate pick order','rejected','accepted');
exception when others then perform pg_temp.expect('validation','duplicate pick order','rejected','rejected'); end $$;
do $$ begin
  perform public.save_picks('7e57de51-0000-0000-0000-00000000000a',9999,5,
   '[{"game_id":"e0000000-0000-0000-0000-000000000001","picked_home":true,"pick_order":1},
     {"game_id":"e0000000-0000-0000-0000-000000000001","picked_home":false,"pick_order":2}]'::jsonb);
  perform pg_temp.expect('validation','both teams in the same game','rejected','accepted');
exception when others then perform pg_temp.expect('validation','both teams in the same game','rejected','rejected'); end $$;

-- =================================================================== AUDIT
select pg_temp.expect('audit','three picks logged as adds','3',
 (select count(*)::text from public.pick_audit where season=9999 and week=5 and change_type='add'));
select public.save_picks('7e57de51-0000-0000-0000-00000000000a',9999,5,
 '[{"game_id":"e0000000-0000-0000-0000-000000000004","picked_home":true,"pick_order":1},
   {"game_id":"e0000000-0000-0000-0000-000000000002","picked_home":true,"pick_order":2},
   {"game_id":"e0000000-0000-0000-0000-000000000003","picked_home":false,"pick_order":3}]'::jsonb);
select pg_temp.expect('audit','swapping slot 1 logs a replace','1',
 (select count(*)::text from public.pick_audit where season=9999 and week=5 and change_type='replace'));
select public.save_picks('7e57de51-0000-0000-0000-00000000000a',9999,5,
 '[{"game_id":"e0000000-0000-0000-0000-000000000004","picked_home":true,"pick_order":1},
   {"game_id":"e0000000-0000-0000-0000-000000000002","picked_home":true,"pick_order":2},
   {"game_id":"e0000000-0000-0000-0000-000000000003","picked_home":false,"pick_order":3}]'::jsonb);
select pg_temp.expect('audit','an identical re-save records nothing new','4',
 (select count(*)::text from public.pick_audit where season=9999 and week=5));

-- ==================================================================== FLEX
update public.games set kickoff = kickoff + interval '2 days'
 where id='e0000000-0000-0000-0000-000000000003';
select pg_temp.expect('flex','pick survives the NFL moving that game','1',
 (select count(*)::text from public.picks where game_id='e0000000-0000-0000-0000-000000000003'));

-- ============================================================== RULES GATE
insert into public.league_settings (league_id, rules_text, rules_required)
values ('7e57de51-0000-0000-0000-00000000000a','1. $20 buy-in.', true);
select pg_temp.act_as(pg_temp.uid(2));
do $$ begin
  perform public.save_picks('7e57de51-0000-0000-0000-00000000000a',9999,5,
   '[{"game_id":"e0000000-0000-0000-0000-000000000005","picked_home":true,"pick_order":1}]'::jsonb);
  perform pg_temp.expect('rules','player who has not accepted the rules','blocked','allowed');
exception when others then perform pg_temp.expect('rules','player who has not accepted the rules','blocked','blocked'); end $$;
select public.accept_league_rules('7e57de51-0000-0000-0000-00000000000a');
do $$ begin
  perform public.save_picks('7e57de51-0000-0000-0000-00000000000a',9999,5,
   '[{"game_id":"e0000000-0000-0000-0000-000000000005","picked_home":true,"pick_order":1}]'::jsonb);
  perform pg_temp.expect('rules','the same player after accepting','allowed','allowed');
exception when others then perform pg_temp.expect('rules','the same player after accepting','allowed','blocked'); end $$;

-- =========================================================== AUTHORISATION
select pg_temp.act_as(pg_temp.uid(1));
do $$ begin
  perform public.admin_set_score('7e57de51-0000-0000-0000-00000000000a',
    'e0000000-0000-0000-0000-000000000005',99,0,'final');
  perform pg_temp.expect('authz','league admin who is not the app owner','blocked','allowed');
exception when others then perform pg_temp.expect('authz','league admin who is not the app owner','blocked','blocked'); end $$;

-- ================================================================== REVEAL
set local role authenticated;
select pg_temp.act_as(pg_temp.uid(2));
select set_config('sim.w1',(select count(*) from public.picks where season=9999 and week=1 and user_id=pg_temp.uid(1))::text,true);
select set_config('sim.w5',(select count(*) from public.picks where season=9999 and week=5 and user_id=pg_temp.uid(1))::text,true);
reset role;
select pg_temp.expect('reveal','league mate sees week 1 picks once the lock has passed','5',current_setting('sim.w1'));
select pg_temp.expect('reveal','league mate cannot see week 5 picks while it is open','0',current_setting('sim.w5'));

-- ============================ FLEXING THE SLATE ITSELF =====================
-- The NFL moves the anchor game earlier, into the past. The whole week must
-- freeze at once and every pick in it becomes visible.
update public.games set kickoff='2026-01-04 18:00+00' where id='e0000000-0000-0000-0000-000000000002';
select pg_temp.expect('flex','moving the anchor recomputes the week lock','Sun 13:00',
 to_char(public.week_lock_anchor(9999,5) at time zone 'America/New_York','Dy HH24:MI'));
select pg_temp.act_as(pg_temp.uid(2));
do $$ begin
  perform public.save_picks('7e57de51-0000-0000-0000-00000000000a',9999,5,
   '[{"game_id":"e0000000-0000-0000-0000-000000000006","picked_home":true,"pick_order":2}]'::jsonb);
  perform pg_temp.expect('flex','week freezes once the flexed anchor has passed','blocked','allowed');
exception when others then perform pg_temp.expect('flex','week freezes once the flexed anchor has passed','blocked','blocked'); end $$;
set local role authenticated;
select pg_temp.act_as(pg_temp.uid(2));
select set_config('sim.w5b',(select count(*) from public.picks where season=9999 and week=5 and user_id=pg_temp.uid(1))::text,true);
reset role;
select pg_temp.expect('reveal','picks become visible once the flexed lock passes','3',current_setting('sim.w5b'));

-- ================================================================== RESULTS
select * from (
  select id, area, scenario,
         case when pass then 'PASS' else 'FAIL' end as result, expected, actual
  from sim_results
  union all
  select 999999, 'TOTAL', count(*)||' assertions',
         case when bool_and(pass) then 'ALL PASS'
              else (count(*) filter (where not pass))||' FAILED' end,
         null, null
  from sim_results
) t order by id;

rollback;
