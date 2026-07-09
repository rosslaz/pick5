// Supabase Edge Function: emails players who haven't submitted all 5 picks
// for the upcoming week, via Brevo (see pick5-email-reminders-decision.md).
// One verified sender address is used app-wide; the sender *name* is set to
// the league and replies go to the league's commissioner, so recipients see
// league branding without any per-admin credentials.
//
// Entry modes:
//   * Scheduled: pg_cron calls with an x-reminder-secret header; processes
//     every league that has reminders enabled.
//   * Test: a league admin triggers from the Admin screen with their own
//     login; processes just that league and ignores the kickoff window.
import { createClient } from "jsr:@supabase/supabase-js@2";

const WINDOW_MS = 36 * 60 * 60 * 1000; // only remind when a kickoff is close
const PICKS_PER_WEEK = 5;

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
        .select("id, name, season, league_settings!inner(reminders_enabled)")
        .eq("league_settings.reminders_enabled", true);
      if (error) return json({ error: error.message }, 500);
      leagues = (data ?? []).map((l) => ({ id: l.id, name: l.name, season: l.season }));
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
        .select("id, name, season")
        .eq("id", body.league_id)
        .single();
      leagues = lg ? [lg] : [];
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
    const results = [];
    for (const league of leagues) {
      results.push(await processLeague(service, league, opts));
    }
    return json({ results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "reminder run failed" }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function processLeague(service: any, league: LeagueRow, opts: SendOpts) {
  const nowIso = new Date().toISOString();
  const { data: games } = await service
    .from("games")
    .select("week, kickoff")
    .eq("season", league.season)
    .gt("kickoff", nowIso)
    .order("kickoff", { ascending: true });

  if (!games || games.length === 0) {
    return { league: league.name, sent: 0, note: "No upcoming games — nothing to remind about." };
  }

  const week: number = games[0].week;
  const firstKick = new Date(games[0].kickoff);
  if (!opts.force && firstKick.getTime() - Date.now() > WINDOW_MS) {
    return { league: league.name, week, sent: 0, note: "Kickoff isn't close enough yet." };
  }

  const { data: members } = await service
    .from("league_members")
    .select("user_id, joined_at, role, profiles(display_name, email)")
    .eq("league_id", league.id)
    .eq("status", "active")
    .order("joined_at", { ascending: true });
  const { data: picks } = await service
    .from("picks")
    .select("user_id")
    .eq("league_id", league.id)
    .eq("season", league.season)
    .eq("week", week);

  // Replies go to the commissioner: the earliest-joined active admin.
  // deno-lint-ignore no-explicit-any
  const commish = (members ?? []).find((m: any) => m.role === "admin");
  const replyTo = commish?.profiles?.email
    ? { email: commish.profiles.email, name: commish.profiles.display_name ?? "League admin" }
    : null;
  const senderName = `${league.name} Reminders`;

  const counts = new Map<string, number>();
  for (const p of picks ?? []) counts.set(p.user_id, (counts.get(p.user_id) ?? 0) + 1);

  // deno-lint-ignore no-explicit-any
  const laggards = (members ?? [])
    .map((m: any) => ({
      email: m.profiles?.email as string | undefined,
      name: (m.profiles?.display_name as string | undefined) ?? "there",
      count: counts.get(m.user_id) ?? 0,
    }))
    .filter((m: { email?: string; count: number }) => m.email && m.count < PICKS_PER_WEEK);

  const kickText =
    firstKick.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Detroit",
    }) + " ET";

  if (laggards.length === 0) {
    if (opts.force && opts.callerEmail) {
      const err = await sendEmail(
        opts,
        senderName,
        replyTo,
        opts.callerEmail,
        null,
        "Pick 5 test — reminders are working",
        `<p>Test successful. Everyone in <b>${esc(league.name)}</b> already has all ${PICKS_PER_WEEK} picks in for Week ${week}, so no reminders were needed.</p>`
      );
      if (err) return { league: league.name, week, sent: 0, errors: [err] };
      return {
        league: league.name,
        week,
        sent: 1,
        note: "Everyone has picks in — sent a test confirmation to your email instead.",
      };
    }
    return { league: league.name, week, sent: 0, note: "Everyone has picks in." };
  }

  let sent = 0;
  const errors: string[] = [];
  for (const m of laggards) {
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px">
        <h2 style="margin:0 0 8px">🏈 Missing your Week ${week} picks</h2>
        <p>Hey ${esc(m.name)} — you have <b>${m.count} of ${PICKS_PER_WEEK}</b> picks in for Week ${week} in <b>${esc(league.name)}</b>.</p>
        <p>First kickoff: <b>${kickText}</b>. Picks lock at each game's kickoff.</p>
        ${
          opts.appUrl
            ? `<p><a href="${opts.appUrl}" style="background:#C9151E;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Submit your picks →</a></p>`
            : ""
        }
      </div>`;
    const err = await sendEmail(
      opts,
      senderName,
      replyTo,
      m.email!,
      m.name,
      `Missing your Week ${week} picks`,
      html
    );
    if (err) errors.push(`${m.email}: ${err}`);
    else sent++;
  }

  return {
    league: league.name,
    week,
    missing: laggards.length,
    sent,
    ...(errors.length > 0 ? { errors } : {}),
  };
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
