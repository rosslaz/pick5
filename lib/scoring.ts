import { Game, MemberRow, PickRow } from "@/lib/types";
import { PICKS_PER_WEEK } from "@/lib/config";

export type PickState = "pending" | "live" | "win" | "loss";

export interface PickResult {
  state: PickState;
  points: number;
}

/**
 * Correct pick = the points the picked team scored. Anything else = 0,
 * including an NFL tie — you didn't pick a winner, so it counts as a loss.
 */
export function pickResult(pick: PickRow, game: Game): PickResult {
  if (game.status !== "final" || game.home_score == null || game.away_score == null) {
    return { state: game.status === "in_progress" ? "live" : "pending", points: 0 };
  }
  const homeWon = game.home_score > game.away_score;
  if (game.home_score !== game.away_score && pick.picked_home === homeWon) {
    return { state: "win", points: pick.picked_home ? game.home_score : game.away_score };
  }
  return { state: "loss", points: 0 };
}

export type Slot =
  | { kind: "pick"; pick: PickRow; game: Game; result: PickResult }
  | { kind: "hidden" } // pick submitted; details hidden until that game kicks off
  | { kind: "empty" }; // no pick submitted for this slot

export interface WeeklyRow {
  userId: string;
  name: string;
  slots: Slot[];
  total: number;
  /** total followed by per-slot points — the tiebreaker comparison key */
  key: number[];
  rank: number;
}

/** Compare tiebreak keys: higher total first, then Pick 1 points, Pick 2… */
export function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Build one week's leaderboard. `picks` must already be filtered to that week.
 * `submittedSlots` holds a "userId:pickOrder" key for every saved pick in the
 * week (visible or not, via the get_pick_slots RPC) so a slot with an
 * unrevealed pick renders as hidden rather than empty.
 */
export function buildWeeklyBoard(
  members: MemberRow[],
  picks: PickRow[],
  viewerId: string,
  submittedSlots?: Set<string>
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
        } else if (submittedSlots?.has(`${m.user_id}:${order}`)) {
          slots.push({ kind: "hidden" });
          slotPoints.push(0);
        } else {
          slots.push({ kind: "empty" });
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
