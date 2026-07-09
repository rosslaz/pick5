// Supabase Edge Function: sends pick reminders via Brevo, keyed off each
// upcoming kickoff and a per-league lead time. See pick5-email-reminders-
// decision.md for the provider decision.
//
// Two reminder types:
//   * "slate"     — the Sunday 1:00 PM ET mass lock. One per person per week:
//                   "you have X hours before all your picks lock."
//   * a game id   — a standalone game that locks before (or after) the slate:
//                   "you have X hours to get your pick in for AWAY vs HOME."
//                   Only sent to players who could still pick that game
//                   (fewer than 5 picks AND haven't already picked it).
//
// A run reminds about any kickoff falling within the league's lead-time
// window. A dedupe table (reminder_log) guarantees each (person, key) is
// emailed at most once, so the hourly cron is safe to re-run.
//
// Entry modes:
//   * Scheduled: pg_cron calls hourly with an x-reminder-secret header;
//     processes every league that has reminders enabled.
//   * Test: a league admin triggers from the Admin screen with their own
//     login; processes just that league, finds the next scheduled game (no
//     horizon cap), and emails the caller one representative reminder.
import { createClient } from "jsr:@supabase/supabase-js@2";

const PICKS_PER_WEEK = 5;
const DAILY_SEND_BUDGET = 250; // Brevo free tier is 300/day; leave headroom.
const SLATE_HOUR_ET = 13; // Sunday 1:00 PM ET mass lock.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-reminder-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LeagueRow {
  id: string;
  name: string;
  season: number;
  leadHours: number;
}

interface GameRow {
  id: string;
  week: number;
  kickoff: string;
  away_abbr: string;
  home_abbr: string;
  away_team: string;
  home_team: string;
}

interface SendOpts {
  force: boolean;
  apiKey: string;
  senderEmail: string;
  appUrl: string;
  callerEmail: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey = Deno.env.get("BREVO_API_KEY");
    const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL");
    const appUrl = Deno.env.get("APP_URL") ?? "";
    const secret = Deno.env.get("REMINDER_SECRET");

    let body: { league_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine for scheduled runs
    }

    const scheduled = !!secret && req.headers.get("x-reminder-secret") === secret;
    let force = false;
    let leagues: LeagueRow[] = [];
    let callerEmail: string | null = null;

    if (scheduled) {
      const { data, error } = await service
        .from("leagues")
        .select("id, name, season, league_settings!inner(reminders_enabled, reminder_lead_hours)")
        .eq("league_settings.reminders_enabled", true);
      if (error) return json({ error: error.message }, 500);
      // deno-lint-ignore no-explicit-any
      leagues = (data ?? []).map((l: any) => ({
        id: l.id,
        name: l.name,
        season: l.season,
        leadHours: l.league_settings?.reminder_lead_hours ?? 3,
      }));
    } else {
      // Admin-triggered test for one league.
      const auth = req.headers.get("Authorization") ?? "";
      const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: auth } },
      });
      const {
        data: { user },
      } = await userClient.auth.getUser();
      if (!user) return json({ error: "Not authenticated" }, 401);
      if (!body.league_id) return json({ error: "league_id is required" }, 400);

      const { data: member } = await service
        .from("league_members")
        .select("role, status")
        .eq("league_id", body.league_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (member?.role !== "admin" || member?.status !== "active") {
        return json({ error: "Admins only" }, 403);
      }

      const { data: lg } = await service
        .from("leagues")
        .select("id, name, season, league_settings(reminder_lead_hours)")
        .eq("id", body.league_id)
        .single();
      leagues = lg
        ? [
            {
              id: lg.id,
              name: lg.name,
              season: lg.season,
              // deno-lint-ignore no-explicit-any
              leadHours: (lg as any).league_settings?.reminder_lead_hours ?? 3,
            },
          ]
        : [];
      force = true;
      callerEmail = user.email ?? null;
    }

    if (!apiKey || !senderEmail) {
      return json(
        {
          error:
            "Email isn't configured yet: set BREVO_API_KEY and BREVO_SENDER_EMAIL in Supabase Edge Function secrets.",
        },
        500
      );
    }

    const opts: SendOpts = { force, apiKey, senderEmail, appUrl, callerEmail };
    const budget = { remaining: force ? Number.MAX_SAFE_INTEGER : DAILY_SEND_BUDGET };
    const results = [];
    for (const league of leagues) {
      results.push(await processLeague(service, league, opts, budget));
    }
    const skipped = results.reduce((n, r) => n + ((r as { skipped?: number }).skipped ?? 0), 0);
    if (skipped > 0) {
      console.error(
        `[send-reminders] Daily budget of ${DAILY_SEND_BUDGET} hit — ${skipped} recipient(s) deferred to the next run.`
      );
    }
    return json({ budget: DAILY_SEND_BUDGET, skipped, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "reminder run failed" }, 500);
  }
});

