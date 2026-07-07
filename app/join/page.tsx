"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [leagueName, setLeagueName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: leagueId, error } = await supabase.rpc("join_league", {
      p_invite_code: code.trim().toUpperCase(),
    });
    if (error || !leagueId) {
      setError(error?.message ?? "That invite code doesn't match any league.");
      setBusy(false);
      return;
    }
    router.push(`/league/${leagueId}/picks`);
    router.refresh();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: leagueId, error } = await supabase.rpc("create_league", {
      p_name: leagueName.trim(),
    });
    if (error || !leagueId) {
      setError(error?.message ?? "Could not create the league.");
      setBusy(false);
      return;
    }
    router.push(`/league/${leagueId}/admin`);
    router.refresh();
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-4xl font-bold text-amber">Get in the game</h1>

      <form onSubmit={join} className="card flex flex-col gap-3 p-5">
        <h2 className="text-2xl">Join a league</h2>
        <label className="text-sm text-muted" htmlFor="code">Invite code</label>
        <input
          id="code"
          className="input uppercase tracking-widest"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button className="btn-amber" disabled={busy} type="submit">
          Join league
        </button>
      </form>

      <form onSubmit={create} className="card flex flex-col gap-3 p-5">
        <h2 className="text-2xl">Start a new league</h2>
        <p className="text-sm text-muted">
          You become the commissioner and get an invite code to share.
        </p>
        <label className="text-sm text-muted" htmlFor="league-name">League name</label>
        <input
          id="league-name"
          className="input"
          required
          maxLength={60}
          value={leagueName}
          onChange={(e) => setLeagueName(e.target.value)}
        />
        <button className="btn-ghost" disabled={busy} type="submit">
          Create league
        </button>
      </form>

      {error && <p className="text-sm text-loss">{error}</p>}
      <button className="text-sm text-muted hover:text-ink" onClick={signOut} type="button">
        Sign out
      </button>
    </main>
  );
}
