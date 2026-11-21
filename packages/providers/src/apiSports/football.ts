import type { FootballStats } from "@tusky/shared";
import type {
  MatchStatus,
  NormalizedFixture,
  NormalizedPlayerProfile,
  NormalizedSeasonStats,
  NormalizedSquadPlayer,
  SportAdapter,
} from "../types.ts";
import { API_SPORTS_PROVIDER, ApiSportsClient, ApiSportsError } from "./client.ts";

// ---- raw API-Football v3 shapes (only the fields we use) -------------------

export interface RawFootballFixture {
  fixture: {
    id: number;
    date: string;
    venue?: { name: string | null; city: string | null } | null;
    status: { short: string; long?: string };
  };
  league: { id: number; name: string; country: string | null; logo: string | null; season: number | null };
  teams: {
    home: { id: number; name: string; logo: string | null };
    away: { id: number; name: string; logo: string | null };
  };
}

interface RawSquad {
  team: { id: number; name: string };
  players: { id: number; name: string; position: string | null; photo: string | null }[];
}

type N = number | null | undefined;
export interface RawFootballPlayerStats {
  player: {
    id: number;
    name: string;
    nationality: string | null;
    birth?: { date: string | null } | null;
    photo: string | null;
  };
  statistics: {
    team: { id: number; name: string } | null;
    league: { id: number | null; name: string; country: string | null; season: number | null };
    games: { appearences: N; lineups: N; minutes: N; position: string | null; rating: string | null };
    shots: { total: N; on: N };
    goals: { total: N; conceded: N; assists: N; saves: N };
    passes: { total: N; key: N; accuracy: N | string };
    tackles: { total: N; interceptions: N };
    duels: { total: N; won: N };
    dribbles: { attempts: N; success: N };
    fouls: { drawn: N; committed: N };
    cards: { yellow: N; red: N };
    penalty: { scored: N; missed: N; saved: N };
  }[];
}

// ---- mapping ----------------------------------------------------------------

