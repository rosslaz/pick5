"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Always show the same confirmation whether or not the email exists, so the
    // page can't be used to probe which addresses have accounts.
    setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-5xl font-bold text-amber">Pick 5</h1>
      <p className="mt-1 text-muted">Reset your password.</p>

      {sent ? (
        <div className="card mt-8 flex flex-col gap-3 p-5">
          <p className="text-sm">
            If an account exists for <b>{email}</b>, a password-reset link is on its way. Check
            your inbox (and spam folder) and follow the link to choose a new password.
          </p>
          <p className="text-xs text-muted">
            The link expires after a while for security — if it lapses, just request another.
          </p>
          <Link className="btn-ghost mt-2" href="/login">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={requestReset} className="card mt-8 flex flex-col gap-3 p-5">
          <label className="text-sm text-muted" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && <p className="text-sm text-loss">{error}</p>}
          <button className="btn-amber mt-2" disabled={busy} type="submit">
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <Link className="mt-1 text-center text-sm text-muted hover:underline" href="/login">
            Back to sign in
          </Link>
        </form>
      )}
    </main>
  );
}
