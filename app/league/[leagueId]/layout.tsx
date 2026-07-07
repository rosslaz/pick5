import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import type { League } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { leagueId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS only returns leagues the user is an active member of.
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, invite_code, season")
    .eq("id", params.leagueId)
    .maybeSingle<League>();
  if (!league) redirect("/");

  const { data: memberships } = await supabase
    .from("league_members")
    .select("league_id, role, leagues(id, name)")
    .eq("user_id", user.id)
    .eq("status", "active");

  const role =
    memberships?.find((m) => m.league_id === params.leagueId)?.role ?? "player";
  const leagues =
    memberships
      ?.map((m) => {
        const l = m.leagues as unknown as { id: string; name: string } | null;
        return l ? { id: l.id, name: l.name } : null;
      })
      .filter((l): l is { id: string; name: string } => l !== null) ?? [];

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-3 pb-16 sm:px-6">
      <Nav league={league} leagues={leagues} isAdmin={role === "admin"} />
      {children}
    </div>
  );
}
