// Supabase Edge Function: sends pick reminders via Brevo, keyed off each
// upcoming kickoff and a per-league lead time. See pick5-email-reminders-
// decision.md for the provider decision.
//
// Two reminder types:
//   * "slate"     — the Sunday 1:00 PM ET mass lock. One per person per week.
//   * a kickoff   — games that lock before (or after) the slate. Reminders are
//                   grouped BY KICKOFF TIME, not per game, and sent only to
//                   players who could still pick one of them (fewer than 5
//                   picks AND haven't already picked it).
//
// A dedupe table (reminder_log) guarantees each (person, key) is emailed at
// most once, so the hourly cron is safe to re-run.
//
// Release 5 fixes:
//   #1  `hoursUntil(...) || leadHours` substituted the configured lead time
//       whenever the real figure rounded to 0, so a reminder 20 minutes before
//       kickoff announced "You have 3 hours". Time is now phrased honestly,
//       including sub-hour cases.
//   #2  Every game in the window produced its own email. The Sunday 1:00 slate
//       was protected by a shared dedupe key, but the 4:25 window was not — a
//       player short of picks got one email per game, several at once, and it
//       burned the daily budget. Games sharing a kickoff are now one email.
//   #6  The member query lost its ordering, so the "commissioner" used as
//       reply-to was whichever admin Postgres happened to return first.
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

/**
 * Fix #1: never claim more time than there is. The old code did
 * `hoursUntil(...) || leadHours`, so anything under ~30 minutes rounded to 0
 * and fell back to the configured lead time — telling someone they had three
 * hours when the game kicked off in twenty minutes.
 */
function timePhrase(msRemaining: number): string {
  const mins = Math.max(0, Math.round(msRemaining / 60000));
  if (mins < 5) return "just minutes";
  if (mins < 60) return `${mins} minutes`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? "1 hour" : `${hrs} hours`;
}

