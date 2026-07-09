"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { League } from "@/lib/types";

export function Nav({
  league,
  leagues,
  isAdmin,
}: {
  league: League;
  leagues: { id: string; name: string }[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const tabs = [
    { href: `/league/${league.id}/picks`, label: "Picks" },
    { href: `/league/${league.id}/leaderboard`, label: "Leaderboard" },
    ...(isAdmin ? [{ href: `/league/${league.id}/admin`, label: "Admin" }] : []),
  ];

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 -mx-3 mb-6 border-b border-line bg-pitch/95 px-3 pb-0 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Pick 5" className="h-9 w-auto shrink-0" />
          <span className="whitespace-nowrap font-display text-2xl font-bold uppercase tracking-wider text-amber">
            Pick 5
          </span>
          {leagues.length > 1 ? (
            <select
              className="input min-w-0 max-w-[10rem] py-1 text-sm sm:max-w-none"
              value={league.id}
              onChange={(e) => router.push(`/league/${e.target.value}/picks`)}
              aria-label="Switch league"
            >
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="truncate text-sm text-muted">{league.name}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link href="/join" className="text-xs text-muted hover:text-ink">
            + League
          </Link>
          <button className="text-xs text-muted hover:text-ink" onClick={signOut} type="button">
            Sign out
          </button>
        </div>
      </div>
      <nav className="mt-2 flex gap-1">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-t-lg px-4 py-2 font-display text-lg uppercase tracking-wider ${
                active
                  ? "border-b-2 border-amber text-amber"
                  : "text-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
