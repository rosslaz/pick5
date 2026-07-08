export type GameStatus = "scheduled" | "in_progress" | "final";

export interface Game {
  id: string;
  espn_id: string;
  season: number;
  week: number;
  kickoff: string;
  home_team: string;
  away_team: string;
  home_abbr: string;
  away_abbr: string;
  home_logo: string | null;
  away_logo: string | null;
  home_score: number | null;
  away_score: number | null;
  status: GameStatus;
  manual_override: boolean;
  updated_at: string;
}

export interface PickRow {
  id: string;
  league_id: string;
  user_id: string;
  game_id: string;
  picked_home: boolean;
  pick_order: number;
  season: number;
  week: number;
  games?: Game | null;
}

export interface League {
  id: string;
  name: string;
  invite_code: string;
  season: number;
}

export interface MemberRow {
  user_id: string;
  role: "admin" | "player";
  status: "active" | "removed";
  joined_at: string;
  profiles: { display_name: string; email: string } | null;
}
