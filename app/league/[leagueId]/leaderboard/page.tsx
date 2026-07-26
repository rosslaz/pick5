import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureGamesSynced } from "@/lib/sync";
import { latestActiveWeek } from "@/lib/weeks";
import { buildWeeklyBoard } from "@/lib/scoring";
import { TOTAL_WEEKS } from "@/lib/config";
import { WeekPicker } from "@/components/week-picker";
import { LeaderboardTable, type BoardRow } from "./leaderboard-table";
import type { League, MemberRow, PickRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: { leagueId: string };
  searchParams: { week?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, invite_code, season")
    .eq("id", params.leagueId)
    .maybeSingle<League>();
  if (!league) redirect("/");

  await ensureGamesSynced(supabase, league.id, league.season);

  // Roster via function: display names for everyone, emails only for admins
  // (fix #11 — the profiles embed exposed every member's address).
  const { data: roster } = await supabase.rpc("get_league_roster", {
    p_league_id: league.id,
  });
  const members: MemberRow[] = (
    (roster as
      | {
          user_id: string;
          display_name: string;
          email: string | null;
          role: string;
          status: string;
          joined_at: string;
        }[]
      | null) ?? []
  ).map((m) => ({
    user_id: m.user_id,
    role: m.role as MemberRow["role"],
    status: m.status as MemberRow["status"],
    joined_at: m.joined_at,
    profiles: { display_name: m.display_name, email: m.email ?? "" },
  }));

  // One season-wide games read, reused for both the week picker and the
  // week-completion map used by the movement arrows (fix #16 — this was two
  // separate full-table reads per render).
  const { data: seasonGames } = await supabase
    .from("games")
    .select("week, status, kickoff")
    .eq("season", league.season)
    .returns<{ week: number; status: string; kickoff: string }[]>();
  const allGames = seasonGames ?? [];
  const currentWeek = latestActiveWeek(allGames);

  const requested = Number(searchParams.week);
  const week =
    Number.isInteger(requested) && requested >= 1 && requested <= TOTAL_WEEKS
      ? requested
      : currentWeek;

  // Only the selected week's picks are fetched in full (RLS governs what the
  // viewer may see). A whole-season fetch would silently truncate at the
  // API's 1000-row cap in a large league.
  const { data: weekPicks } = await supabase
    .from("picks")
    .select("*, games(*)")
    .eq("league_id", league.id)
    .eq("season", league.season)
    .eq("week", week)
    .returns<PickRow[]>();

  // Which slots have a saved pick this week (no pick details), so submitted-
  // but-hidden renders differently from not-submitted.
  const { data: slotRows } = await supabase.rpc("get_pick_slots", {
    p_league_id: league.id,
    p_season: league.season,
    p_week: week,
  });
  const submittedSlots = new Set<string>(
    ((slotRows as { user_id: string; pick_order: number }[] | null) ?? []).map(
      (s) => `${s.user_id}:${s.pick_order}`
    )
  );

  // Half-season segment: read through a member-visible function. Reading
  // league_settings directly returned zero rows for non-admins (admin-only
  // RLS), so players silently saw full-season standings while the commissioner
  // saw the windowed ones (fix #2).
  const { data: windowWeek } = await supabase.rpc("get_scoring_window", {
    p_league_id: league.id,
  });
  const scoreFromWeek: number | null = (windowWeek as number | null) ?? null;

  // Season totals aggregated in the database (scales past the row cap and
  // respects the Sunday-slate reveal rule).
  const { data: overall } = await supabase.rpc("get_overall_totals", {
    p_league_id: league.id,
    p_season: league.season,
    p_from_week: scoreFromWeek,
  });
  const overallMap = new Map<
    string,
    { total: number; weeks_won: number; wins: number; losses: number }
  >(
    (
      (overall as
        | { user_id: string; total: number; weeks_won: number; wins: number; losses: number }[]
        | null) ?? []
    ).map((o) => [
      o.user_id,
      { total: o.total, weeks_won: o.weeks_won, wins: o.wins, losses: o.losses },
    ])
  );

  const memberList = members;
  const weekly = buildWeeklyBoard(memberList, weekPicks ?? [], user.id, submittedSlots);

  // Perfect-slate jackpot: flag anyone who nailed the 5 highest-scoring winning
  // teams in exact order this week. The function self-gates on a fully-final
  // week, so this returns nothing (and reveals nothing) before the week locks.
  const { data: perfect } = await supabase.rpc("get_perfect_slates", {
    p_league_id: league.id,
    p_season: league.season,
    p_week: week,
  });
  const perfectSet = new Set(
    ((perfect as { user_id: string }[] | null) ?? []).map((p) => p.user_id)
  );

  const rows: BoardRow[] = weekly.map((r) => {
    const o = overallMap.get(r.userId);
    return {
      ...r,
      overallTotal: o?.total ?? 0,
      weeksWon: o?.weeks_won ?? 0,
      wins: o?.wins ?? 0,
      losses: o?.losses ?? 0,
      overallRank: 0,
      movement: 0,
      perfectSlate: perfectSet.has(r.userId),
    };
  });

  // Overall ranks (ties share a rank), independent of the display sort.
  const byOverall = [...rows].sort(
    (a, b) =>
      b.overallTotal - a.overallTotal || b.weeksWon - a.weeksWon || a.name.localeCompare(b.name)
  );
  byOverall.forEach((r, i) => {
    const prev = byOverall[i - 1];
    r.overallRank =
      i > 0 && prev.overallTotal === r.overallTotal && prev.weeksWon === r.weeksWon
        ? prev.overallRank
        : i + 1;
  });

  // Movement arrow: the change in overall rank caused by the last COMPLETED
  // week. Fix #4: this previously compared the live standings (which include
  // points from the in-progress week as games finish) against the standings
  // two weeks back, so the arrow drifted mid-week and spanned more than the
  // one week its tooltip claimed. Both sides are now settled snapshots.
  const weekDone = new Map<number, boolean>();
  for (const g of allGames) {
    weekDone.set(g.week, (weekDone.get(g.week) ?? true) && g.status === "final");
  }
  const lastCompleted = Math.max(
    0,
    ...Array.from(weekDone.entries())
      .filter(([, done]) => done)
      .map(([w]) => w)
  );
  const segmentStart = scoreFromWeek ?? 1;
  const completedInSegment = lastCompleted - segmentStart + 1;
  if (completedInSegment >= 2) {
    const [priorRes, settledRes] = await Promise.all([
      supabase.rpc("get_overall_totals", {
        p_league_id: league.id,
        p_season: league.season,
        p_through_week: lastCompleted - 1,
        p_from_week: scoreFromWeek,
      }),
      supabase.rpc("get_overall_totals", {
        p_league_id: league.id,
        p_season: league.season,
        p_through_week: lastCompleted,
        p_from_week: scoreFromWeek,
      }),
    ]);

    type Totals = { user_id: string; total: number; weeks_won: number };
    const ids = rows.map((r) => r.userId);
    const rankSnapshot = (data: unknown) => {
      const map = new Map(
        ((data as Totals[] | null) ?? []).map((o) => [
          o.user_id,
          { total: o.total, weeks_won: o.weeks_won },
        ])
      );
      const ordered = ids
        .map((id) => ({ id, ...(map.get(id) ?? { total: 0, weeks_won: 0 }) }))
        .sort((a, b) => b.total - a.total || b.weeks_won - a.weeks_won);
      const ranks = new Map<string, number>();
      ordered.forEach((r, i) => {
        const prev = ordered[i - 1];
        ranks.set(
          r.id,
          i > 0 && prev.total === r.total && prev.weeks_won === r.weeks_won
            ? ranks.get(prev.id)!
            : i + 1
        );
      });
      return ranks;
    };

    const priorRank = rankSnapshot(priorRes.data);
    const settledRank = rankSnapshot(settledRes.data);
    for (const r of rows) {
      const was = priorRank.get(r.userId);
      const nowRank = settledRank.get(r.userId);
      r.movement = was && nowRank ? was - nowRank : 0; // + = moved up
    }
  }

  const isAdmin = memberList.some(
    (m) => m.user_id === user.id && m.role === "admin" && m.status === "active"
  );

  return (
    <main>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-3xl">
          Leaderboard <span className="text-amber">— Week {week}</span>
        </h1>
        <span className="text-xs text-muted">
          Everyone&apos;s picks appear once the Sunday 1:00 ET lock passes
        </span>
      </div>
      <WeekPicker
        basePath={`/league/${league.id}/leaderboard`}
        selected={week}
        current={currentWeek}
      />
      <LeaderboardTable
        rows={rows}
        viewerId={user.id}
        isAdmin={isAdmin}
        week={week}
        leagueName={league.name}
      />
      <p className="mt-2 text-xs text-muted">
        You&apos;re always pinned to the top row with your true rank · # = weekly rank
        (overall rank when sorted by Overall) · W-L next to each name = season pick record;
        a tied game counts as a loss · <b className="text-win">green</b> = winning pick with the
        points it scored · <b className="text-loss">red</b> = losing pick · grey = not played yet ·
        🔒 pick submitted, hidden until the Sunday 1:00 ET lock — after that every pick is
        visible, including Sunday night and Monday night · -- no pick submitted · Week ties
        break by Pick 1 points, then Pick 2, and so on · Overall ties break by weeks won.
      </p>
    </main>
  );
}
