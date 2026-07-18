"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function client() {
  return createClient();
}

export async function regenerateInviteCode(
  leagueId: string
): Promise<{ error?: string; code?: string }> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("regenerate_invite_code", {
    p_league_id: leagueId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/league/${leagueId}/admin`);
  return { code: data as string };
}

export async function setMemberRole(
  leagueId: string,
  userId: string,
  role: "admin" | "player"
): Promise<{ error?: string }> {
  const supabase = await client();
  const { error } = await supabase
    .from("league_members")
    .update({ role })
    .eq("league_id", leagueId)
    .eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath(`/league/${leagueId}/admin`);
  return {};
}

export async function setMemberStatus(
  leagueId: string,
  userId: string,
  status: "active" | "removed"
): Promise<{ error?: string }> {
  const supabase = await client();
  const { error } = await supabase
    .from("league_members")
    .update({ status })
    .eq("league_id", leagueId)
    .eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath(`/league/${leagueId}/admin`);
  revalidatePath(`/league/${leagueId}/leaderboard`);
  return {};
}

export async function setScore(
  leagueId: string,
  gameId: string,
  homeScore: number,
  awayScore: number,
  status: "scheduled" | "in_progress" | "final"
): Promise<{ error?: string }> {
  const supabase = await client();
  const { error } = await supabase.rpc("admin_set_score", {
    p_game_id: gameId,
    p_home_score: homeScore,
    p_away_score: awayScore,
    p_status: status,
  });
  if (error) return { error: error.message };
  revalidatePath(`/league/${leagueId}/admin`);
  revalidatePath(`/league/${leagueId}/leaderboard`);
  return {};
}

export async function renameLeague(
  leagueId: string,
  name: string
): Promise<{ error?: string }> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { error: "League name can't be empty." };
  if (trimmed.length > 60) return { error: "League name must be 60 characters or fewer." };
  const supabase = await client();
  // RLS (leagues_update policy, migration 0002) restricts this to league admins.
  const { error } = await supabase
    .from("leagues")
    .update({ name: trimmed })
    .eq("id", leagueId);
  if (error) return { error: error.message };
  // The name appears in the nav on every page, so refresh the whole layout.
  revalidatePath(`/league/${leagueId}`, "layout");
  return {};
}

export async function setRemindersEnabled(
  leagueId: string,
  enabled: boolean
): Promise<{ error?: string }> {
  const supabase = await client();
  // RLS (league_settings policies, migration 0010) restricts this to admins.
  const { error } = await supabase
    .from("league_settings")
    .upsert(
      { league_id: leagueId, reminders_enabled: enabled, updated_at: new Date().toISOString() },
      { onConflict: "league_id" }
    );
  if (error) return { error: error.message };
  revalidatePath(`/league/${leagueId}/admin`);
  return {};
}

export async function setReminderLeadHours(
  leagueId: string,
  hours: number
): Promise<{ error?: string }> {
  if (!Number.isInteger(hours) || hours < 1 || hours > 72) {
    return { error: "Lead time must be a whole number of hours between 1 and 72." };
  }
  const supabase = await client();
  const { error } = await supabase
    .from("league_settings")
    .upsert(
      { league_id: leagueId, reminder_lead_hours: hours, updated_at: new Date().toISOString() },
      { onConflict: "league_id" }
    );
  if (error) return { error: error.message };
  revalidatePath(`/league/${leagueId}/admin`);
  return {};
}

export async function setScoreFromWeek(
  leagueId: string,
  fromWeek: number | null
): Promise<{ error?: string }> {
  if (fromWeek !== null && (!Number.isInteger(fromWeek) || fromWeek < 1 || fromWeek > 30)) {
    return { error: "Start week must be a whole number between 1 and 30." };
  }
  const supabase = await client();
  // RLS restricts league_settings writes to admins. Null clears the reset
  // (undo) and returns standings to counting the whole season.
  const { error } = await supabase
    .from("league_settings")
    .upsert(
      { league_id: leagueId, score_from_week: fromWeek, updated_at: new Date().toISOString() },
      { onConflict: "league_id" }
    );
  if (error) return { error: error.message };
  revalidatePath(`/league/${leagueId}/admin`);
  revalidatePath(`/league/${leagueId}/leaderboard`);
  return {};
}

export async function saveLeagueRules(
  leagueId: string,
  rulesText: string,
  rulesRequired: boolean
): Promise<{ error?: string }> {
  const supabase = await client();
  const trimmed = rulesText.trim();
  // Requiring acceptance with no rules written would lock everyone out of the
  // league behind an empty page, so refuse that combination.
  if (rulesRequired && trimmed.length === 0) {
    return { error: "Add some rules text before requiring players to accept it." };
  }
  const { error } = await supabase
    .from("league_settings")
    .upsert(
      {
        league_id: leagueId,
        rules_text: trimmed.length > 0 ? trimmed : null,
        rules_required: rulesRequired,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "league_id" }
    );
  if (error) return { error: error.message };
  revalidatePath(`/league/${leagueId}/admin`);
  revalidatePath(`/league/${leagueId}/rules`);
  return {};
}

export async function releaseOverride(
  leagueId: string,
  gameId: string
): Promise<{ error?: string }> {
  const supabase = await client();
  const { error } = await supabase.rpc("admin_release_override", {
    p_game_id: gameId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/league/${leagueId}/admin`);
  revalidatePath(`/league/${leagueId}/leaderboard`);
  return {};
}
