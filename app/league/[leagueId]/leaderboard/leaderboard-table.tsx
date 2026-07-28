"use client";

import { useMemo, useState } from "react";
import { compareKeys, type Slot, type WeeklyRow } from "@/lib/scoring";
import type { Game } from "@/lib/types";
import { downloadCsv, slugify } from "@/lib/csv";

export type BoardRow = WeeklyRow & {
  overallTotal: number;
  weeksWon: number;
  wins: number;
  losses: number;
  overallRank: number;
  movement: number;
  perfectSlate: boolean;
};

type SortCol = "name" | "week" | "overall";

export function LeaderboardTable({
  rows,
  viewerId,
  isAdmin,
  week,
  leagueName,
}: {
  rows: BoardRow[];
  viewerId: string;
  isAdmin: boolean;
  week: number;
  leagueName: string;
}) {
  const [col, setCol] = useState<SortCol>("week");
  const [asc, setAsc] = useState(false);

  function clickSort(c: SortCol) {
    if (c === col) {
      setAsc(!asc);
    } else {
      setCol(c);
      setAsc(c === "name"); // names read A→Z first; totals read best-first
    }
  }

  const sorted = useMemo(() => {
    const arr = [...rows];
    const cmp: Record<SortCol, (a: BoardRow, b: BoardRow) => number> = {
      // Weekly sort uses the full tiebreak key (total, then P1, P2, …).
      week: (a, b) => compareKeys(a.key, b.key) || a.name.localeCompare(b.name),
      overall: (a, b) =>
        b.overallTotal - a.overallTotal || b.weeksWon - a.weeksWon || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name) || compareKeys(a.key, b.key),
    };
    arr.sort(cmp[col]);
    if (asc !== (col === "name")) arr.reverse();
    // The signed-in player is always pinned to the top, keeping their true rank.
    const me = arr.findIndex((r) => r.userId === viewerId);
    if (me > 0) {
      const [row] = arr.splice(me, 1);
      arr.unshift(row);
    }
    return arr;
  }, [rows, col, asc, viewerId]);

  function exportWeekCsv() {
    // Canonical weekly-rank order regardless of the on-screen sort. Slots
    // export exactly what the viewer can see: hidden picks stay "hidden".
    const ordered = [...rows].sort(
      (a, b) => compareKeys(a.key, b.key) || a.name.localeCompare(b.name)
    );
    downloadCsv(`${slugify(leagueName)}-week-${week}-leaderboard.csv`, [
      [
        "Week",
        "Rank",
        "Player",
        "Record",
        "P1",
        "P2",
        "P3",
        "P4",
        "P5",
        "Week Total",
        "Overall Rank",
        "Overall Total",
        "Weeks Won",
      ],
      ...ordered.map((r) => [
        week,
        r.rank,
        r.name,
        `${r.wins}-${r.losses}`,
        ...r.slots.map(slotText),
        r.total,
        r.overallRank,
        r.overallTotal,
        r.weeksWon,
      ]),
    ]);
  }

  return (
    <div>
      {isAdmin && (
        <div className="mb-2 flex justify-end">
          <button
            className="btn-ghost px-3 py-1 text-sm"
            type="button"
            onClick={exportWeekCsv}
            title="Download this week's standings and picks as a CSV file"
          >
            Export week {week} CSV
          </button>
        </div>
      )}
      <div className="card hidden overflow-x-auto md:block">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-xs uppercase text-muted">
            <th className="px-3 py-2 font-medium">#</th>
            <SortHeader
              label="Player"
              active={col === "name"}
              asc={asc}
              onClick={() => clickSort("name")}
            />
            {[1, 2, 3, 4, 5].map((n) => (
              <th key={n} className="px-2 py-2 text-center font-medium">
                P{n}
              </th>
            ))}
            <SortHeader
              label="Week"
              active={col === "week"}
              asc={asc}
              onClick={() => clickSort("week")}
              right
            />
            <SortHeader
              label="Overall"
              active={col === "overall"}
              asc={asc}
              onClick={() => clickSort("overall")}
              right
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.userId}
              className={`border-b border-line/60 ${
                row.perfectSlate
                  ? "bg-gradient-to-r from-yellow-400/15 to-transparent"
                  : row.userId === viewerId
                  ? "bg-chosen/5"
                  : ""
              }`}
            >
              <td
                className="px-3 py-2 font-display text-lg text-muted"
                title={col === "overall" ? "Overall rank" : "Weekly rank"}
              >
                <span className="inline-flex items-center gap-1">
                  {col === "overall" ? row.overallRank : row.rank}
                  {col === "overall" && row.movement !== 0 && (
                    <MovementArrow delta={row.movement} />
                  )}
                </span>
              </td>
              <td className="px-3 py-2 font-semibold">
                {row.name}
                {row.perfectSlate && (
                  <span
                    className="ml-2 rounded-full bg-yellow-400/20 px-2 py-0.5 font-body text-xs font-bold text-yellow-300"
                    title="Perfect slate — picked the 5 highest-scoring winning teams in exact order. Jackpot!"
                  >
                    🏆 PERFECT SLATE
                  </span>
                )}
                <span
                  className="ml-2 font-body text-xs font-normal text-muted"
                  title="Season pick record (a tied game counts as a loss)"
                >
                  {row.wins}-{row.losses}
                </span>
                {row.userId === viewerId && <span className="ml-1 text-xs text-chosen">you</span>}
              </td>
              {row.slots.map((slot, i) => (
                <td key={i} className="px-2 py-2 text-center">
                  <SlotCell slot={slot} />
                </td>
              ))}
              <td className="px-3 py-2 text-right">
                <span className="score-cell total">{row.total}</span>
              </td>
              <td className="px-3 py-2 text-right">
                <span
                  className="score-cell total"
                  title={`${row.weeksWon} week${row.weeksWon === 1 ? "" : "s"} won`}
                >
                  {row.overallTotal}
                </span>
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={9} className="px-3 py-6 text-center text-muted">
                No active players yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {/* Mobile board. The table has nine columns and used to scroll sideways,
       * which pushed P4/P5 and both totals off-screen AND scrolled the player
       * name away, so you lost track of whose row you were reading. Cards keep
       * everything on one screen. The disclosure carries the game scores that
       * live in `title` tooltips on desktop — those never appear on touch. */}
      <MobileBoard rows={sorted} viewerId={viewerId} col={col} />

      <div className="mt-3 flex items-center gap-2 md:hidden">
        <span className="text-xs uppercase text-muted">Sort</span>
        {(["week", "overall", "name"] as SortCol[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => clickSort(c)}
            className={`rounded-md border px-2 py-1 text-xs uppercase transition-colors ${
              col === c ? "border-chosen/60 text-ink" : "border-line text-muted"
            }`}
          >
            {c === "week" ? "Week" : c === "overall" ? "Overall" : "Player"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One card per player, replacing the sideways-scrolling table on phones. */
function MobileBoard({
  rows,
  viewerId,
  col,
}: {
  rows: BoardRow[];
  viewerId: string;
  col: SortCol;
}) {
  return (
    <div className="flex flex-col gap-2 md:hidden">
      {rows.map((row) => (
        <div
          key={row.userId}
          className={`card p-3 ${
            row.perfectSlate
              ? "bg-gradient-to-r from-yellow-400/15 to-transparent"
              : row.userId === viewerId
              ? "bg-chosen/5"
              : ""
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="font-display text-lg text-muted">
                {col === "overall" ? row.overallRank : row.rank}
              </span>
              {col === "overall" && row.movement !== 0 && <MovementArrow delta={row.movement} />}
              <span className="truncate font-semibold">{row.name}</span>
              {row.userId === viewerId && <span className="text-xs text-chosen">you</span>}
              <span className="font-body text-xs font-normal text-muted">
                {row.wins}-{row.losses}
              </span>
            </div>
            <div className="flex shrink-0 gap-3 text-center">
              <div>
                <div className="text-[10px] uppercase leading-none text-muted">Week</div>
                <span className="score-cell total mt-1">{row.total}</span>
              </div>
              <div>
                <div className="text-[10px] uppercase leading-none text-muted">Overall</div>
                <span className="score-cell total mt-1">{row.overallTotal}</span>
              </div>
            </div>
          </div>

          {row.perfectSlate && (
            <div className="mt-2 inline-block rounded-full bg-yellow-400/20 px-2 py-0.5 font-body text-xs font-bold text-yellow-300">
              🏆 PERFECT SLATE
            </div>
          )}

          <div className="mt-3 grid grid-cols-5 gap-1">
            {row.slots.map((slot, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <span className="text-[10px] uppercase leading-none text-muted">P{i + 1}</span>
                <SlotCell slot={slot} />
              </div>
            ))}
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted">Game scores</summary>
            <ul className="mt-1 space-y-1 text-xs text-muted">
              {row.slots.map((slot, i) => (
                <li key={i}>
                  <span className="text-muted/70">P{i + 1}</span> {slotDetail(slot)}
                </li>
              ))}
            </ul>
          </details>
        </div>
      ))}
      {rows.length === 0 && (
        <p className="card p-4 text-center text-muted">No active players yet.</p>
      )}
    </div>
  );
}

/** Full-sentence detail for the mobile disclosure (desktop uses tooltips). */
function slotDetail(slot: Slot): string {
  if (slot.kind === "empty") return "no pick submitted";
  if (slot.kind === "hidden") return "pick hidden until the Sunday 1:00 ET lock";
  const { game, pick, result } = slot;
  const abbr = pick.picked_home ? game.home_abbr : game.away_abbr;
  const score = scoreLine(game);
  if (result.state === "win") return `${score} — ${abbr} won, ${result.points} pts`;
  if (result.state === "loss") {
    const tied = game.home_score != null && game.home_score === game.away_score;
    return `${score} — ${tied ? "tie, counts as a loss" : `${abbr} lost`}`;
  }
  if (result.state === "live") return `${score} — in progress`;
  return `${score} — not started`;
}

/** Rank movement since last completed week. delta>0 = moved up. */
function MovementArrow({ delta }: { delta: number }) {
  const up = delta > 0;
  return (
    <span
      className={`font-body text-xs font-semibold ${up ? "text-win" : "text-loss"}`}
      title={`${up ? "Up" : "Down"} ${Math.abs(delta)} since last week`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(delta)}
    </span>
  );
}

/** Plain-text slot for CSV export — mirrors what the viewer sees on screen. */
function slotText(slot: Slot): string {
  if (slot.kind === "empty") return "--";
  if (slot.kind === "hidden") return "hidden";
  const abbr = slot.pick.picked_home ? slot.game.home_abbr : slot.game.away_abbr;
  const r = slot.result;
  if (r.state === "win") return `${abbr} (${r.points})`;
  if (r.state === "loss") return `${abbr} (0)`;
  if (r.state === "live") return `${abbr} (live)`;
  return abbr; // scheduled, not yet kicked off
}

function SortHeader({
  label,
  active,
  asc,
  onClick,
  right,
}: {
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
  right?: boolean;
}) {
  return (
    <th
      className={`px-3 py-2 font-medium ${right ? "text-right" : ""}`}
      aria-sort={active ? (asc ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase transition-colors hover:text-ink ${
          active ? "text-chosen" : ""
        }`}
      >
        {label}
        <span aria-hidden className={active ? "" : "opacity-30"}>
          {active ? (asc ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

/**
 * The actual game score for a tooltip, e.g. "NE 21 - SEA 21". Falls back to
 * the matchup when the game has no score yet.
 */
function scoreLine(game: Game): string {
  if (game.away_score == null || game.home_score == null) {
    return `${game.away_abbr} @ ${game.home_abbr}`;
  }
  return `${game.away_abbr} ${game.away_score} - ${game.home_abbr} ${game.home_score}`;
}

function SlotCell({ slot }: { slot: Slot }) {
  if (slot.kind === "empty")
    return (
      <span className="score-cell dim" title="No pick submitted">
        --
      </span>
    );
  if (slot.kind === "hidden")
    return (
      <span
        className="score-cell dim"
        title="Pick submitted — hidden until the Sunday 1:00 ET lock"
      >
        🔒
      </span>
    );

  const { result, pick, game } = slot;
  const abbr = pick.picked_home ? game.home_abbr : game.away_abbr;
  const score = scoreLine(game);

  // The team you picked stays visible in every state — previously a scored
  // game replaced it with just the points, so you lost track of who you took.
  if (result.state === "win")
    return (
      <span
        className="score-cell slot win"
        title={`${score} · ${abbr} won — ${result.points} points`}
      >
        <span className="slot-abbr">{abbr}</span>
        <span className="slot-pts">{result.points}</span>
      </span>
    );

  if (result.state === "loss") {
    const tied = game.home_score != null && game.home_score === game.away_score;
    return (
      <span
        className="score-cell slot loss"
        title={`${score} · ${tied ? "tie — counts as a loss" : `${abbr} lost`}`}
      >
        <span className="slot-abbr">{abbr}</span>
        <span className="slot-pts">0</span>
      </span>
    );
  }

  if (result.state === "live")
    return (
      <span className="score-cell slot live pulse-live" title={`${score} · in progress`}>
        <span className="slot-abbr">{abbr}</span>
        <span className="slot-pts">live</span>
      </span>
    );

  return (
    <span className="score-cell slot dim" title={`${score} · not started`}>
      <span className="slot-abbr">{abbr}</span>
    </span>
  );
}
