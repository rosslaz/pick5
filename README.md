# Pick 5 NFL

A web app for a Pick 5 NFL league. Each player picks the winners of 5 games a
week, straight up. A correct pick scores the points their team scored; a wrong
pick (or an NFL tie) scores 0. Weekly ties break by Pick 1 points, then Pick 2,
and so on.

## Stack
- Next.js 14 (App Router) + TypeScript + Tailwind
- Supabase (Postgres, Auth, Row Level Security, an Edge Function)
- ESPN's public API for schedule + scores (synced lazily on page loads)

## Deploy

The Supabase backend is already live (project `Pick 5 NFL`). This repo only
needs to be pushed to Vercel.

### Option A - Vercel CLI (PowerShell)
```powershell
npm install -g vercel      # once, if you don't have it
cd C:\Users\rossl\Projects\Pick5
npm install                # restore dependencies first
vercel                     # first run links/creates the project (answer the prompts)
vercel --prod              # promote to production
```

### Option B - Git
Create a new GitHub repo, push this folder, then "Import Project" in the Vercel
dashboard and point it at the repo.

## Environment variables
None required - the Supabase URL and publishable key are baked into
`lib/config.ts` (they're public by design; RLS protects the data). If you ever
rotate the key or move projects, set `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel and they'll override the defaults.

## First run
1. Register with the seed league's invite code (**LIONUP**) - the first person
   to join becomes the commissioner (admin).
2. In the Admin tab, click **Load season schedule** to pull all 18 weeks from
   ESPN (a required one-time step; after that, scores refresh automatically as
   players load pages).
3. Share your invite code with players. Regenerate it any time from Admin.

## Email reminders (optional, via Brevo)

Reminders nudge players who are short of 5 picks as kickoff nears (Thursday and
Sunday). They're **off** per league until an admin turns them on in the Admin
tab. Emails show the league name as the sender and reply to the commissioner
(the earliest-joined active admin), so you don't manage per-admin credentials.

Set-up is a one-time thing for the whole app:

1. Create a free account at [brevo.com](https://www.brevo.com) — the free tier
   is 300 emails/day, no card, no expiry. Plenty for a league.
2. Under **Senders, Domains & Dedicated IPs → Senders**, add one sender using
   an email address you control (a personal address is fine — it does **not**
   need a domain). Verify it via the OTP link Brevo emails you.
3. Get an API key from **SMTP & API → API Keys**.
4. In the Supabase dashboard for the project, go to **Edge Functions →
   send-reminders → Secrets** (or Project Settings → Edge Functions) and set:
   - `BREVO_API_KEY` — the key from step 3
   - `BREVO_SENDER_EMAIL` — the exact address you verified in step 2
   - `APP_URL` — your production URL (e.g. `https://pick5.vercel.app`), used in
     the "Submit your picks" button
   - `REMINDER_SECRET` — any long random string; it must match the value in the
     scheduled cron jobs (already configured on the database)
5. In the app: **Admin → Email reminders → Turn on**, then **Send test now** to
   confirm delivery. If secrets are missing, the test tells you which.

Notes on the free tier: Brevo appends a small "Sent with Brevo" footer and may
show the sending domain as `@brevosend.com` in some clients (your chosen sender
*name* is preserved). Upgrading removes both; not worth it for a hobby league.
