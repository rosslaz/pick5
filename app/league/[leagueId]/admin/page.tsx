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

  // Confirm the viewer is actually an admin of this league.
  const { data: me } = await supabase
    .from("league_members")
    .select("role")
    .eq("league_id", league.id)
    .eq("user_id", user.id)
    .maybeSingle<{ role: string }>();
  if (me?.role !== "admin") redirect(`/league/${league.id}/picks`);

  const { data: members } = await supabase
    .from("league_members")
    .select("user_id, role, status, joined_at, profiles(display_name, email)")
    .eq("league_id", league.id)
    .order("joined_at", { ascending: true })
    .returns<MemberRow[]>();

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
    .select("reminders_enabled, reminder_lead_hours, score_from_week")
    .eq("league_id", league.id)
    .maybeSingle();

  return (
    <AdminClient
      league={league}
      members={members ?? []}
      currentUserId={user.id}
      week={week}
      currentWeek={currentWeek}
      weekGames={weekGames ?? []}
      gamesLoaded={(weekMeta ?? []).length > 0}
      remindersEnabled={settings?.reminders_enabled ?? false}
      reminderLeadHours={settings?.reminder_lead_hours ?? 3}
      scoreFromWeek={settings?.score_from_week ?? null}
    />
  );
}
