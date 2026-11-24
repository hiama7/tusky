import type { SportCode } from "@tusky/shared";

export type MatchStatus = "scheduled" | "live" | "completed" | "postponed" | "cancelled";

export interface NormalizedTeam {
  externalId: string;
  name: string;
  country: string | null;
  logoUrl: string | null;
  /** Overrides the adapter's provider for team identity (cricket: "cricket", shared by all sources). */
  provider?: string;
}

export interface NormalizedFixture {
  externalId: string;
  startTime: Date;
  venue: string | null;
  city: string | null;
  status: MatchStatus;
  providerStatus: string | null;
  competition: {
    externalId: string;
    name: string;
    country: string | null;
    season: string | null;
    logoUrl: string | null;
  };
  home: NormalizedTeam;
  away: NormalizedTeam;
  /** Final score once the match is completed, otherwise nulls. */
  score: { home: number | null; away: number | null };
  /** Cricket: T20 | ODI | Test. */
  format?: string | null;
  /** Cricket toss, when known. `winnerExternalId` is the home or away team's externalId. */
  toss?: { winnerExternalId: string; decision: "bat" | "field" | null } | null;
  /** Winner's team externalId when the provider states it (needed for cricket ties / DLS). */
  winnerExternalId?: string | null;
  raw: unknown;
}

export interface NormalizedSquadPlayer {
  externalId: string;
  name: string;
  position: string | null;
  nationality: string | null;
  photoUrl: string | null;
}

export interface NormalizedPlayerProfile {
  externalId: string;
  name: string;
  nationality: string | null;
  birthDate: string | null;
  position: string | null;
  photoUrl: string | null;
}

export interface NormalizedSeasonStats {
  season: string;
  competitionExternalId: string | null;
  competitionName: string;
  competitionCountry: string | null;
  teamName: string | null;
  stats: Record<string, unknown>;
}

export interface SportAdapter {
  readonly sport: SportCode;
  readonly provider: string;
  /** Typical match length incl. breaks, used to auto-complete matches with no live feed. */
  readonly matchDurationMinutes: number;

  /** Per-format length (cricket: T20 vs Test). Falls back to matchDurationMinutes. */
  durationMinutes?(format: string | null): number;

  /** False when this source has no squads/player stats to enrich (default true). */
  readonly enrichPlayers?: boolean;

  /** Upcoming fixtures for the given UTC dates (YYYY-MM-DD). */
  fetchUpcoming(dates: string[]): Promise<NormalizedFixture[]>;

  /**
   * Every fixture of one league season (past and future), with final scores where played.
   * Used to backfill training data for the prediction model. Costs ~1 API request.
   */
  fetchSeasonResults(leagueExternalId: string, season: string): Promise<NormalizedFixture[]>;

  /** Current squad of a team. `season` is the competition season of the match being enriched. */
  fetchSquad(teamExternalId: string, season: string | null): Promise<NormalizedSquadPlayer[]>;

  /** Per-season stats for a player. Seasons the plan can't access are skipped, not thrown. */
  fetchPlayerSeasonStats(
    playerExternalId: string,
    seasons: string[],
  ): Promise<{ profile: NormalizedPlayerProfile | null; stats: NormalizedSeasonStats[] }>;

  /** The seasons to fetch stats for, given the competition season of the match. */
  statsSeasons(matchSeason: string | null, now?: Date): string[];
}
