import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fix #10: without an explicit order this returned memberships in whatever
  // order Postgres produced, so a player in several leagues could land in a
  // different one on each sign-in. Oldest membership wins — stable and
  // matches "your main league".
  const { data: memberships } = await supabase
    .from("league_members")
    .select("league_id, joined_at")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("joined_at", { ascending: true });

  if (memberships && memberships.length > 0) {
    redirect(`/league/${memberships[0].league_id}/picks`);
  }

  // First sign-in after email confirmation: apply the invite code from registration.
  const inviteCode = (user.user_metadata as Record<string, unknown>)?.invite_code;
  if (typeof inviteCode === "string" && inviteCode.trim() !== "") {
    const { data: leagueId, error } = await supabase.rpc("join_league", {
      p_invite_code: inviteCode,
    });
    if (!error && leagueId) {
      await supabase.auth.updateUser({ data: { invite_code: null } });
      redirect(`/league/${leagueId}/picks`);
    }
  }

  redirect("/join");
}