/** Short form for subject lines. */
function timePhraseShort(msRemaining: number): string {
  const mins = Math.max(0, Math.round(msRemaining / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
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

  // Fix #2: group by kickoff instant so games starting together produce ONE
  // email instead of one per game.
  const groups = new Map<string, GameRow[]>();
  for (const g of upcoming) {
    const key = new Date(g.kickoff).toISOString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(g);
  }
  const groupKeys = [...groups.keys()].sort();

  // Fix #6: restore deterministic ordering so the commissioner used for
  // reply-to is the earliest-joined active admin, as documented.
  const { data: members } = await service
    .from("league_members")
    .select("user_id, role, joined_at, profiles(display_name, email)")
    .eq("league_id", league.id)
    .eq("status", "active")
    .order("joined_at", { ascending: true });
  // deno-lint-ignore no-explicit-any
  const activeMembers = (members ?? []).filter((m: any) => m.profiles?.email);

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];
  const notes: string[] = [];

  for (const groupKey of groupKeys) {
    const groupGames = groups.get(groupKey)!;
    const kickoff = new Date(groupKey);
    const msLeft = kickoff.getTime() - now;
    // A test preview is months out; show the configured lead time instead of a
    // literal (and absurd) distance.
    const phrase = opts.force
      ? league.leadHours === 1
        ? "1 hour"
        : `${league.leadHours} hours`
      : timePhrase(msLeft);
    const shortPhrase = opts.force ? `${league.leadHours}h` : timePhraseShort(msLeft);
    const slate = isSlateAnchor(kickoff);
    const week = groupGames[0].week;

    const { data: picks } = await service
      .from("picks")
      .select("user_id, game_id")
      .eq("league_id", league.id)
      .eq("season", league.season)
      .eq("week", week);
    const countByUser = new Map<string, number>();
    const pickedGameByUser = new Map<string, Set<string>>();
    for (const p of picks ?? []) {
      countByUser.set(p.user_id, (countByUser.get(p.user_id) ?? 0) + 1);
      if (!pickedGameByUser.has(p.user_id)) pickedGameByUser.set(p.user_id, new Set());
      pickedGameByUser.get(p.user_id)!.add(p.game_id);
    }

    // One key per kickoff group (or per week for the slate), so a person is
    // reminded once for that lock moment no matter how many games share it.
    const reminderKey = slate ? `slate:${league.season}:${week}` : `kick:${groupKey}`;

    const { data: already } = await service
      .from("reminder_log")
      .select("user_id")
      .eq("league_id", league.id)
      .eq("reminder_key", reminderKey);
    const remindedUsers = new Set((already ?? []).map((r: { user_id: string }) => r.user_id));

    // deno-lint-ignore no-explicit-any
    const recipients: { m: any; openGames: GameRow[] }[] = [];
    for (const m of activeMembers) {
      const count = countByUser.get(m.user_id) ?? 0;
      if (count >= PICKS_PER_WEEK) continue; // done for the week
      if (slate) {
        recipients.push({ m, openGames: [] });
        continue;
      }
      const picked = pickedGameByUser.get(m.user_id) ?? new Set<string>();
      const openGames = groupGames.filter((g) => !picked.has(g.id));
      if (openGames.length > 0) recipients.push({ m, openGames });
    }

    for (const { m, openGames } of recipients) {
      if (opts.force) {
        const html = renderEmail(
          slate,
          m.profiles.display_name ?? "there",
          phrase,
          openGames,
          week,
          opts.appUrl
        );
        const err = await sendEmail(
          opts,
          `${league.name} Reminders`,
          replyToFor(activeMembers),
          opts.callerEmail ?? m.profiles.email,
          m.profiles.display_name ?? null,
          subjectFor(slate, shortPhrase, openGames, week),
          html
        );
        if (err) return { league: league.name, sent: 0, errors: [`${opts.callerEmail}: ${err}`] };
        return {
          league: league.name,
          sent: 1,
          note: `Test sent a ${slate ? "Sunday-lock" : "kickoff"} reminder to your email.`,
        };
      }

      if (remindedUsers.has(m.user_id)) continue; // deduped
      if (budget.remaining <= 0) {
        skipped++;
        continue;
      }
      const html = renderEmail(
        slate,
        m.profiles.display_name ?? "there",
        phrase,
        openGames,
        week,
        opts.appUrl
      );
      const err = await sendEmail(
        opts,
        `${league.name} Reminders`,
        replyToFor(activeMembers),
        m.profiles.email,
        m.profiles.display_name ?? null,
        subjectFor(slate, shortPhrase, openGames, week),
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
        `${slate ? "Sunday lock" : `${groupGames.length} game(s) at ${groupKey}`}: ${recipients.length} eligible`
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
  // members arrive ordered by joined_at, so this is the earliest-joined admin.
  const commish = members.find((m) => m.role === "admin");
  return commish?.profiles?.email
    ? { email: commish.profiles.email, name: commish.profiles.display_name ?? "League admin" }
    : null;
}

function subjectFor(
  slate: boolean,
  shortPhrase: string,
  openGames: GameRow[],
  week: number
): string {
  if (slate) return `${shortPhrase} before your Week ${week} picks lock`;
  if (openGames.length === 1) {
    return `${shortPhrase} to pick ${openGames[0].away_abbr} @ ${openGames[0].home_abbr}`;
  }
  return `${shortPhrase} before ${openGames.length} games kick off`;
}

function renderEmail(
  slate: boolean,
  name: string,
  phrase: string,
  openGames: GameRow[],
  week: number,
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
        <p>You have <b>${phrase}</b> before all of your picks are locked for the week. Get them in now!</p>
        ${cta}
      </div>`;
  }

  // Single game keeps the original wording.
  if (openGames.length === 1) {
    const g = openGames[0];
    return `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px">
        <h2 style="margin:0 0 8px">🏈 A game is about to lock</h2>
        <p>Hi ${esc(name)},</p>
        <p>You have <b>${phrase}</b> to get your pick in for tonight's game between
        <b>${esc(g.away_team)}</b> and <b>${esc(g.home_team)}</b>.</p>
        ${cta}
      </div>`;
  }

  // Several games share this kickoff (e.g. the Sunday 4:25 window): one email
  // listing what is still open, instead of one email per game.
  const list = openGames
    .map((g) => `<li>${esc(g.away_team)} at ${esc(g.home_team)}</li>`)
    .join("");
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px">
      <h2 style="margin:0 0 8px">🏈 Games about to lock</h2>
      <p>Hi ${esc(name)},</p>
      <p>You have <b>${phrase}</b> to get your picks in — these games kick off at the same time
      and you can still pick any of them:</p>
      <ul>${list}</ul>
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
