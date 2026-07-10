"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false); // recovery session established?
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The reset link lands here with a recovery token. Supabase's client parses
  // it and fires a PASSWORD_RECOVERY event; until then we don't have a session
  // that can update the password. We wait for that event (or an existing
  // recovery session) before showing the form.
  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });

    // Cover the case where the session is already present on load.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });

    // If nothing establishes a session shortly, the link is bad or expired.
    const timer = setTimeout(() => {
      setReady((r) => {
        if (!r) {
          setLinkError(
            "This reset link is invalid or has expired. Request a new one from the forgot-password page."
          );
        }
        return r;
      });
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    // Send them to sign in fresh with the new password after a beat.
    setTimeout(() => {
      router.push("/login");
      router.refresh();
    }, 1800);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-5xl font-bold text-amber">Pick 5</h1>
      <p className="mt-1 text-muted">Choose a new password.</p>

      {done ? (
        <div className="card mt-8 p-5">
          <p className="text-sm text-win">
            Password updated. Taking you to sign in…
          </p>
        </div>
      ) : linkError ? (
        <div className="card mt-8 flex flex-col gap-3 p-5">
          <p className="text-sm text-loss">{linkError}</p>
          <Link className="btn-ghost" href="/forgot-password">
            Request a new link
          </Link>
        </div>
      ) : !ready ? (
        <div className="card mt-8 p-5">
          <p className="text-sm text-muted">Verifying your reset link…</p>
        </div>
      ) : (
        <form onSubmit={updatePassword} className="card mt-8 flex flex-col gap-3 p-5">
          <label className="text-sm text-muted" htmlFor="password">
            New password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label className="text-sm text-muted" htmlFor="confirm">
            Confirm new password
          </label>
          <input
            id="confirm"
            className="input"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error && <p className="text-sm text-loss">{error}</p>}
          <button className="btn-amber mt-2" disabled={busy} type="submit">
            {busy ? "Saving…" : "Update password"}
          </button>
        </form>
      )}
    </main>
  );
}
