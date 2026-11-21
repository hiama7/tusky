import type {
  MatchStatus,
  NormalizedFixture,
  NormalizedPlayerProfile,
  NormalizedSeasonStats,
  NormalizedSquadPlayer,
  SportAdapter,
} from "../types.ts";
import { API_SPORTS_PROVIDER, ApiSportsClient } from "./client.ts";

export interface RawBasketballGame {
  id: number;
  date: string;
  status: { short: string; long?: string };
  league: { id: number; name: string; season: string | number | null; logo: string | null };
  country: { name: string | null } | null;
  teams: {
    home: { id: number; name: string; logo: string | null };
    away: { id: number; name: string; logo: string | null };
  };
}

interface RawBasketballPlayer {
  id: number;
  name: string;
  position: string | null;
  country: string | null;
}

const LIVE = new Set(["Q1", "Q2", "Q3", "Q4", "OT", "BT", "HT"]);
const DONE = new Set(["FT", "AOT"]);
const CANCELLED = new Set(["CANC", "ABD", "AWD"]);

export function mapBasketballStatus(short: string): MatchStatus {
  if (LIVE.has(short)) return "live";
  if (DONE.has(short)) return "completed";
  if (short === "POST") return "postponed";
  if (CANCELLED.has(short)) return "cancelled";
  return "scheduled";
}

export function mapBasketballGame(g: RawBasketballGame): NormalizedFixture {
  const country = g.country?.name ?? null;
  return {
    externalId: String(g.id),
    startTime: new Date(g.date),
    venue: null,
    city: null,
    status: mapBasketballStatus(g.status.short),
    providerStatus: g.status.short,
    competition: {
      externalId: String(g.league.id),
      name: g.league.name,
      country,
      season: g.league.season != null ? String(g.league.season) : null,
      logoUrl: g.league.logo ?? null,
    },
    home: { externalId: String(g.teams.home.id), name: g.teams.home.name, country, logoUrl: g.teams.home.logo },
    away: { externalId: String(g.teams.away.id), name: g.teams.away.name, country, logoUrl: g.teams.away.logo },
    raw: g,
  };
}

/**
 * Basketball adapter. API-Basketball exposes squads but no per-season player aggregates,
 * so `fetchPlayerSeasonStats` returns nothing and the LLM research step fills the gap.
 */
export class BasketballAdapter implements SportAdapter {
  readonly sport = "basketball" as const;
  readonly provider = API_SPORTS_PROVIDER;
  readonly matchDurationMinutes = 150;

  constructor(
    private readonly client = new ApiSportsClient("basketball"),
    private readonly leagueIds: string[] = [],
  ) {}

  async fetchUpcoming(dates: string[]): Promise<NormalizedFixture[]> {
    const out: NormalizedFixture[] = [];
    for (const date of dates) {
      const raw = await this.client.get<RawBasketballGame>("/games", { date, timezone: "UTC" });
      for (const g of raw) {
        if (this.leagueIds.length && !this.leagueIds.includes(String(g.league.id))) continue;
        out.push(mapBasketballGame(g));
      }
    }
    return out;
  }

  async fetchSquad(teamExternalId: string, season: string | null): Promise<NormalizedSquadPlayer[]> {
    const params: Record<string, string> = { team: teamExternalId };
    if (season) params.season = season;
    const raw = await this.client.get<RawBasketballPlayer>("/players", params);
    return raw.map((p) => ({
      externalId: String(p.id),
      name: p.name,
      position: p.position ?? null,
      nationality: p.country ?? null,
      photoUrl: null,
    }));
  }

  async fetchPlayerSeasonStats(): Promise<{ profile: NormalizedPlayerProfile | null; stats: NormalizedSeasonStats[] }> {
    return { profile: null, stats: [] };
  }

  statsSeasons(matchSeason: string | null): string[] {
    return matchSeason ? [matchSeason] : [];
  }
}
