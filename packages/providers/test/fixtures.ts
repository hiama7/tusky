import type { RawFootballFixture, RawFootballPlayerStats } from "../src/index.ts";

/** Trimmed, recorded-shape API-Football v3 payloads used by tests. */
export const fixtureNS: RawFootballFixture = {
  fixture: {
    id: 1208001,
    date: "2026-11-22T15:00:00+00:00",
    venue: { name: "Example Park", city: "Exampleton" },
    status: { short: "NS", long: "Not Started" },
  },
  league: { id: 39, name: "Premier League", country: "England", logo: "https://media.api-sports.io/football/leagues/39.png", season: 2026 },
  teams: {
    home: { id: 50, name: "Home United", logo: null },
    away: { id: 42, name: "Away City", logo: null },
  },
};

export const fixtureOtherLeague: RawFootballFixture = {
  ...fixtureNS,
  fixture: { ...fixtureNS.fixture, id: 1208002 },
  league: { ...fixtureNS.league, id: 999, name: "Other League" },
};

export const squadResponse = [
  {
    team: { id: 50, name: "Home United" },
    players: [
      { id: 1001, name: "A. Keeper", position: "Goalkeeper", photo: null },
      { id: 1002, name: "B. Striker", position: "Attacker", photo: null },
    ],
  },
];

export const playerStatsResponse: RawFootballPlayerStats[] = [
  {
    player: { id: 1002, name: "B. Striker", nationality: "England", birth: { date: "2000-02-02" }, photo: null },
    statistics: [
      {
        team: { id: 50, name: "Home United" },
        league: { id: 39, name: "Premier League", country: "England", season: 2026 },
        games: { appearences: 12, lineups: 11, minutes: 980, position: "Attacker", rating: "7.25" },
        shots: { total: 40, on: 21 },
        goals: { total: 9, conceded: 0, assists: 2, saves: null },
        passes: { total: 210, key: 14, accuracy: "78" },
        tackles: { total: 5, interceptions: 2 },
        duels: { total: 120, won: 55 },
        dribbles: { attempts: 20, success: 11 },
        fouls: { drawn: 18, committed: 9 },
        cards: { yellow: 2, red: 0 },
        penalty: { scored: 2, missed: 1, saved: null },
      },
      {
        team: { id: 50, name: "Home United" },
        league: { id: 45, name: "FA Cup", country: "England", season: 2026 },
        games: { appearences: 0, lineups: 0, minutes: 0, position: "Attacker", rating: null },
        shots: { total: null, on: null },
        goals: { total: 0, conceded: 0, assists: null, saves: null },
        passes: { total: null, key: null, accuracy: null },
        tackles: { total: null, interceptions: null },
        duels: { total: null, won: null },
        dribbles: { attempts: null, success: null },
        fouls: { drawn: null, committed: null },
        cards: { yellow: 0, red: 0 },
        penalty: { scored: 0, missed: 0, saved: null },
      },
    ],
  },
];

export function envelope<T>(response: T[], extra: Partial<{ errors: unknown; paging: { current: number; total: number } }> = {}) {
  return { get: "", parameters: {}, errors: [], results: response.length, paging: { current: 1, total: 1 }, response, ...extra };
}
