interface WeekGame {
  week: number;
  status: string;
  kickoff: string;
}

/** The week players should be picking: the earliest week with an unfinished game. */
export function computeCurrentWeek(games: WeekGame[]): number {
  if (games.length === 0) return 1;
  const open = games.filter((g) => g.status !== "final").map((g) => g.week);
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
