import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RulesPage({
  params,
}: {
  params: { leagueId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // get_league_rules is member-gated in the database.
  const { data } = await supabase.rpc("get_league_rules", {
    p_league_id: params.leagueId,
  });
  const row = (data as { rules_text: string | null; rules_required: boolean }[] | null)?.[0];
  const rules = row?.rules_text ?? null;

  return (
    <main className="flex flex-col gap-6 py-6">
      <h1 className="text-3xl">League rules</h1>
      {rules ? (
        <section className="card p-5">
          {/* whitespace-pre-wrap preserves the admin's line breaks verbatim. */}
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{rules}</p>
        </section>
      ) : (
        <section className="card p-5">
          <p className="text-sm text-muted">
            No rules have been set for this league yet. A commissioner can add them from
            Admin → Rules.
          </p>
        </section>
      )}
      <Link className="btn-ghost self-start" href={`/league/${params.leagueId}/picks`}>
        Back to picks
      </Link>
    </main>
  );
}
