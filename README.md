# Pick 5 NFL

A web app for a Pick 5 NFL league. Each player picks five winners a week,
straight up, and scores the points their teams score.

- **Stack:** Next.js 14 (App Router) + TypeScript + Tailwind
- **Backend:** Supabase — Postgres, Auth, Row Level Security, two Edge Functions
- **Data:** ESPN's public API, synced lazily on page loads

---

## How the game works

**Picking.** Five games a week, straight up. Pick order matters — Pick 1 is your
first tiebreaker.

**Scoring.** A correct pick scores the number of points *your team* scored. A
wrong pick scores 0. An NFL tie scores 0 and counts as a loss on your record,
because you didn't pick a winner.

**Locking.** This is the rule most likely to surprise you if you're reading the
code:

> A pick's deadline is the **earlier** of its own kickoff and that week's
> **Sunday 1:00 PM ET** slate.

So Thursday, Friday and Saturday games lock at their own kickoff, and everything
from 1:00 PM Sunday onward — the 1:00 slate, the 4:25 window, Sunday night and
Monday night — freezes together when the 1:00 games start. Once the slate kicks
off you cannot add, change or reorder anything for that week. Enforced in the
database (`save_picks`), not just the UI.

**Reveal.** Everyone's picks become visible at that same 1:00 lock. Before it,
opponents' picks are hidden — you can still change your remaining picks, so
seeing whether someone's Thursday pick hit would be an edge. After it, nothing
can change, so the whole board opens up.

**Tiebreaks.** Weekly ties break by Pick 1 points, then Pick 2, and so on.
Season ties break by weeks won.

**Perfect slate (jackpot).** A player hits it when all five of their picks won,
those five are the five highest-scoring *winning* teams in the entire Wed→Mon
slate, and their pick order matches those teams by points, high to low. Only
fully-final weeks count. A boundary tie still qualifies if you picked one of the
tied-for-top winners — which means two players can hit it in the same week. The
app **detects and flags** the event; it does not move money or track a pot.
Splitting a tied jackpot is a house rule.

---

## Deploy

The Supabase backend is already live. This repo only needs to reach Vercel.

**Git (recommended):** push to GitHub and import the repo in the Vercel
dashboard. Subsequent pushes deploy automatically.

**Vercel CLI:**
```powershell
npm install -g vercel      # once
cd C:\Users\rossl\Projects\Pick5
npm install
vercel                     # first run links/creates the project
vercel --prod
```

### Environment variables

None required. The Supabase URL and publishable key live in `lib/config.ts` —
they're public by design and RLS protects the data. To point at a different
project, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
Vercel and they override the defaults.

### Supabase Auth configuration

Password reset will not work until these are set in the Supabase dashboard
under **Authentication → URL Configuration**:

- **Site URL** — your production URL
- **Redirect URLs** — add `<your-url>/reset-password` (and
  `http://localhost:3000/reset-password` if you develop locally)

Supabase's built-in mailer is rate-limited to a handful of messages per hour,
which is fine for occasional resets. For anything heavier, point **Auth → SMTP
settings** at the same Brevo credentials used for reminders.

---

## First run

1. Register with a league invite code. The first person to join a new league
   becomes its commissioner.
2. **Admin → Game admin → Load season schedule** pulls all 18 weeks from ESPN.
   This is a required one-time step; after that, scores refresh automatically as
   players load pages (every 2 minutes while games are live, every 6 hours
   otherwise).
3. Share the invite code. Regenerate it any time from **Admin → Settings**.

Invite codes are eight characters. Older six-character codes still work;
regenerating upgrades one. Failed code attempts are throttled to 20 per account
per hour.

---

## Admin

The Admin screen is split into four tabs.

**Game admin** — schedule and score sync, manual score overrides for the
selected week, the score override history, and the pick audit log.

**Players** — roster, promote/demote, remove/reinstate, CSV export. The database
refuses to demote or remove the last active admin.

**Rules** — a free-text rules document for the league. Optionally require new
players to accept it before they can play; enforcement lives in `save_picks`, so
it holds even against direct API calls. Commissioners are exempt so they can't
lock themselves out of this tab.

**Settings** — league name, invite code, the overall standings window, and email
reminders.

### Score overrides are restricted to the app owner

Games are a single shared table across all leagues, so *any* manual override
affects everyone. Because anyone can create a league and become its admin,
"league admin" isn't a strong enough boundary for that. Overrides therefore
require membership in the `app_admins` table, and every change is recorded in
`score_override_audit` (visible in **Game admin → Score override history**).

If another commissioner needs a wrong score corrected, they have to ask the app
owner. The alternative — per-league overrides, so a correction only affects the
league that made it — is a larger change and hasn't been built.

