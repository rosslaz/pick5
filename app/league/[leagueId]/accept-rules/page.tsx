"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AcceptRulesPage({
  params,
}: {
  params: { leagueId: string };
}) {
  const router = useRouter();
  const [rules, setRules] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .rpc("get_league_rules", { p_league_id: params.leagueId })
      .then(({ data }) => {
        const row = (data as { rules_text: string | null }[] | null)?.[0];
        setRules(row?.rules_text ?? null);
        setLoading(false);
      });
  }, [params.leagueId]);

  async function accept() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("accept_league_rules", {
      p_league_id: params.leagueId,
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push(`/league/${params.leagueId}/picks`);
    router.refresh();
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 py-8">
      <h1 className="text-3xl">Before you start</h1>
      <p className="text-sm text-muted">
        Your commissioner asks every player to read and accept the league rules before playing.
      </p>

      <section className="card max-h-[50vh] overflow-y-auto p-5">
        {loading ? (
          <p className="text-sm text-muted">Loading rules…</p>
        ) : rules ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{rules}</p>
        ) : (
          <p className="text-sm text-muted">No rules text found.</p>
        )}
      </section>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          className="h-4 w-4 accent-amber"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span className="text-sm">I have read and accept the league rules.</span>
      </label>

      {error && <p className="text-sm text-loss">{error}</p>}

      <button
        className="btn-amber self-start"
        type="button"
        disabled={!checked || busy || loading}
        onClick={accept}
      >
        {busy ? "Saving…" : "Accept and continue"}
      </button>
    </main>
  );
}
