import { Game, MemberRow, PickRow } from "@/lib/types";
import { PICKS_PER_WEEK } from "@/lib/config";

export type PickState = "pending" | "live" | "win" | "loss" | "tie";

export interface PickResult {
  state: PickState;
  points: number;
}

/** Correct pick = the points the picked team scored. Wrong pick (or NFL tie) = 0. */
export function pickResult(pick: PickRow, game: Game): PickResult {
  if (game.status !== "final" || game.home_score == null || game.away_score == null) {
    return { state: game.status === "in_progress" ? "live" : "pending", points: 0 };
  }
  if (game.home_score === game.away_score) return { state: "tie", points: 0 };
  const homeWon = game.home_score > game.away_score;
  if (pick.picked_home === homeWon) {
    return { state: "win", points: pick.picked_home ? game.home_score : game.away_score };
  }
  return { state: "loss", points: 0 };
}

export type Slot =
  | { kind: "pick"; pick: PickRow; game: Game; result: PickResult }
  | { kind: "unknown" } // another player's slot: hidden until kickoff, or no pick made
  | { kind: "empty" }; // viewer's own slot with no pick

export interface WeeklyRow {
  userId: string;
  name: string;
  slots: Slot[];
  total: number;
  /** total followed by per-slot points — the tiebreaker comparison key */
  key: number[];
  rank: number;
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Build one week's leaderboard. `picks` must already be filtered to that week. */
export function buildWeeklyBoard(
  members: MemberRow[],
  picks: PickRow[],
  viewerId: string
): WeeklyRow[] {
  const rows: WeeklyRow[] = members
    .filter((m) => m.status === "active")
    .map((m) => {
      const mine = picks.filter((p) => p.user_id === m.user_id);
      const slots: Slot[] = [];
      const slotPoints: number[] = [];
      let total = 0;
      for (let order = 1; order <= PICKS_PER_WEEK; order++) {
        const pick = mine.find((p) => p.pick_order === order);
        if (pick && pick.games) {
          const result = pickResult(pick, pick.games);
          slots.push({ kind: "pick", pick, game: pick.games, result });
          slotPoints.push(result.points);
          total += result.points;
        } else {
          slots.push(m.user_id === viewerId ? { kind: "empty" } : { kind: "unknown" });
          slotPoints.push(0);
        }
      }
      return {
        userId: m.user_id,
        name: m.profiles?.display_name ?? "Unknown",
        slots,
        total,
        key: [total, ...slotPoints],
        rank: 0,
      };
    });

  rows.sort((a, b) => compareKeys(a.key, b.key) || a.name.localeCompare(b.name));
  rows.forEach((row, i) => {
    row.rank = i > 0 && compareKeys(row.key, rows[i - 1].key) === 0 ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

export interface OverallRow {
  userId: string;
  name: string;
  total: number;
  weeksWon: number;
  rank: number;
}

/**
 * Season standings: sum of weekly points. Ties broken by number of weekly wins
 * (a week counts as won once every game that week is final).
 */
export function buildOverallBoard(
  members: MemberRow[],
  picks: PickRow[],
  allGames: Pick<Game, "week" | "status">[],
  viewerId: string
): OverallRow[] {
  const weeks = Array.from(new Set(picks.map((p) => p.week))).sort((a, b) => a - b);
  const totals = new Map<string, number>();
  const wins = new Map<string, number>();

  for (const week of weeks) {
    const weekRows = buildWeeklyBoard(
      members,
      picks.filter((p) => p.week === week),
      viewerId
    );
    for (const row of weekRows) {
      totals.set(row.userId, (totals.get(row.userId) ?? 0) + row.total);
    }
    const weekGames = allGames.filter((g) => g.week === week);
    const weekDone = weekGames.length > 0 && weekGames.every((g) => g.status === "final");
    // A week only produces a winner once every game is final AND someone
    // actually scored — otherwise an empty week hands everyone a "win".
    if (weekDone && weekRows.length > 0 && weekRows[0].total > 0) {
      for (const row of weekRows.filter((r) => r.rank === 1)) {
        wins.set(row.userId, (wins.get(row.userId) ?? 0) + 1);
      }
    }
  }

  const rows: OverallRow[] = members
    .filter((m) => m.status === "active")
    .map((m) => ({
      userId: m.user_id,
      name: m.profiles?.display_name ?? "Unknown",
      total: totals.get(m.user_id) ?? 0,
      weeksWon: wins.get(m.user_id) ?? 0,
      rank: 0,
    }));

  rows.sort(
    (a, b) => b.total - a.total || b.weeksWon - a.weeksWon || a.name.localeCompare(b.name)
  );
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.rank =
      i > 0 && prev.total === row.total && prev.weeksWon === row.weeksWon ? prev.rank : i + 1;
  });
  return rows;
}
