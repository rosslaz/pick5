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

  await ensureGamesSynced(supabase, league.season);

  const { data: members } = await supabase
    .from("league_members")
    .select("user_id, role, status, joined_at, profiles(display_name, email)")
    .eq("league_id", league.id)
    .returns<MemberRow[]>();

  const { data: weekMeta } = await supabase
    .from("games")
    .select("week, status, kickoff")
    .eq("season", league.season);
  const currentWeek = latestActiveWeek(weekMeta ?? []);

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

  // Half-season segment: if the commish set a "count from week N" marker, the
  // overall standings (and movement) count only weeks >= N. Null = whole season.
  const { data: lbSettings } = await supabase
    .from("league_settings")
    .select("score_from_week")
    .eq("league_id", league.id)
    .maybeSingle();
  const scoreFromWeek: number | null = lbSettings?.score_from_week ?? null;

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

  const memberList = members ?? [];
  const weekly = buildWeeklyBoard(memberList, weekPicks ?? [], user.id, submittedSlots);
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

  // Movement arrow: compare each player's current overall rank to their rank
  // as of the previous completed week. Only meaningful once 2+ weeks are done.
  const weekDone = new Map<number, boolean>();
  for (const g of (await supabase
    .from("games")
    .select("week, status")
    .eq("season", league.season)
    .returns<{ week: number; status: string }[]>()).data ?? []) {
    weekDone.set(g.week, (weekDone.get(g.week) ?? true) && g.status === "final");
  }
  const lastCompleted = Math.max(
    0,
    ...Array.from(weekDone.entries())
      .filter(([, done]) => done)
      .map(([w]) => w)
  );
  // Within a half-season segment, movement is only meaningful once 2+ weeks
  // *inside* the segment are complete, and the prior snapshot must not dip
  // below the segment's start week.
  const segmentStart = scoreFromWeek ?? 1;
  const completedInSegment = lastCompleted - segmentStart + 1;
  if (completedInSegment >= 2) {
    const { data: prior } = await supabase.rpc("get_overall_totals", {
      p_league_id: league.id,
      p_season: league.season,
      p_through_week: lastCompleted - 1,
      p_from_week: scoreFromWeek,
    });
    const priorMap = new Map<string, { total: number; weeks_won: number }>(
      ((prior as { user_id: string; total: number; weeks_won: number }[] | null) ?? []).map((o) => [
        o.user_id,
        { total: o.total, weeks_won: o.weeks_won },
      ])
    );
    const priorRanked = [...rows]
      .map((r) => ({ userId: r.userId, ...(priorMap.get(r.userId) ?? { total: 0, weeks_won: 0 }) }))
      .sort((a, b) => b.total - a.total || b.weeks_won - a.weeks_won);
    const priorRank = new Map<string, number>();
    priorRanked.forEach((r, i) => {
      const prev = priorRanked[i - 1];
      priorRank.set(
        r.userId,
        i > 0 && prev.total === r.total && prev.weeks_won === r.weeks_won
          ? priorRank.get(prev.userId)!
          : i + 1
      );
    });
    for (const r of rows) {
      const was = priorRank.get(r.userId);
      r.movement = was ? was - r.overallRank : 0; // + = moved up
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
          Opponent picks stay hidden until the Sunday 1:00 ET slate kicks off
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
        a tied game counts as a loss · 🔒 pick submitted, hidden until the Sunday 1:00 slate
        (later games reveal at their own kickoff) · -- no pick submitted · Week ties break
        by Pick 1 points, then Pick 2, and so on · Overall ties break by weeks won.
      </p>
    </main>
  );
}
