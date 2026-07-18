import { headers } from "next/headers";
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

  // League rules: fetched once, used both for the acceptance gate and to decide
  // whether the nav shows a Rules link.
  const { data: rulesRow } = await supabase.rpc("get_league_rules", {
    p_league_id: params.leagueId,
  });
  const r = (
    rulesRow as
      | { rules_text: string | null; rules_required: boolean; accepted: boolean }[]
      | null
  )?.[0];
  const hasRules = !!r?.rules_text;

  // Gate: if the commissioner requires acceptance and this member hasn't
  // accepted, send them to the acceptance page. Enforcing here (rather than at
  // join time) covers every entry path — the join page, register-with-code, and
  // auto-join — plus anyone who joined before rules were turned on.
  // Admins are exempt so a commissioner can never lock themselves out of the
  // Admin screen where the rules are edited. The accept-rules page itself is
  // exempt, otherwise it would redirect to itself forever.
  const pathname = headers().get("x-pathname") ?? "";
  const onAcceptPage = pathname.endsWith("/accept-rules");
  if (role !== "admin" && !onAcceptPage && r?.rules_required && hasRules && !r.accepted) {
    redirect(`/league/${params.leagueId}/accept-rules`);
  }

  const leagues =
    memberships
      ?.map((m) => {
        const l = m.leagues as unknown as { id: string; name: string } | null;
        return l ? { id: l.id, name: l.name } : null;
      })
      .filter((l): l is { id: string; name: string } => l !== null) ?? [];

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-3 pb-16 sm:px-6">
      <Nav league={league} leagues={leagues} isAdmin={role === "admin"} hasRules={hasRules} />
      {children}
    </div>
  );
}