/** Is this kickoff the Sunday 1:00 PM ET mass-lock slate? */
function isSlateAnchor(kickoff: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(kickoff);
  const wd = parts.find((p) => p.type === "weekday")?.value;
  const hr = Number(parts.find((p) => p.type === "hour")?.value);
  return wd === "Sun" && hr === SLATE_HOUR_ET;
}

function hoursUntil(kickoff: Date, now: number): number {
  return Math.max(0, Math.round((kickoff.getTime() - now) / (60 * 60 * 1000)));
}

// deno-lint-ignore no-explicit-any
async function processLeague(
  service: any,
  league: LeagueRow,
  opts: SendOpts,
  budget: { remaining: number }
) {
  const now = Date.now();
  const windowMs = league.leadHours * 60 * 60 * 1000;

  // Real run: only kickoffs inside the lead-time window are due. Test run: no
  // horizon at all — grab the single next upcoming game in the season so a
  // preview always works, even in the offseason when Week 1 is months away.
  let query = service
    .from("games")
    .select("id, week, kickoff, away_abbr, home_abbr, away_team, home_team")
    .eq("season", league.season)
    .gt("kickoff", new Date(now).toISOString())
    .order("kickoff", { ascending: true });
  if (opts.force) {
    query = query.limit(1);
  } else {
    query = query.lte("kickoff", new Date(now + windowMs).toISOString());
  }
  const { data: games } = await query;

  const upcoming: GameRow[] = games ?? [];
  if (upcoming.length === 0) {
    return {
      league: league.name,
      sent: 0,
      note: opts.force
        ? "No upcoming games are scheduled at all — load the season schedule first (Admin → sync)."
        : "No kickoffs inside the reminder window yet.",
    };
  }

  // In a test, only act on the single earliest upcoming kickoff.
  const targets = opts.force ? upcoming.slice(0, 1) : upcoming;

  const { data: members } = await service
    .from("league_members")
    .select("user_id, role, profiles(display_name, email)")
    .eq("league_id", league.id)
    .eq("status", "active");
  // deno-lint-ignore no-explicit-any
  const activeMembers = (members ?? []).filter((m: any) => m.profiles?.email);

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];
  const notes: string[] = [];

  for (const game of targets) {
    const kickoff = new Date(game.kickoff);
    // Real run: true hours to kickoff. Test run: show the configured lead time
    // so a months-out preview reads "3 hours", not "1400 hours".
    const hrs = opts.force ? league.leadHours : hoursUntil(kickoff, now) || league.leadHours;
    const slate = isSlateAnchor(kickoff);

    const { data: picks } = await service
      .from("picks")
      .select("user_id, game_id")
      .eq("league_id", league.id)
      .eq("season", league.season)
      .eq("week", game.week);
    const countByUser = new Map<string, number>();
    const pickedGameByUser = new Map<string, Set<string>>();
    for (const p of picks ?? []) {
      countByUser.set(p.user_id, (countByUser.get(p.user_id) ?? 0) + 1);
      if (!pickedGameByUser.has(p.user_id)) pickedGameByUser.set(p.user_id, new Set());
      pickedGameByUser.get(p.user_id)!.add(p.game_id);
    }

    const reminderKey = slate ? `slate:${league.season}:${game.week}` : game.id;

    const { data: already } = await service
      .from("reminder_log")
      .select("user_id")
      .eq("league_id", league.id)
      .eq("reminder_key", reminderKey);
    const remindedUsers = new Set((already ?? []).map((r: { user_id: string }) => r.user_id));

    // deno-lint-ignore no-explicit-any
    const recipients = activeMembers.filter((m: any) => {
      const count = countByUser.get(m.user_id) ?? 0;
      if (count >= PICKS_PER_WEEK) return false; // done for the week
      if (slate) return true; // slate: anyone short of 5
      const picked = pickedGameByUser.get(m.user_id);
      return !picked || !picked.has(game.id); // standalone: game still pickable
    });

    for (const m of recipients) {
      if (opts.force) {
        // Test: send one representative email to the caller, then stop.
        const html = renderEmail(slate, m.profiles.display_name ?? "there", hrs, game, opts.appUrl);
        const err = await sendEmail(
          opts,
          `${league.name} Reminders`,
          replyToFor(activeMembers),
          opts.callerEmail ?? m.profiles.email,
          m.profiles.display_name ?? null,
          subjectFor(slate, hrs, game),
          html
        );
        if (err) return { league: league.name, sent: 0, errors: [`${opts.callerEmail}: ${err}`] };
        return {
          league: league.name,
          sent: 1,
          note: `Test sent a ${slate ? "Sunday-lock" : "standalone-game"} reminder to your email.`,
        };
      }

      if (remindedUsers.has(m.user_id)) continue; // deduped
      if (budget.remaining <= 0) {
        skipped++;
        continue;
      }
      const html = renderEmail(slate, m.profiles.display_name ?? "there", hrs, game, opts.appUrl);
      const err = await sendEmail(
        opts,
        `${league.name} Reminders`,
        replyToFor(activeMembers),
        m.profiles.email,
        m.profiles.display_name ?? null,
        subjectFor(slate, hrs, game),
        html
      );
      if (err) {
        errors.push(`${m.profiles.email}: ${err}`);
        continue;
      }
      await service.from("reminder_log").insert({
        league_id: league.id,
        user_id: m.user_id,
        reminder_key: reminderKey,
      });
      sent++;
      budget.remaining--;
    }

    if (!opts.force && recipients.length > 0) {
      notes.push(
        `${slate ? "Sunday lock" : `${game.away_abbr}@${game.home_abbr}`}: ${recipients.length} eligible`
      );
    }
  }

  if (opts.force) {
    return {
      league: league.name,
      sent: 0,
      note: "Nobody is currently eligible for a reminder (picks are already in for the upcoming game).",
    };
  }

  return {
    league: league.name,
    sent,
    ...(skipped > 0 ? { skipped } : {}),
    ...(notes.length > 0 ? { detail: notes } : {}),
    ...(errors.length > 0 ? { errors } : {}),
  };
}

