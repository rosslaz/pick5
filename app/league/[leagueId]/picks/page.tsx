import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureGamesSynced } from "@/lib/sync";
import { computeCurrentWeek } from "@/lib/weeks";
import { TOTAL_WEEKS } from "@/lib/config";
import { WeekPicker } from "@/components/week-picker";
import { PicksForm } from "./picks-form";
import type { Game, League, PickRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PicksPage({
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

  const { data: allWeeks } = await supabase
    .from("games")
    .select("week, status, kickoff")
    .eq("season", league.season);
  const currentWeek = computeCurrentWeek(allWeeks ?? []);

  const requested = Number(searchParams.week);
  const week =
    Number.isInteger(requested) && requested >= 1 && requested <= TOTAL_WEEKS
      ? requested
      : currentWeek;

  const { data: games } = await supabase
    .from("games")
    .select("*")
    .eq("season", league.season)
    .eq("week", week)
    .order("kickoff", { ascending: true })
    .returns<Game[]>();

  const { data: picks } = await supabase
    .from("picks")
    .select("game_id, picked_home, pick_order")
    .eq("league_id", league.id)
    .eq("user_id", user.id)
    .eq("season", league.season)
    .eq("week", week)
    .returns<Pick<PickRow, "game_id" | "picked_home" | "pick_order">[]>();

  return (
    <main>
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-3xl">Week {week} picks</h1>
        <span className="text-sm text-muted">Picks lock at each game&apos;s kickoff</span>
      </div>
      <WeekPicker
        basePath={`/league/${league.id}/picks`}
        selected={week}
        current={currentWeek}
      />
      {!games || games.length === 0 ? (
        <div className="card p-6 text-muted">
          No games loaded for week {week} yet. Your commissioner can pull the schedule from
          the Admin tab.
        </div>
      ) : (
        <PicksForm
          leagueId={league.id}
          season={league.season}
          week={week}
          games={games}
          initialPicks={picks ?? []}
        />
      )}
    </main>
  );
}
