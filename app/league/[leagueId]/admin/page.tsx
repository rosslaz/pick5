import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { latestActiveWeek } from "@/lib/weeks";
import { TOTAL_WEEKS } from "@/lib/config";
import type { Game, League, MemberRow } from "@/lib/types";
import { AdminClient } from "./admin-client";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: { leagueId: string };
  searchParams: { week?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, invite_code, season")
    .eq("id", params.leagueId)
    .maybeSingle<League>();
  if (!league) redirect("/");

  // Confirm the viewer is actually an ACTIVE admin of this league. Without the
  // status check a removed member who still carries role='admin' could reach
  // this page if the leagues RLS ever loosened (fix #7).
  const { data: me } = await supabase
    .from("league_members")
    .select("role, status")
    .eq("league_id", league.id)
    .eq("user_id", user.id)
    .maybeSingle<{ role: string; status: string }>();
  if (me?.role !== "admin" || me?.status !== "active") {
    redirect(`/league/${league.id}/picks`);
  }

  // Roster comes from a function so member emails aren't exposed through the
  // profiles table to non-admins (fix #11).
  const { data: roster } = await supabase.rpc("get_league_roster", {
    p_league_id: league.id,
  });
  const members: MemberRow[] = (
    (roster as
      | {
          user_id: string;
          display_name: string;
          email: string | null;
          role: string;
          status: string;
          joined_at: string;
        }[]
      | null) ?? []
  ).map((m) => ({
    user_id: m.user_id,
    role: m.role as MemberRow["role"],
    status: m.status as MemberRow["status"],
    joined_at: m.joined_at,
    profiles: { display_name: m.display_name, email: m.email ?? "" },
  }));

  const { data: weekMeta } = await supabase
    .from("games")
    .select("week, status, kickoff")
    .eq("season", league.season);
  const currentWeek = latestActiveWeek(weekMeta ?? []);

  const requested = Number(searchParams.week);
  const week =
    Number.isInteger(requested) && requested >= 1 && requested <= TOTAL_WEEKS
      ? requested
      : currentWeek;

  const { data: weekGames } = await supabase
    .from("games")
    .select("*")
    .eq("season", league.season)
    .eq("week", week)
    .order("kickoff", { ascending: true })
    .returns<Game[]>();

  const { data: settings } = await supabase
    .from("league_settings")
    .select(
      "reminders_enabled, reminder_lead_hours, score_from_week, rules_text, rules_required"
    )
    .eq("league_id", league.id)
    .maybeSingle();

  // Pick audit for the viewed week. The function is lock-gated: it returns rows
  // only when the week is fully final, so this can't reveal picks early.
  const { data: audit } = await supabase.rpc("get_pick_audit", {
    p_league_id: league.id,
    p_season: league.season,
    p_week: week,
  });

  // Manual score overrides recorded for this season (fix #3 — the audit table
  // existed but had no read path at all). Admin-only in the database.
  const { data: overrides } = await supabase.rpc("get_score_overrides", {
    p_league_id: league.id,
    p_season: league.season,
  });

  return (
    <AdminClient
      league={league}
      members={members}
      currentUserId={user.id}
      week={week}
      currentWeek={currentWeek}
      weekGames={weekGames ?? []}
      gamesLoaded={(weekMeta ?? []).length > 0}
      remindersEnabled={settings?.reminders_enabled ?? false}
      reminderLeadHours={settings?.reminder_lead_hours ?? 3}
      scoreFromWeek={settings?.score_from_week ?? null}
      rulesText={settings?.rules_text ?? ""}
      rulesRequired={settings?.rules_required ?? false}
      overrideRows={
        (overrides as
          | {
              game_label: string;
              week: number;
              action: string;
              old_home: number | null;
              old_away: number | null;
              new_home: number | null;
              new_away: number | null;
              new_status: string | null;
              actor_name: string;
              created_at: string;
            }[]
          | null) ?? []
      }
      auditRows={
        (audit as
          | {
              display_name: string;
              pick_order: number;
              change_type: string;
              old_team: string | null;
              new_team: string | null;
              changed_at: string;
            }[]
          | null) ?? []
      }
    />
  );
}