### Half-season payouts

**Settings → Overall standings window** makes the Overall column count only from
a chosen week onward. It deletes nothing — weekly results are untouched and
"Undo" restores the full-season total.

### Pick audit

Every pick change is recorded with a timestamp: added, replaced, removed. The
log is **admin-only** and **lock-gated** — it returns nothing until the week is
completely final, so it can never reveal picks early. It is forward-only;
changes made before the feature shipped were never recorded.

---

## Email reminders (optional, via Brevo)

Reminders nudge players who can still make a pick. They are **off** per league
until a commissioner turns them on in **Admin → Settings**.

**When they fire.** An hourly job checks each enabled league against its
configured lead time (1–72 hours, default 3). Two kinds go out:

- **Kickoff reminders** for games that lock at their own kickoff — Thursday,
  Friday, Saturday, Sunday morning. Sent only to players who could still pick
  that game. Games sharing a kickoff instant are combined into one email.
- **The Sunday lock reminder**, sent to anyone short of five picks before the
  1:00 slate. This is the last call for the week.

Games *after* the 1:00 anchor never get their own reminder — they're already
locked. Emails show the league name as the sender and reply to the
earliest-joined active admin, so there are no per-admin credentials.

### One-time setup

1. Create a free account at [brevo.com](https://www.brevo.com). The free tier is
   300 emails/day, no card, no expiry.
2. Under **Senders, Domains & Dedicated IPs → Senders**, add one sender using an
   address you control (a personal address is fine, no domain needed) and verify
   it via the OTP link.
3. Get an API key from **SMTP & API → API Keys**.
4. In Supabase, go to **Edge Functions → send-reminders → Secrets** and set:
   - `BREVO_API_KEY`
   - `BREVO_SENDER_EMAIL` — the exact address verified in step 2
   - `APP_URL` — your production URL, used in the email's button
   - `REMINDER_SECRET` — must match the value baked into the scheduled cron job
5. **Admin → Settings → Email reminders → Turn on**, then **Send test now**. The
   test reports failures honestly rather than claiming success.

**If Brevo returns a 401 about an unrecognised IP,** turn off *Authorized IPs* in
Brevo's security settings. Edge functions run on rotating serverless addresses,
so an IP allowlist is the wrong model here; your API key is the protection.

Free-tier cosmetics: Brevo appends a small "Sent with Brevo" footer and may show
the sending domain as `@brevosend.com` in some clients. Your sender *name* is
preserved.

A per-run cap of 250 emails protects the daily quota. Anyone skipped is picked
up on the next run, since reminders recompute who still needs one.

---

## Testing

`supabase/tests/season_simulation.sql` plays out a five-player, five-week season
and asserts 36 rules: scoring, ties, partial slates, removed members, tiebreaks,
the perfect-slate jackpot, half-season resets, the Sunday lock, flex scheduling,
postponed games, pick validation, the audit trail, the rules gate,
score-override authorisation, and reveal timing.

Paste it into the Supabase SQL editor. It runs inside a transaction that ends in
`ROLLBACK` — nothing survives, and it only touches season 9999. Output is a
PASS/FAIL table with a total.

Worth running after any migration, and again in September once the real schedule
is loaded.

It covers the **database layer only**. The Next.js pages and the two Edge
Functions (`sync-games`, `send-reminders`) still need manual checks.

---

## Database

Migrations live in `supabase/migrations/`, numbered in order, and the repo can
rebuild the schema from scratch. A few notes for anyone reading them:

- Adding a parameter to a Postgres function creates a **new overload** rather
  than replacing it. Several migrations drop the previous signature explicitly
  for that reason — skipping it caused a "function is not unique" outage once.
- `revoke execute … from anon` alone does nothing: Postgres grants EXECUTE to
  `PUBLIC` by default, and Supabase additionally grants `anon` explicitly. Both
  must be revoked. See `0024`/`0025`.
- Timing rules have two distinct anchors. `week_lock_anchor` is the Sunday 1:00
  ET freeze and returns null for a week without one. `current_pick_week` is the
  earliest week still open for picking — deliberately different from
  `computeCurrentWeek` in `lib/weeks.ts`, which answers "which week needs a
  score re-sync" and is the right question only for syncing.

## Notes

- The app is an installable PWA with no service worker — deliberate, since
  caching a live-scores app would show stale data. On iOS use Share → Add to
  Home Screen.
- All times are stored and compared as absolute instants, so locking, scoring
  and reveal behave identically in any timezone. Times display in each viewer's
  local zone.
- Flexed games update automatically on the next sync: ESPN keys games by a
  stable id, so a moved kickoff carries its picks with it. A game an admin has
  manually pinned is skipped by sync — unpin it to let ESPN correct it.