// deno-lint-ignore no-explicit-any
function replyToFor(members: any[]): { email: string; name: string } | null {
  const commish = members.find((m) => m.role === "admin");
  return commish?.profiles?.email
    ? { email: commish.profiles.email, name: commish.profiles.display_name ?? "League admin" }
    : null;
}

function subjectFor(slate: boolean, hrs: number, game: GameRow): string {
  return slate
    ? `${hrs}h before your Week ${game.week} picks lock`
    : `${hrs}h to pick ${game.away_abbr} @ ${game.home_abbr}`;
}

function renderEmail(
  slate: boolean,
  name: string,
  hrs: number,
  game: GameRow,
  appUrl: string
): string {
  const cta = appUrl
    ? `<p><a href="${appUrl}" style="background:#C9151E;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Get them in now →</a></p>`
    : "";
  if (slate) {
    return `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px">
        <h2 style="margin:0 0 8px">🏈 Picks lock soon</h2>
        <p>Hi ${esc(name)},</p>
        <p>You have <b>${hrs} hours</b> before all of your picks are locked for the week. Get them in now!</p>
        ${cta}
      </div>`;
  }
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px">
      <h2 style="margin:0 0 8px">🏈 A game is about to lock</h2>
      <p>Hi ${esc(name)},</p>
      <p>You have <b>${hrs} hours</b> to get your pick in for tonight's game between
      <b>${esc(game.away_team)}</b> and <b>${esc(game.home_team)}</b>.</p>
      ${cta}
    </div>`;
}

async function sendEmail(
  opts: SendOpts,
  senderName: string,
  replyTo: { email: string; name: string } | null,
  to: string,
  toName: string | null,
  subject: string,
  html: string
): Promise<string | null> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": opts.apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: opts.senderEmail, name: senderName },
      ...(replyTo ? { replyTo } : {}),
      to: [{ email: to, ...(toName ? { name: toName } : {}) }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) return `${res.status} ${await res.text()}`;
  return null;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
