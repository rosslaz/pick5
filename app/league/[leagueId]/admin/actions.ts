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
