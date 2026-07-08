interface WeekGame {
  week: number;
  status: string;
  kickoff: string;
}

// A game that never goes final (postponed, cancelled, or a missed sync) must
// not pin the app to an old week forever — see Bills–Bengals, January 2023.
// After this grace period past kickoff, a non-final game is treated as closed
// for week-navigation purposes.
const STUCK_GAME_GRACE_MS = 36 * 60 * 60 * 1000;

/** The week players should be picking: the earliest week with an unfinished game. */
export function computeCurrentWeek(games: WeekGame[]): number {
  if (games.length === 0) return 1;
  const now = Date.now();
  const open = games
    .filter(
      (g) =>
        g.status !== "final" &&
        new Date(g.kickoff).getTime() > now - STUCK_GAME_GRACE_MS
    )
    .map((g) => g.week);
  if (open.length > 0) return Math.min(...open);
  return Math.max(...games.map((g) => g.week));
}

/** The most interesting week to show on the leaderboard: latest week with a kicked-off game. */
export function latestActiveWeek(games: WeekGame[]): number {
  const now = Date.now();
  const started = games
    .filter((g) => new Date(g.kickoff).getTime() <= now)
    .map((g) => g.week);
  if (started.length > 0) return Math.max(...started);
  return computeCurrentWeek(games);
}
