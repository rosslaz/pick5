"use client";

import { useMemo, useState } from "react";
import { compareKeys, type Slot, type WeeklyRow } from "@/lib/scoring";
import { downloadCsv, slugify } from "@/lib/csv";

export type BoardRow = WeeklyRow & {
  overallTotal: number;
  weeksWon: number;
  wins: number;
  losses: number;
  overallRank: number;
  movement: number;
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
      <div className="card overflow-x-auto">
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
                row.userId === viewerId ? "bg-amber/5" : ""
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
                <span
                  className="ml-2 font-body text-xs font-normal text-muted"
                  title="Season pick record (a tied game counts as a loss)"
                >
                  {row.wins}-{row.losses}
                </span>
                {row.userId === viewerId && <span className="ml-1 text-xs text-amber">you</span>}
              </td>
              {row.slots.map((slot, i) => (
                <td key={i} className="px-2 py-2 text-center">
                  <SlotCell slot={slot} />
                </td>
              ))}
              <td className="px-3 py-2 text-right">
                <span className="score-cell">{row.total}</span>
              </td>
              <td className="px-3 py-2 text-right">
                <span
                  className="score-cell"
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
    </div>
  );
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
          active ? "text-amber" : ""
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
        title="Pick submitted — hidden until the Sunday 1:00 ET slate kicks off"
      >
        🔒
      </span>
    );

  const { result, pick, game } = slot;
  const abbr = pick.picked_home ? game.home_abbr : game.away_abbr;

  if (result.state === "win")
    return (
      <span className="score-cell" title={`${abbr} won`}>
        {result.points}
      </span>
    );
  if (result.state === "loss") {
    const tied = game.home_score != null && game.home_score === game.away_score;
    return (
      <span className="score-cell dim" title={tied ? "Tie — counts as a loss" : `${abbr} lost`}>
        0
      </span>
    );
  }
  if (result.state === "live")
    return (
      <span className="score-cell live pulse-live" title={`${abbr} — in progress`}>
        {abbr}
      </span>
    );
  return (
    <span className="score-cell dim" title={`${abbr} — not started`}>
      {abbr}
    </span>
  );
}
