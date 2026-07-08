import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureGamesSynced } from "@/lib/sync";
import { latestActiveWeek } from "@/lib/weeks";
import { buildOverallBoard, buildWeeklyBoard, type Slot } from "@/lib/scoring";
import { TOTAL_WEEKS } from "@/lib/config";
import { WeekPicker } from "@/components/week-picker";
import type { Game, League, MemberRow, PickRow } from "@/lib/types";

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

  // Picks visible to the viewer are governed by RLS: opponents' picks only
  // appear once their game has kicked off.
  const { data: allPicks } = await supabase
    .from("picks")
    .select("*, games(*)")
    .eq("league_id", league.id)
    .eq("season", league.season)
    .returns<PickRow[]>();

  const picks = allPicks ?? [];
  const memberList = members ?? [];
  const weeklyPicks = picks.filter((p) => p.week === week);

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

  const weekly = buildWeeklyBoard(memberList, weeklyPicks, user.id, submittedSlots);

  const { data: allGamesMeta } = await supabase
    .from("games")
    .select("week, status")
    .eq("season", league.season)
    .returns<Pick<Game, "week" | "status">[]>();
  const overall = buildOverallBoard(memberList, picks, allGamesMeta ?? [], user.id);

  return (
    <main>
      <h1 className="mb-3 text-3xl">Leaderboard</h1>

      <section className="mb-8">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-2xl text-amber">Week {week}</h2>
          <span className="text-xs text-muted">
            Opponent picks reveal at each game&apos;s kickoff
          </span>
        </div>
        <WeekPicker
          basePath={`/league/${league.id}/leaderboard`}
          selected={week}
          current={currentWeek}
        />
        <div className="card overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs uppercase text-muted">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Player</th>
                {[1, 2, 3, 4, 5].map((n) => (
                  <th key={n} className="px-2 py-2 text-center font-medium">
                    P{n}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {weekly.map((row) => (
                <tr
                  key={row.userId}
                  className={`border-b border-line/60 ${
                    row.userId === user.id ? "bg-amber/5" : ""
                  }`}
                >
                  <td className="px-3 py-2 font-display text-lg text-muted">{row.rank}</td>
                  <td className="px-3 py-2 font-semibold">
                    {row.name}
                    {row.userId === user.id && (
                      <span className="ml-1 text-xs text-amber">you</span>
                    )}
                  </td>
                  {row.slots.map((slot, i) => (
                    <td key={i} className="px-2 py-2 text-center">
                      <SlotCell slot={slot} />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <span className="score-cell">{row.total}</span>
                  </td>
                </tr>
              ))}
              {weekly.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted">
                    No active players yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          🔒 pick submitted, hidden until kickoff · -- no pick submitted · Tiebreaker:
          highest Pick 1 points, then Pick 2, and so on.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-2xl text-amber">Overall</h2>
        <div className="card overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs uppercase text-muted">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Player</th>
                <th className="px-3 py-2 text-center font-medium">Weeks won</th>
                <th className="px-3 py-2 text-right font-medium">Season total</th>
              </tr>
            </thead>
            <tbody>
              {overall.map((row) => (
                <tr
                  key={row.userId}
                  className={`border-b border-line/60 ${
                    row.userId === user.id ? "bg-amber/5" : ""
                  }`}
                >
                  <td className="px-3 py-2 font-display text-lg text-muted">{row.rank}</td>
                  <td className="px-3 py-2 font-semibold">
                    {row.name}
                    {row.userId === user.id && (
                      <span className="ml-1 text-xs text-amber">you</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center text-muted">{row.weeksWon}</td>
                  <td className="px-3 py-2 text-right">
                    <span className="score-cell">{row.total}</span>
                  </td>
                </tr>
              ))}
              {overall.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted">
                    No active players yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Overall ties broken by number of weeks won.
        </p>
      </section>
    </main>
  );
}

function SlotCell({ slot }: { slot: Slot }) {
  if (slot.kind === "empty")
    return (
      <span className="score-cell dim" title="No pick submitted">
        --
      </span>
    );
  if (slot.kind === "hidden")
    return (
      <span className="score-cell dim" title="Pick submitted — hidden until kickoff">
        🔒
      </span>
    );

  const { result, pick, game } = slot;
  const abbr = pick.picked_home ? game.home_abbr : game.away_abbr;

  if (result.state === "win")
    return (
      <span className="score-cell" title={`${abbr} won`}>
        {result.points}
      </span>
    );
  if (result.state === "loss")
    return (
      <span className="score-cell dim" title={`${abbr} lost`}>
        0
      </span>
    );
  if (result.state === "tie")
    return (
      <span className="score-cell dim" title="Tie — no points">
        0
      </span>
    );
  if (result.state === "live")
    return (
      <span className="score-cell live pulse-live" title={`${abbr} — in progress`}>
        {abbr}
      </span>
    );
  return (
    <span className="score-cell dim" title={`${abbr} — not started`}>
      {abbr}
    </span>
  );
}
