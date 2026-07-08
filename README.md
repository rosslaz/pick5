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
