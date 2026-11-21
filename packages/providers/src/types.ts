import type { SportCode } from "@tusky/shared";

export type MatchStatus = "scheduled" | "live" | "completed" | "postponed" | "cancelled";

export interface NormalizedTeam {
  externalId: string;
  name: string;
  country: string | null;
  logoUrl: string | null;
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

  /** Upcoming fixtures for the given UTC dates (YYYY-MM-DD). */
  fetchUpcoming(dates: string[]): Promise<NormalizedFixture[]>;

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
