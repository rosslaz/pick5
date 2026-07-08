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

  // Season totals aggregated in the database (scales past the row cap and
  // respects the Sunday-slate reveal rule).
  const { data: overall } = await supabase.rpc("get_overall_totals", {
    p_league_id: league.id,
    p_season: league.season,
  });
  const overallMap = new Map<string, { total: number; weeks_won: number }>(
    ((overall as { user_id: string; total: number; weeks_won: number }[] | null) ?? []).map(
      (o) => [o.user_id, { total: o.total, weeks_won: o.weeks_won }]
    )
  );

  const memberList = members ?? [];
  const weekly = buildWeeklyBoard(memberList, weekPicks ?? [], user.id, submittedSlots);
  const rows: BoardRow[] = weekly.map((r) => ({
    ...r,
    overallTotal: overallMap.get(r.userId)?.total ?? 0,
    weeksWon: overallMap.get(r.userId)?.weeks_won ?? 0,
  }));

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
      <LeaderboardTable rows={rows} viewerId={user.id} />
      <p className="mt-2 text-xs text-muted">
        # = weekly rank · 🔒 pick submitted, hidden until the Sunday 1:00 slate (later games
        reveal at their own kickoff) · -- no pick submitted · Week ties break by Pick 1
        points, then Pick 2, and so on · Overall ties break by weeks won (hover an Overall
        total to see them).
      </p>
    </main>
  );
}
