// Supabase Edge Function: pulls NFL schedule + scores from ESPN's public API
// and upserts them into the games table. Runs with the service role key that
// Supabase injects into the edge runtime, so it can write past RLS while the
// browser cannot.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SEASON_TYPE_REGULAR = 2;

interface SyncBody {
  season: number;
  week?: number;
  full?: boolean;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = (await req.json()) as SyncBody;
    const season = body.season;
    if (!season) {
      return json({ error: "season is required" }, 400);
    }

    const weeks = body.full
      ? Array.from({ length: 18 }, (_, i) => i + 1)
      : [body.week ?? 1];

    const rows: GameRow[] = [];
    for (const week of weeks) {
      // NOTE: the season selector on this endpoint is `dates=YYYY` — a `year=`
      // parameter is silently ignored and ESPN falls back to its default
      // (often the *previous* season), which is how we once loaded 2025 games
      // labeled as 2026. mapEvent double-checks each event's own season stamp.
      const url =
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
        `?dates=${season}&seasontype=${SEASON_TYPE_REGULAR}&week=${week}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      for (const event of data.events ?? []) {
        const row = mapEvent(event, season, week);
        if (row) rows.push(row);
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let pinnedSkipped = 0;
    if (rows.length > 0) {
      // Never overwrite a game an admin has manually corrected.
      const { data: pinned, error: pinErr } = await supabase
        .from("games")
        .select("espn_id")
        .eq("manual_override", true);
      if (pinErr) return json({ error: pinErr.message }, 500);
      const pinnedIds = new Set((pinned ?? []).map((p: { espn_id: string }) => p.espn_id));
      const writable = rows.filter((r) => !pinnedIds.has(r.espn_id));
      pinnedSkipped = rows.length - writable.length;

      if (writable.length > 0) {
        const { error } = await supabase
          .from("games")
          .upsert(writable, { onConflict: "espn_id" });
        if (error) return json({ error: error.message }, 500);
      }
      return json({ upserted: writable.length, pinned: pinnedSkipped });
    }

    return json({ upserted: rows.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "sync failed" }, 500);
  }
});

interface GameRow {
  espn_id: string;
  season: number;
  week: number;
  kickoff: string;
  home_team: string;
  away_team: string;
  home_abbr: string;
  away_abbr: string;
  home_logo: string | null;
  away_logo: string | null;
  home_score: number | null;
  away_score: number | null;
  status: "scheduled" | "in_progress" | "final";
  updated_at: string;
}

// deno-lint-ignore no-explicit-any
function mapEvent(event: any, season: number, week: number): GameRow | null {
  // Trust the event's own stamps over our request parameters: if ESPN handed
  // back a different season (or non-regular-season) game, refuse it.
  if (event?.season?.year != null && Number(event.season.year) !== season) return null;
  if (event?.season?.type != null && Number(event.season.type) !== SEASON_TYPE_REGULAR) {
    return null;
  }

  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const competitors = comp.competitors ?? [];
  const home = competitors.find((c: any) => c.homeAway === "home");
  const away = competitors.find((c: any) => c.homeAway === "away");
  if (!home || !away) return null;

  const state = comp.status?.type?.state; // "pre" | "in" | "post"
  const completed = comp.status?.type?.completed === true;
  let status: GameRow["status"] = "scheduled";
  if (completed || state === "post") status = "final";
  else if (state === "in") status = "in_progress";

  const hasScore = status !== "scheduled";

  return {
    espn_id: String(event.id),
    season,
    week: Number(event?.week?.number ?? week),
    kickoff: comp.date ?? event.date,
    home_team: home.team?.displayName ?? home.team?.name ?? "Home",
    away_team: away.team?.displayName ?? away.team?.name ?? "Away",
    home_abbr: home.team?.abbreviation ?? "HOME",
    away_abbr: away.team?.abbreviation ?? "AWAY",
    home_logo: home.team?.logo ?? null,
    away_logo: away.team?.logo ?? null,
    home_score: hasScore ? Number(home.score ?? 0) : null,
    away_score: hasScore ? Number(away.score ?? 0) : null,
    status,
    updated_at: new Date().toISOString(),
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
