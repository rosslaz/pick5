"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invokeSync, invokeReminderTest } from "@/lib/sync";
import { downloadCsv, slugify } from "@/lib/csv";
import { KickoffTime } from "@/components/kickoff-time";
import { WeekPicker } from "@/components/week-picker";
import type { Game, League, MemberRow } from "@/lib/types";
import {
  regenerateInviteCode,
  releaseOverride,
  renameLeague,
  saveLeagueRules,
  setMemberRole,
  setMemberStatus,
  setReminderLeadHours,
  setRemindersEnabled,
  setScore,
  setScoreFromWeek,
} from "./actions";

export function AdminClient({
  league,
  members,
  currentUserId,
  week,
  currentWeek,
  weekGames,
  gamesLoaded,
  remindersEnabled,
  reminderLeadHours,
  scoreFromWeek,
  auditRows,
  rulesText,
  rulesRequired,
}: {
  league: League;
  members: MemberRow[];
  currentUserId: string;
  week: number;
  currentWeek: number;
  weekGames: Game[];
  gamesLoaded: boolean;
  remindersEnabled: boolean;
  reminderLeadHours: number;
  scoreFromWeek: number | null;
  auditRows: {
    display_name: string;
    pick_order: number;
    change_type: string;
    old_team: string | null;
    new_team: string | null;
    changed_at: string;
  }[];
  rulesText: string;
  rulesRequired: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState(league.invite_code);
  const [name, setName] = useState(league.name);
  const [copied, setCopied] = useState(false);
  const [reminders, setReminders] = useState(remindersEnabled);
  const [leadHours, setLeadHours] = useState(String(reminderLeadHours));
  const [reminderMsg, setReminderMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [testingReminder, setTestingReminder] = useState(false);
  const [resetWeek, setResetWeek] = useState(String(scoreFromWeek ?? currentWeek));
  const [resetMsg, setResetMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [tab, setTab] = useState<"settings" | "games" | "players" | "rules">("games");
  const [rules, setRules] = useState(rulesText);
  const [requireRules, setRequireRules] = useState(rulesRequired);
  const [rulesMsg, setRulesMsg] = useState<{ text: string; error: boolean } | null>(null);
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

  function exportPlayersCsv() {
    downloadCsv(`${slugify(league.name)}-players.csv`, [
      ["Name", "Email", "Role", "Status", "Joined"],
      ...members.map((m) => [
        m.profiles?.display_name ?? "",
        m.profiles?.email ?? "",
        m.role,
        m.status,
        new Date(m.joined_at).toLocaleDateString("en-US"),
      ]),
    ]);
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

  function toggleReminders(next: boolean) {
    setReminderMsg(null);
    setReminders(next); // optimistic
    startTransition(async () => {
      const res = await setRemindersEnabled(league.id, next);
      if (res.error) {
        setReminders(!next); // roll back
        setReminderMsg({ text: res.error, error: true });
      }
    });
  }

  function saveLeadHours() {
    setReminderMsg(null);
    const n = Number(leadHours);
    if (!Number.isInteger(n) || n < 1 || n > 72) {
      setReminderMsg({ text: "Lead time must be a whole number of hours from 1 to 72.", error: true });
      return;
    }
    startTransition(async () => {
      const res = await setReminderLeadHours(league.id, n);
      setReminderMsg(
        res.error
          ? { text: res.error, error: true }
          : { text: `Lead time saved: reminders go out ${n} hour${n === 1 ? "" : "s"} before kickoff.`, error: false }
      );
    });
  }

  function saveRules() {
    setRulesMsg(null);
    startTransition(async () => {
      const res = await saveLeagueRules(league.id, rules, requireRules);
      setRulesMsg(
        res.error
          ? { text: res.error, error: true }
          : {
              text: requireRules
                ? "Rules saved. New players must accept them before entering the league."
                : "Rules saved.",
              error: false,
            }
      );
      if (!res.error) router.refresh();
    });
  }

  function applyReset() {
    setResetMsg(null);
    const n = Number(resetWeek);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      setResetMsg({ text: "Pick a start week between 1 and 30.", error: true });
      return;
    }
    startTransition(async () => {
      const res = await setScoreFromWeek(league.id, n);
      setResetMsg(
        res.error
          ? { text: res.error, error: true }
          : { text: `Overall standings now count from Week ${n} onward.`, error: false }
      );
      if (!res.error) router.refresh();
    });
  }

  function undoReset() {
    setResetMsg(null);
    startTransition(async () => {
      const res = await setScoreFromWeek(league.id, null);
      setResetMsg(
        res.error
          ? { text: res.error, error: true }
          : { text: "Reset undone — standings count the full season again.", error: false }
      );
      if (!res.error) router.refresh();
    });
  }

  async function sendTestReminder() {
    setReminderMsg(null);
    setTestingReminder(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Session expired — sign in again.");
      const result = await invokeReminderTest(token, league.id);
      const r = result?.results?.[0];
      // Surface real outcomes — a failed send must never look like success.
      if (r?.errors?.length) {
        setReminderMsg({
          text: `Send failed for ${r.errors.length} recipient(s). First error: ${r.errors[0]}`,
          error: true,
        });
      } else if (typeof r?.sent === "number" && r.sent > 0 && !r?.note) {
        const extra = r.skipped ? ` (${r.skipped} deferred — daily cap reached)` : "";
        setReminderMsg({ text: `Sent ${r.sent} reminder(s).${extra}`, error: false });
      } else {
        const note = r?.note ?? "Test complete.";
        setReminderMsg({ text: note, error: false });
      }
    } catch (e) {
      setReminderMsg({
        text: e instanceof Error ? e.message : "Test failed.",
        error: true,
      });
    } finally {
      setTestingReminder(false);
    }
  }

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-3xl">Admin — {league.name}</h1>
      {err && <p className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-loss">{err}</p>}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-line">
        {(
          [
            ["games", "Game admin"],
            ["players", "Players"],
            ["rules", "Rules"],
            ["settings", "Settings"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              tab === key
                ? "border-amber text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ===== RULES TAB ===== */}
      <div className={`flex-col gap-8 ${tab === "rules" ? "flex" : "hidden"}`}>
        <section className="card p-5">
          <h2 className="text-2xl">League rules</h2>
          <p className="mt-1 text-sm text-muted">
            Write your league&apos;s rules here — buy-in, payouts, tiebreaks, deadlines, whatever
            your group agrees on. Once saved, they&apos;re available to every player any time from
            the <b>Rules</b> link in the nav.
          </p>

          <label className="mt-4 flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-amber"
              checked={requireRules}
              onChange={(e) => setRequireRules(e.target.checked)}
            />
            <span className="text-sm">
              <b>Display rules at sign up.</b>
              <span className="block text-muted">
                New players must read and accept these rules before they can use the league.
                Anyone who joined earlier and hasn&apos;t accepted will be asked the next time
                they open the league.
              </span>
            </span>
          </label>

          <label htmlFor="rules-text" className="mt-4 block text-sm text-muted">
            Rules
          </label>
          <textarea
            id="rules-text"
            className="input mt-1 min-h-[16rem] w-full font-body leading-relaxed"
            placeholder={"e.g.\n1. $20 buy-in, due before Week 1.\n2. Picks lock at each game's kickoff.\n3. Ties count as a loss.\n4. Perfect slate takes the jackpot."}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">
            Plain text. Line breaks are preserved exactly as you type them.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-amber" type="button" disabled={pending} onClick={saveRules}>
              Save rules
            </button>
            {rulesText && (
              <a className="btn-ghost" href={`/league/${league.id}/rules`}>
                View rules page
              </a>
            )}
          </div>
          {rulesMsg && (
            <p className={`mt-3 text-sm ${rulesMsg.error ? "text-loss" : "text-win"}`}>
              {rulesMsg.text}
            </p>
          )}
        </section>
      </div>
      {/* ===== END RULES TAB ===== */}

      {/* ===== SETTINGS TAB ===== */}
      <div className={`flex-col gap-8 ${tab === "settings" ? "flex" : "hidden"}`}>
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

      {/* Season score reset (half-season payouts) */}
      <section className="card p-5">
        <h2 className="text-2xl">Overall standings window</h2>
        <p className="mt-1 text-sm text-muted">
          For leagues that pay out each half separately, you can make the{" "}
          <b>Overall</b> standings count only from a chosen week onward. This never deletes any
          picks or scores — weekly results are untouched, and you can undo it any time to restore
          the full-season total.
        </p>
        {scoreFromWeek ? (
          <p className="mt-2 text-sm">
            Currently counting{" "}
            <b className="text-amber">from Week {scoreFromWeek} onward</b>.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">Currently counting the full season.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="reset-week" className="text-sm text-muted">
            Count from week
          </label>
          <input
            id="reset-week"
            type="number"
            min={1}
            max={30}
            value={resetWeek}
            onChange={(e) => setResetWeek(e.target.value)}
            className="input w-20"
          />
          <button className="btn-amber" type="button" disabled={pending} onClick={applyReset}>
            Apply
          </button>
          {scoreFromWeek && (
            <button className="btn-ghost" type="button" disabled={pending} onClick={undoReset}>
              Undo (full season)
            </button>
          )}
        </div>
        {resetMsg && (
          <p className={`mt-3 text-sm ${resetMsg.error ? "text-loss" : "text-win"}`}>
            {resetMsg.text}
          </p>
        )}
      </section>

      {/* Email reminders */}
      <section className="card p-5">
        <h2 className="text-2xl">Email reminders</h2>
        <p className="mt-1 text-sm text-muted">
          When enabled, players get nudged before kickoff if they can still make a pick. Weeknight
          and Saturday games send a per-game reminder; the Sunday 1:00 ET slate sends a
          &quot;your picks lock soon&quot; reminder to anyone short of 5. Emails show{" "}
          <b>{league.name}</b> as the sender and replies go to the commissioner. Needs Brevo email
          keys set up — see the README.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className={reminders ? "btn-ghost" : "btn-amber"}
            type="button"
            disabled={pending}
            onClick={() => toggleReminders(!reminders)}
          >
            {reminders ? "Turn off" : "Turn on"}
          </button>
          <span className="text-sm text-muted">
            Reminders are <b className={reminders ? "text-win" : "text-loss"}>{reminders ? "on" : "off"}</b>.
          </span>
          <button
            className="btn-ghost"
            type="button"
            disabled={testingReminder}
            onClick={sendTestReminder}
          >
            {testingReminder ? "Sending…" : "Send test now"}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label htmlFor="lead-hours" className="text-sm text-muted">
            Send reminders
          </label>
          <input
            id="lead-hours"
            type="number"
            min={1}
            max={72}
            value={leadHours}
            onChange={(e) => setLeadHours(e.target.value)}
            className="input w-20"
          />
          <span className="text-sm text-muted">hours before each kickoff.</span>
          <button className="btn-ghost" type="button" disabled={pending} onClick={saveLeadHours}>
            Save
          </button>
        </div>
        {reminderMsg && (
          <p className={`mt-3 text-sm ${reminderMsg.error ? "text-loss" : "text-win"}`}>
            {reminderMsg.text}
          </p>
        )}
      </section>
      </div>
      {/* ===== END SETTINGS TAB ===== */}

      {/* ===== GAME ADMIN TAB (part 1: schedule sync) ===== */}
      <div className={`flex-col gap-8 ${tab === "games" ? "flex" : "hidden"}`}>
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
      </div>
      {/* ===== END GAME ADMIN part 1 ===== */}

      {/* ===== PLAYERS TAB ===== */}
      <div className={`flex-col gap-8 ${tab === "players" ? "flex" : "hidden"}`}>
      {/* Members */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl">Players</h2>
          <button
            className="btn-ghost px-3 py-1 text-sm"
            type="button"
            onClick={exportPlayersCsv}
            title="Download every player's name and email as a CSV file"
          >
            Export CSV
          </button>
        </div>
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
      </div>
      {/* ===== END PLAYERS TAB ===== */}

      {/* ===== GAME ADMIN TAB (part 2: score override + audit) ===== */}
      <div className={`flex-col gap-8 ${tab === "games" ? "flex" : "hidden"}`}>
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

      {/* Pick audit log (lock-gated: only visible once the week is final) */}
      <section className="card p-5">
        <h2 className="text-2xl">Pick audit — week {week}</h2>
        <p className="mt-1 text-sm text-muted">
          A record of every pick change for this week, viewable only after the week is fully
          locked (all games final), so it can never reveal picks early. Only changes made from
          when this feature launched are recorded.
        </p>
        {auditRows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Nothing to show — either the week isn&apos;t fully locked yet, or no pick changes were
            recorded for it.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-2 py-1 font-normal">When</th>
                  <th className="px-2 py-1 font-normal">Player</th>
                  <th className="px-2 py-1 font-normal">Slot</th>
                  <th className="px-2 py-1 font-normal">Change</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((r, i) => (
                  <tr key={i} className="border-b border-line/50">
                    <td className="px-2 py-1 text-muted">
                      {new Date(r.changed_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-2 py-1 font-semibold">{r.display_name}</td>
                    <td className="px-2 py-1">Pick {r.pick_order}</td>
                    <td className="px-2 py-1">
                      {r.change_type === "add" && (
                        <span>
                          added <b className="text-win">{r.new_team}</b>
                        </span>
                      )}
                      {r.change_type === "replace" && (
                        <span>
                          <b className="text-loss">{r.old_team}</b> →{" "}
                          <b className="text-win">{r.new_team}</b>
                        </span>
                      )}
                      {r.change_type === "remove" && (
                        <span>
                          removed <b className="text-loss">{r.old_team}</b>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>
      {/* ===== END GAME ADMIN part 2 ===== */}
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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-line bg-pitch px-3 py-2">
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
      <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
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
