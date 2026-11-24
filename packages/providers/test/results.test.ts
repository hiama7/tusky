import { describe, expect, it } from "vitest";
import {
  ApiSportsClient,
  BasketballAdapter,
  FootballAdapter,
  mapBasketballGame,
  mapFootballFixture,
  type FetchLike,
  type QuotaGuard,
  type RawBasketballGame,
  type RawFootballFixture,
} from "../src/index.ts";
import { envelope, fixtureNS } from "./fixtures.ts";

const noQuota: QuotaGuard = { reserve: async () => {} };

const finishedAet: RawFootballFixture = {
  ...fixtureNS,
  fixture: { ...fixtureNS.fixture, id: 1100, status: { short: "AET" } },
  goals: { home: 3, away: 2 },
  score: { fulltime: { home: 2, away: 2 } },
};

describe("final scores", () => {
  it("football: uses the 90-minute score for completed fixtures", () => {
    expect(mapFootballFixture(finishedAet).score).toEqual({ home: 2, away: 2 });
  });

  it("football: falls back to goals when fulltime is missing", () => {
    const f = { ...finishedAet, fixture: { ...finishedAet.fixture, status: { short: "FT" } }, score: null };
    expect(mapFootballFixture(f).score).toEqual({ home: 3, away: 2 });
  });

  it("football: no score for scheduled or live fixtures", () => {
    expect(mapFootballFixture(fixtureNS).score).toEqual({ home: null, away: null });
    const live = { ...finishedAet, fixture: { ...finishedAet.fixture, status: { short: "2H" } } };
    expect(mapFootballFixture(live).score).toEqual({ home: null, away: null });
  });

  it("basketball: total incl. OT for finished games only", () => {
    const g: RawBasketballGame = {
      id: 7,
      date: "2024-01-01T01:00:00+00:00",
      status: { short: "AOT" },
      league: { id: 12, name: "NBA", season: "2023-2024", logo: null },
      country: { name: "USA" },
      teams: { home: { id: 1, name: "A", logo: null }, away: { id: 2, name: "B", logo: null } },
      scores: { home: { total: 118 }, away: { total: 112 } },
    };
    expect(mapBasketballGame(g).score).toEqual({ home: 118, away: 112 });
    expect(mapBasketballGame({ ...g, status: { short: "NS" } }).score).toEqual({ home: null, away: null });
  });
});

describe("fetchSeasonResults", () => {
  it("football: one /fixtures call by league+season, all pages", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      const page = new URL(url).searchParams.get("page") ?? "1";
      const body =
        page === "1"
          ? envelope([finishedAet], { paging: { current: 1, total: 2 } })
          : envelope([fixtureNS], { paging: { current: 2, total: 2 } });
      return { ok: true, status: 200, json: async () => body };
    };
    const adapter = new FootballAdapter(new ApiSportsClient("football", { apiKey: "k", fetchImpl, quota: noQuota, minIntervalMs: 0 }));
    const out = await adapter.fetchSeasonResults("39", "2023");
    expect(out.map((f) => f.score.home)).toEqual([2, null]);
    const first = new URL(calls[0]!);
    expect(first.pathname).toBe("/fixtures");
    expect(first.searchParams.get("league")).toBe("39");
    expect(first.searchParams.get("season")).toBe("2023");
    expect(calls).toHaveLength(2);
  });

  it("basketball: /games by league+season", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => envelope([]) };
    };
    const adapter = new BasketballAdapter(new ApiSportsClient("basketball", { apiKey: "k", fetchImpl, quota: noQuota, minIntervalMs: 0 }));
    await adapter.fetchSeasonResults("12", "2023-2024");
    const u = new URL(calls[0]!);
    expect(u.pathname).toBe("/games");
    expect(u.searchParams.get("season")).toBe("2023-2024");
  });
});
