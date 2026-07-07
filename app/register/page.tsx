"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const code = inviteCode.trim().toUpperCase();

    // Catch typos before creating the account.
    const { data: valid, error: validErr } = await supabase.rpc("validate_invite", {
      p_invite_code: code,
    });
    if (validErr || !valid) {
      setError("That invite code doesn't match any league. Double-check it with your commissioner.");
      setBusy(false);
      return;
    }

    const { data, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName.trim(), invite_code: code } },
    });
    if (signUpErr) {
      setError(signUpErr.message);
      setBusy(false);
      return;
    }

    if (data.session) {
      // Email confirmation is off: join the league right away.
      const { data: leagueId, error: joinErr } = await supabase.rpc("join_league", {
        p_invite_code: code,
      });
      if (joinErr || !leagueId) {
        router.push("/join");
        return;
      }
      await supabase.auth.updateUser({ data: { invite_code: null } });
      router.push(`/league/${leagueId}/picks`);
      router.refresh();
      return;
    }

    // Email confirmation is on: the invite code is stored on the account and
    // applied automatically on first sign-in.
    setConfirmSent(true);
    setBusy(false);
  }

  if (confirmSent) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
        <div className="card p-6 text-center">
          <h1 className="text-3xl text-amber">Check your email</h1>
          <p className="mt-3 text-muted">
            We sent a confirmation link to <span className="text-ink">{email}</span>. Confirm,
            then sign in — your invite code is saved and you&apos;ll land in your league.
          </p>
          <Link className="btn-amber mt-6" href="/login">
            Go to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-5xl font-bold text-amber">Join a league</h1>
      <p className="mt-1 text-muted">You need an invite code from your commissioner.</p>
      <form onSubmit={register} className="card mt-8 flex flex-col gap-3 p-5">
        <label className="text-sm text-muted" htmlFor="name">Display name</label>
        <input
          id="name"
          className="input"
          required
          maxLength={40}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="What the leaderboard calls you"
        />
        <label className="text-sm text-muted" htmlFor="email">Email</label>
        <input
          id="email"
          className="input"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="text-sm text-muted" htmlFor="password">Password</label>
        <input
          id="password"
          className="input"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label className="text-sm text-muted" htmlFor="code">Invite code</label>
        <input
          id="code"
          className="input uppercase tracking-widest"
          required
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          placeholder="e.g. K4TR7N"
        />
        {error && <p className="text-sm text-loss">{error}</p>}
        <button className="btn-amber mt-2" disabled={busy} type="submit">
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        Already registered?{" "}
        <Link className="text-amber hover:underline" href="/login">
          Sign in
        </Link>
      </p>
    </main>
  );
}
