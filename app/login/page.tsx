"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-5xl font-bold text-amber">Pick 5</h1>
      <p className="mt-1 text-muted">
        Pick five NFL winners a week. Score what your teams score.
      </p>
      <form onSubmit={signIn} className="card mt-8 flex flex-col gap-3 p-5">
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-loss">{error}</p>}
        <button className="btn-amber mt-2" disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <Link
          className="mt-1 text-center text-sm text-muted hover:underline"
          href="/forgot-password"
        >
          Forgot your password?
        </Link>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        Have an invite code?{" "}
        <Link className="text-amber hover:underline" href="/register">
          Register here
        </Link>
      </p>
    </main>
  );
}
