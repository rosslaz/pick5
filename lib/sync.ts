import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { computeCurrentWeek } from "@/lib/weeks";

const LIVE_STALE_MS = 2 * 60 * 1000; // during games: refresh every 2 minutes
const IDLE_STALE_MS = 6 * 60 * 60 * 1000; // otherwise: every 6 hours (kickoff changes, flexed games)

export async function invokeSync(
  accessToken: string,
  body: { season: number; week?: number; full?: boolean }
) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-games`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`sync-games failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Keeps the games table fresh without a paid cron: any page load checks staleness
 * and triggers the edge function (which pulls from ESPN) when needed.
 */
export async function ensureGamesSynced(supabase: SupabaseClient, season: number) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;

    const { data: games } = await supabase
      .from("games")
      .select("week, status, kickoff, updated_at")
      .eq("season", season);

    if (!games || games.length === 0) {
      // First run: pull the full season schedule.
      await invokeSync(token, { season, full: true });
      return;
    }

    const now = Date.now();
    const week = computeCurrentWeek(games);
    const weekGames = games.filter((g) => g.week === week);

    const liveStale = weekGames.some(
      (g) =>
        g.status !== "final" &&
        new Date(g.kickoff).getTime() <= now &&
        now - new Date(g.updated_at).getTime() > LIVE_STALE_MS
    );
    const idleStale = weekGames.some(
      (g) => g.status !== "final" && now - new Date(g.updated_at).getTime() > IDLE_STALE_MS
    );

    if (liveStale || idleStale) {
      await invokeSync(token, { season, week });
    }
  } catch (err) {
    // Never take the page down because ESPN hiccupped.
    console.error("[sync] skipped:", err);
  }
}
