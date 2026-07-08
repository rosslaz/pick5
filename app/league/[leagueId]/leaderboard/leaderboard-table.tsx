"use client";

import { useMemo, useState } from "react";
import { compareKeys, type Slot, type WeeklyRow } from "@/lib/scoring";

export type BoardRow = WeeklyRow & { overallTotal: number; weeksWon: number };

type SortCol = "name" | "week" | "overall";

export function LeaderboardTable({
  rows,
  viewerId,
}: {
  rows: BoardRow[];
  viewerId: string;
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
    return arr;
  }, [rows, col, asc]);

  return (
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
              <td className="px-3 py-2 font-display text-lg text-muted">{row.rank}</td>
              <td className="px-3 py-2 font-semibold">
                {row.name}
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
  );
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
  if (result.state === "loss")
    return (
      <span className="score-cell dim" title={`${abbr} lost`}>
        0
      </span>
    );
  if (result.state === "tie")
    return (
      <span className="score-cell dim" title="Tie — no points">
        0
      </span>
    );
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
