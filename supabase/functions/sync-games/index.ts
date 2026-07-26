// Supabase Edge Function: pulls NFL schedule + scores from ESPN's public API
// and upserts them into the games table. Runs with the service role key that
// Supabase injects into the edge runtime, so it can write past RLS while the
// browser cannot.
//
// Authorization: callers must be an active member of the league they name, and
// a full-season pull additionally requires league admin (18 ESPN round trips).
//
// Security note: season and week arrive from the request body and are
// interpolated into the ESPN URL. TypeScript types are erased at runtime, so a
// client could previously send a string and append arbitrary query parameters.
// The host is hard-coded so this was never SSRF, but both values are now
// coerced to integers and range-checked before use.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SEASON_TYPE_REGULAR = 2;
const TOTAL_WEEKS = 18;

interface SyncBody {
  season?: unknown;
  week?: unknown;
  full?: unknown;
  league_id?: unknown;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict integer parse: rejects strings with trailing junk, floats, NaN. */
function intInRange(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = (await req.json()) as SyncBody;

    const season = intInRange(body.season, 2000, 2100);
    if (season === null) return json({ error: "season must be a year between 2000 and 2100" }, 400);

    const leagueId = typeof body.league_id === "string" ? body.league_id : "";
    if (!UUID_RE.test(leagueId)) return json({ error: "league_id must be a UUID" }, 400);

    const full = body.full === true;
    let week: number | null = null;
    if (!full) {
      week = intInRange(body.week ?? 1, 1, TOTAL_WEEKS);
      if (week === null) return json({ error: `week must be between 1 and ${TOTAL_WEEKS}` }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // --- Authorization ------------------------------------------------------
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const { data: member } = await service
      .from("league_members")
      .select("role, status")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member || member.status !== "active") {
      return json({ error: "You are not an active member of this league" }, 403);
    }
    if (full && member.role !== "admin") {
      return json({ error: "Only a commissioner can re-sync the full season" }, 403);
    }

    const weeks = full
      ? Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1)
      : [week as number];

    const rows: GameRow[] = [];
    const failedWeeks: number[] = [];
    for (const w of weeks) {
      // NOTE: the season selector on this endpoint is `dates=YYYY` — a `year=`
      // parameter is silently ignored and ESPN falls back to its default
      // (often the *previous* season). mapEvent double-checks each event's own
      // season stamp. Values here are validated integers, not raw input.
      const espnUrl =
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
        `?dates=${season}&seasontype=${SEASON_TYPE_REGULAR}&week=${w}`;
      try {
        const res = await fetch(espnUrl);
        if (!res.ok) {
          failedWeeks.push(w);
          continue;
        }
        const data = await res.json();
        for (const event of data.events ?? []) {
          const row = mapEvent(event, season, w);
          if (row) rows.push(row);
        }
      } catch {
        failedWeeks.push(w);
      }
    }

    let pinnedSkipped = 0;
    let upserted = 0;
    if (rows.length > 0) {
      // Never overwrite a game an admin has manually corrected.
      const { data: pinned, error: pinErr } = await service
        .from("games")
        .select("espn_id")
        .eq("manual_override", true);
      if (pinErr) return json({ error: pinErr.message }, 500);
      const pinnedIds = new Set((pinned ?? []).map((p: { espn_id: string }) => p.espn_id));
      const writable = rows.filter((r) => !pinnedIds.has(r.espn_id));
      pinnedSkipped = rows.length - writable.length;

      if (writable.length > 0) {
        const { error } = await service
          .from("games")
          .upsert(writable, { onConflict: "espn_id" });
        if (error) return json({ error: error.message }, 500);
      }
      upserted = writable.length;
    }

    // Report honestly: a partial sync must not look like a clean one (#9).
    return json({
      upserted,
      pinned: pinnedSkipped,
      requested_weeks: weeks.length,
      failed_weeks: failedWeeks,
    });
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
  const typeName = String(comp.status?.type?.name ?? "").toUpperCase();
  const abandoned =
    typeName.includes("POSTPONED") ||
    typeName.includes("CANCELED") ||
    typeName.includes("CANCELLED") ||
    typeName.includes("SUSPENDED");

  // #15: a postponed/cancelled game can report state "post" with
  // completed=false. Treating that as final would score every pick on it as a
  // 0-0 tie (a loss for everyone) and skew perfect-slate detection. Only a
  // genuinely completed game is final; anything abandoned reverts to scheduled
  // with no scores until ESPN gives it a real result.
  let status: GameRow["status"] = "scheduled";
  if (abandoned) status = "scheduled";
  else if (completed) status = "final";
  else if (state === "in") status = "in_progress";

  const hasScore = !abandoned && status !== "scheduled";
  const weekNum = Number(event?.week?.number ?? week);

  return {
    espn_id: String(event.id),
    season,
    week: Number.isInteger(weekNum) && weekNum >= 1 && weekNum <= TOTAL_WEEKS ? weekNum : week,
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