const LIVE = new Set(["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);
const DONE = new Set(["FT", "AET", "PEN"]);
const CANCELLED = new Set(["CANC", "ABD", "AWD", "WO"]);

export function mapFootballStatus(short: string): MatchStatus {
  if (LIVE.has(short)) return "live";
  if (DONE.has(short)) return "completed";
  if (short === "PST") return "postponed";
  if (CANCELLED.has(short)) return "cancelled";
  return "scheduled"; // NS, TBD
}

export function mapFootballFixture(f: RawFootballFixture): NormalizedFixture {
  return {
    externalId: String(f.fixture.id),
    startTime: new Date(f.fixture.date),
    venue: f.fixture.venue?.name ?? null,
    city: f.fixture.venue?.city ?? null,
    status: mapFootballStatus(f.fixture.status.short),
    providerStatus: f.fixture.status.short,
    competition: {
      externalId: String(f.league.id),
      name: f.league.name,
      country: f.league.country ?? null,
      season: f.league.season != null ? String(f.league.season) : null,
      logoUrl: f.league.logo ?? null,
    },
    home: { externalId: String(f.teams.home.id), name: f.teams.home.name, country: f.league.country ?? null, logoUrl: f.teams.home.logo },
    away: { externalId: String(f.teams.away.id), name: f.teams.away.name, country: f.league.country ?? null, logoUrl: f.teams.away.logo },
    raw: f,
  };
}

const num = (v: N | string): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};

export function mapFootballStats(s: RawFootballPlayerStats["statistics"][number]): FootballStats {
  return {
    appearances: num(s.games.appearences),
    lineups: num(s.games.lineups),
    minutes: num(s.games.minutes),
    position: s.games.position ?? null,
    rating: num(s.games.rating),
    goals: num(s.goals.total),
    assists: num(s.goals.assists),
    conceded: num(s.goals.conceded),
    saves: num(s.goals.saves),
    shotsTotal: num(s.shots.total),
    shotsOnTarget: num(s.shots.on),
    passesTotal: num(s.passes.total),
    passesKey: num(s.passes.key),
    passAccuracy: num(s.passes.accuracy),
    tackles: num(s.tackles.total),
    interceptions: num(s.tackles.interceptions),
    duelsTotal: num(s.duels.total),
    duelsWon: num(s.duels.won),
    dribblesAttempts: num(s.dribbles.attempts),
    dribblesSuccess: num(s.dribbles.success),
    foulsDrawn: num(s.fouls.drawn),
    foulsCommitted: num(s.fouls.committed),
    yellowCards: num(s.cards.yellow),
    redCards: num(s.cards.red),
    penaltiesScored: num(s.penalty.scored),
    penaltiesMissed: num(s.penalty.missed),
    penaltiesSaved: num(s.penalty.saved),
  };
}

// ---- adapter ----------------------------------------------------------------

export class FootballAdapter implements SportAdapter {
  readonly sport = "football" as const;
  readonly provider = API_SPORTS_PROVIDER;
  readonly matchDurationMinutes = 135;

  constructor(
    private readonly client = new ApiSportsClient("football"),
    private readonly leagueIds: string[] = [],
  ) {}

  async fetchUpcoming(dates: string[]): Promise<NormalizedFixture[]> {
    const out: NormalizedFixture[] = [];
    for (const date of dates) {
      // One request per day returns every fixture worldwide (timezone UTC).
      const raw = await this.client.get<RawFootballFixture>("/fixtures", { date, timezone: "UTC" });
      for (const f of raw) {
        if (this.leagueIds.length && !this.leagueIds.includes(String(f.league.id))) continue;
        out.push(mapFootballFixture(f));
      }
    }
    return out;
  }

  async fetchSquad(teamExternalId: string): Promise<NormalizedSquadPlayer[]> {
    const raw = await this.client.get<RawSquad>("/players/squads", { team: teamExternalId });
    return (raw[0]?.players ?? []).map((p) => ({
      externalId: String(p.id),
      name: p.name,
      position: p.position ?? null,
      nationality: null,
      photoUrl: p.photo ?? null,
    }));
  }

  async fetchPlayerSeasonStats(playerExternalId: string, seasons: string[]) {
    let profile: NormalizedPlayerProfile | null = null;
    const stats: NormalizedSeasonStats[] = [];
    for (const season of seasons) {
      let raw: RawFootballPlayerStats[];
      try {
        raw = await this.client.get<RawFootballPlayerStats>("/players", { id: playerExternalId, season });
      } catch (err) {
        // Free plans can't access every season; skip it rather than failing the whole job.
        if (err instanceof ApiSportsError && !err.retryable) continue;
        throw err;
      }
      const entry = raw[0];
      if (!entry) continue;
      profile ??= {
        externalId: String(entry.player.id),
        name: entry.player.name,
        nationality: entry.player.nationality ?? null,
        birthDate: entry.player.birth?.date ?? null,
        position: entry.statistics.find((s) => s.games.position)?.games.position ?? null,
        photoUrl: entry.player.photo ?? null,
      };
      for (const s of entry.statistics) {
        const mapped = mapFootballStats(s);
        if (!mapped.appearances && !mapped.minutes) continue; // skip empty bench-only rows
        stats.push({
          season,
          competitionExternalId: s.league.id != null ? String(s.league.id) : null,
          competitionName: s.league.name,
          competitionCountry: s.league.country ?? null,
          teamName: s.team?.name ?? null,
          stats: mapped,
        });
      }
    }
    return { profile, stats };
  }

  /** Football seasons are keyed by start year (2025 = 2025/26). Current + previous. */
  statsSeasons(matchSeason: string | null, now = new Date()): string[] {
    const current = matchSeason ? Number(matchSeason) : now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    return [String(current), String(current - 1)];
  }
}
