"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface PickInput {
  game_id: string;
  picked_home: boolean;
  pick_order: number;
}

export async function savePicks(
  leagueId: string,
  season: number,
  week: number,
  picks: PickInput[]
): Promise<{ error?: string }> {
  const supabase = createClient();
  // All rules (membership, one team per game, 5 max, kickoff locks, frozen
  // locked picks) are enforced atomically inside the database function.
  const { error } = await supabase.rpc("save_picks", {
    p_league_id: leagueId,
    p_season: season,
    p_week: week,
    p_picks: picks,
  });
  if (error) return { error: error.message };
  revalidatePath(`/league/${leagueId}/picks`);
  revalidatePath(`/league/${leagueId}/leaderboard`);
  return {};
}
