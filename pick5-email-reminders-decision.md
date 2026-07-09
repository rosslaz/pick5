# Pick 5 — Email Reminders: Decision Summary

## Context
Previously built email reminders using Resend, but Resend requires a verified
domain, which we don't own. That implementation was fully reverted (see prior
chat). This doc captures the replacement decision so a future session can
implement it without re-litigating the research.

## Constraints
- No owned domain.
- Want reminder emails to *appear* to come from each league's admin (display
  name + reply-to), without managing separate credentials per admin.
- League size: ~120 people. Reminders go to a fraction of that, ~1-2x/week.
- Backend: Supabase (edge functions, pg_cron), Next.js/Vercel frontend.

## Options considered and ruled out
- **Mailchimp** — built for bulk marketing campaigns, not personalized
  per-user transactional sends. Transactional arm (Mandrill) needs a separate
  paid plan and still wants domain auth. Ruled out.
- **SendGrid** — originally recommended for single-sender verification (no
  domain needed), but as of May 27, 2025 Twilio killed SendGrid's permanent
  free tier. New accounts get a 60-day trial (100/day) then $19.95/mo minimum.
  Not worth paying for a hobby league's volume. Ruled out.
- **Gmail SMTP + Nodemailer** — free, no domain, but automated sending from a
  personal Gmail account risks Google's bot-detection flagging/locking the
  account, caps at ~500/day, and gives no delivery/bounce visibility. Viable
  fallback but not preferred.
- **True per-admin sending** (each admin uses their own Gmail or SendGrid
  account) — technically possible but requires collecting and securely
  storing each admin's credentials (app password or API key), building UI for
  it, and exposes each admin's account to the same bot-detection/lockout risk.
  Rejected as not worth the build cost for what's actually wanted (see below).

## Decision: Brevo
- Permanent free tier: **300 emails/day**, no expiration, no card required.
  Comfortably covers 120 people even in a worst-case single run.
- Sender verification is **per email address**, not per domain — verify one
  address we own via an OTP link.
- Key detail that solves the "looks like it's from the admin" requirement:
  the `sender` object in Brevo's API has separate `email` and `name` fields.
  Only `email` needs to be verified; `name` is free text set per send. So we
  use **one verified sender email** across the whole app, but set `name` to
  the league name (e.g. `"Ross's Pick 5 League"`) and set `replyTo` to the
  actual admin's email/name per league. Recipients see the league/admin
  branding; replies go to the real admin. No per-admin credentials needed.

## Implementation plan (for the coding session)
1. Create a free Brevo account.
2. Add one sender identity using an email we own; verify via the emailed
   OTP/link.
3. Get the API key from Brevo dashboard (SMTP & API section).
4. Store as a Supabase secret: `BREVO_API_KEY`.
5. Rebuild the `send-reminders` edge function (previously used Resend) to
   call Brevo's API instead:

```ts
await fetch("https://api.brevo.com/v3/smtp/email", {
  method: "POST",
  headers: {
    "api-key": Deno.env.get("BREVO_API_KEY")!,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    sender: {
      email: "picks@youraccount.example", // the one verified address
      name: `${league.name} Reminders`,
    },
    replyTo: { email: admin.email, name: admin.displayName },
    to: missingPickPlayers.map(p => ({ email: p.email, name: p.name })),
    subject: `Missing your Week ${week} picks`,
    htmlContent: `<p>Hey — you're missing picks for Week ${week}. <a href="${appUrl}">Submit here</a>.</p>`,
  }),
});
```

6. Reuse the existing cron schedule (Thu ~1pm ET, Sun ~9:30am ET) and
   "only players who are short, only when games are imminent" logic from the
   prior Resend build — that logic doesn't change, only the send call does.
7. Update README setup steps to describe the Brevo signup + sender
   verification flow instead of Resend's domain-verification flow.
8. Re-add the admin UI section ("Email reminders" card with enable/disable +
   "Send test now") that was stripped out during the Resend rollback.

## Open items / things to double check when building
- Confirm Brevo's current free-tier terms haven't changed since this was
  researched (checked against Brevo's own docs as of mid-2026).
- Decide what "from" email to actually verify (a personal address vs. a
  dedicated one) — doesn't need to match a domain, just needs to be an inbox
  we control to receive the OTP.
