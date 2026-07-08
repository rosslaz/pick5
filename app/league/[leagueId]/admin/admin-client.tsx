"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invokeSync } from "@/lib/sync";
import { KickoffTime } from "@/components/kickoff-time";
import { WeekPicker } from "@/components/week-picker";
import type { Game, League, MemberRow } from "@/lib/types";
import {
  regenerateInviteCode,
  releaseOverride,
  renameLeague,
  setMemberRole,
  setMemberStatus,
  setScore,
} from "./actions";

export function AdminClient({
  league,
  members,
  currentUserId,
  week,
  currentWeek,
  weekGames,
  gamesLoaded,
}: {
  league: League;
  members: MemberRow[];
  currentUserId: string;
  week: number;
  currentWeek: number;
  weekGames: Game[];
  gamesLoaded: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState(league.invite_code);
  const [name, setName] = useState(league.name);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const activeAdmins = members.filter((m) => m.role === "admin" && m.status === "active");

  function run(fn: () => Promise<{ error?: string }>) {
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setErr(res.error);
      else router.refresh();
    });
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr("Couldn't copy — select and copy the code manually.");
    }
  }

  async function sync(body: { season: number; week?: number; full?: boolean }) {
    setSyncMsg(null);
    setErr(null);
    setSyncing(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Session expired — sign in again.");
      const result = await invokeSync(token, body);
      const n = (result?.upserted as number) ?? 0;
      const pinned = (result?.pinned as number) ?? 0;
      setSyncMsg(
        (body.full
          ? `Synced the full ${league.season} schedule (${n} games).`
          : `Synced week ${body.week} (${n} games).`) +
          (pinned > 0 ? ` Skipped ${pinned} pinned game${pinned > 1 ? "s" : ""}.` : "")
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function unpin(game: Game) {
    setErr(null);
    const res = await releaseOverride(league.id, game.id);
    if (res.error) {
      setErr(res.error);
      return;
    }
    // Hand the game back to ESPN and immediately re-pull the real data.
    await sync({ season: league.season, week: game.week });
  }

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-3xl">Admin — {league.name}</h1>
      {err && <p className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-loss">{err}</p>}

      {/* League name */}
      <section className="card p-5">
        <h2 className="text-2xl">League name</h2>
        <p className="mt-1 text-sm text-muted">
          Shown in the nav and on every screen for all players.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            className="input max-w-xs"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="League name"
          />
          <button
            className="btn-ghost"
            disabled={pending || name.trim() === league.name || name.trim() === ""}
            type="button"
            onClick={() => run(() => renameLeague(league.id, name))}
          >
            Save name
          </button>
        </div>
      </section>

      {/* Invite code */}
      <section className="card p-5">
        <h2 className="text-2xl">Invite code</h2>
        <p className="mt-1 text-sm text-muted">
          Share this so players can register into <span className="text-ink">{league.name}</span>.
          Regenerating it stops anyone you&apos;ve removed from rejoining with the old code.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="score-cell px-4 py-2 text-2xl tracking-[0.3em]">{code}</span>
          <button className="btn-ghost" onClick={copyCode} type="button">
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            className="btn-ghost"
            disabled={pending}
            type="button"
            onClick={() =>
              startTransition(async () => {
                const res = await regenerateInviteCode(league.id);
                if (res.error) setErr(res.error);
                else if (res.code) setCode(res.code);
              })
            }
          >
            Regenerate
          </button>
        </div>
      </section>

      {/* Schedule sync */}
      <section className="card p-5">
        <h2 className="text-2xl">NFL schedule &amp; scores</h2>
        <p className="mt-1 text-sm text-muted">
          Games and final scores pull automatically from ESPN as players load pages. Use these
          if you want to force a refresh.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button className="btn-amber" disabled={syncing} type="button" onClick={() => sync({ season: league.season, full: true })}>
            {syncing ? "Syncing…" : gamesLoaded ? "Re-sync full season" : "Load season schedule"}
          </button>
          <button
            className="btn-ghost"
            disabled={syncing || !gamesLoaded}
            type="button"
            onClick={() => sync({ season: league.season, week })}
          >
            Sync week {week}
          </button>
        </div>
        {syncMsg && <p className="mt-2 text-sm text-win">{syncMsg}</p>}
      </section>

      {/* Members */}
      <section className="card p-5">
        <h2 className="text-2xl">Players</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase text-muted">
                <th className="px-2 py-2 font-medium">Player</th>
                <th className="px-2 py-2 font-medium">Role</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.user_id === currentUserId;
                const lastAdmin = m.role === "admin" && activeAdmins.length <= 1;
                return (
                  <tr key={m.user_id} className="border-b border-line/60">
                    <td className="px-2 py-2">
                      <div className="font-semibold">{m.profiles?.display_name ?? "—"}</div>
                      <div className="text-xs text-muted">{m.profiles?.email}</div>
                    </td>
                    <td className="px-2 py-2">
                      <span className={m.role === "admin" ? "text-amber" : "text-muted"}>
                        {m.role}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <span className={m.status === "active" ? "text-win" : "text-loss"}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        {m.role === "player" ? (
                          <button
                            className="btn-ghost px-2 py-1 text-xs"
                            disabled={pending || m.status !== "active"}
                            type="button"
                            onClick={() => run(() => setMemberRole(league.id, m.user_id, "admin"))}
                          >
                            Make admin
                          </button>
                        ) : (
                          <button
                            className="btn-ghost px-2 py-1 text-xs"
                            disabled={pending || lastAdmin}
                            title={lastAdmin ? "A league needs at least one admin" : undefined}
                            type="button"
                            onClick={() => run(() => setMemberRole(league.id, m.user_id, "player"))}
                          >
                            Demote
                          </button>
                        )}
                        {m.status === "active" ? (
                          <button
                            className="btn-danger px-2 py-1 text-xs"
                            disabled={pending || isSelf || lastAdmin}
                            title={isSelf ? "You can't remove yourself" : undefined}
                            type="button"
                            onClick={() => run(() => setMemberStatus(league.id, m.user_id, "removed"))}
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            className="btn-ghost px-2 py-1 text-xs"
                            disabled={pending}
                            type="button"
                            onClick={() => run(() => setMemberStatus(league.id, m.user_id, "active"))}
                          >
                            Reinstate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Score override */}
      <section className="card p-5">
        <h2 className="text-2xl">Score override — week {week}</h2>
        <p className="mt-1 text-sm text-muted">
          Only needed if ESPN is wrong or late. Saving marks the game final and{" "}
          <span className="text-ink">pins</span> it, so ESPN syncs can&apos;t overwrite your
          correction. Unpin to hand a game back to ESPN. Overrides affect every league using
          this game.
        </p>
        <div className="mt-3">
          <WeekPicker
            basePath={`/league/${league.id}/admin`}
            selected={week}
            current={currentWeek}
          />
        </div>
        <div className="flex flex-col gap-2">
          {weekGames.length === 0 && <p className="text-muted">No games loaded for this week.</p>}
          {weekGames.map((g) => (
            <ScoreRow
              key={g.id}
              game={g}
              leagueId={league.id}
              disabled={pending || syncing}
              onError={setErr}
              onUnpin={() => unpin(g)}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

function ScoreRow({
  game,
  leagueId,
  disabled,
  onError,
  onUnpin,
}: {
  game: Game;
  leagueId: string;
  disabled: boolean;
  onError: (msg: string | null) => void;
  onUnpin: () => void;
}) {
  const router = useRouter();
  const [home, setHome] = useState(game.home_score ?? 0);
  const [away, setAway] = useState(game.away_score ?? 0);
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-lg border border-line bg-pitch px-3 py-2">
      <div className="min-w-0">
        <div className="truncate font-display text-lg">
          {game.away_abbr} @ {game.home_abbr}
        </div>
        <div className="text-xs text-muted">
          <KickoffTime iso={game.kickoff} /> · {game.status}
          {game.manual_override && (
            <span className="text-amber" title="Manually corrected — ESPN sync skips this game">
              {" "}
              · pinned
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`away-${game.id}`}>
          {game.away_abbr} score
        </label>
        <input
          id={`away-${game.id}`}
          className="input w-16 text-center"
          type="number"
          min={0}
          value={away}
          onChange={(e) => setAway(Number(e.target.value))}
        />
        <span className="text-muted">–</span>
        <label className="sr-only" htmlFor={`home-${game.id}`}>
          {game.home_abbr} score
        </label>
        <input
          id={`home-${game.id}`}
          className="input w-16 text-center"
          type="number"
          min={0}
          value={home}
          onChange={(e) => setHome(Number(e.target.value))}
        />
        <button
          className="btn-amber px-3 py-1 text-sm"
          disabled={disabled || pending}
          type="button"
          onClick={() => {
            onError(null);
            startTransition(async () => {
              const res = await setScore(leagueId, game.id, home, away, "final");
              if (res.error) onError(res.error);
              else router.refresh();
            });
          }}
        >
          {pending ? "Saving…" : "Save final"}
        </button>
        {game.manual_override && (
          <button
            className="btn-ghost px-3 py-1 text-sm"
            disabled={disabled || pending}
            type="button"
            title="Remove the manual correction and re-pull this week from ESPN"
            onClick={onUnpin}
          >
            Unpin
          </button>
        )}
      </div>
    </div>
  );
}
