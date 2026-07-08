// The Supabase URL and publishable key are public values by design — all data
// access is protected by Row Level Security policies in the database. They are
// baked in as defaults so the app works without extra env-var setup, but can be
// overridden with NEXT_PUBLIC_* environment variables (e.g. to point at a
// different project) without a code change.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ceaortdycialvyddctex.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_i_TugbDiRLMREkvwXGPRrg_EH9dSTYv";

// Note: the active season each league uses lives in the database
// (leagues.season, default 2026 set in migration 0001). When the app rolls to
// a new season, update the DB default and existing league rows — this constant
// is informational only.
export const SEASON = 2026;
export const TOTAL_WEEKS = 18;
export const PICKS_PER_WEEK = 5;
