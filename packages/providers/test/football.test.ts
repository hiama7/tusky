import { describe, expect, it, vi } from "vitest";
import { FootballStatsSchema } from "@tusky/shared";
import {
  ApiSportsClient,
  ApiSportsError,
  FootballAdapter,
  mapFootballFixture,
  mapFootballStatus,
  nextQuotaReset,
  QuotaExceededError,
  type FetchLike,
  type QuotaGuard,
} from "../src/index.ts";
import { envelope, fixtureNS, fixtureOtherLeague, playerStatsResponse, squadResponse } from "./fixtures.ts";

const noQuota: QuotaGuard = { reserve: async () => {} };

function fakeFetch(routes: Record<string, (url: URL) => unknown>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const handler = routes[u.pathname];
    if (!handler) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => handler(u) };
  };
  return Object.assign(fn, { calls });
}

const client = (fetchImpl: FetchLike, quota = noQuota) =>
  new ApiSportsClient("football", { apiKey: "k", fetchImpl, quota, minIntervalMs: 0 });

describe("football mapping", () => {
  it.each([
    ["NS", "scheduled"],
    ["TBD", "scheduled"],
    ["1H", "live"],
    ["HT", "live"],
    ["FT", "completed"],
    ["PEN", "completed"],
    ["PST", "postponed"],
    ["CANC", "cancelled"],
  ] as const)("status %s -> %s", (short, expected) => {
    expect(mapFootballStatus(short)).toBe(expected);
  });

  it("normalizes a fixture", () => {
    const f = mapFootballFixture(fixtureNS);
    expect(f).toMatchObject({
      externalId: "1208001",
      status: "scheduled",
      venue: "Example Park",
      competition: { externalId: "39", name: "Premier League", season: "2026" },
      home: { externalId: "50", name: "Home United" },
      away: { externalId: "42", name: "Away City" },
    });
    expect(f.startTime.toISOString()).toBe("2026-11-22T15:00:00.000Z");
  });
});

describe("FootballAdapter", () => {
  it("fetches fixtures per day and applies the league filter", async () => {
    const fetchImpl = fakeFetch({ "/fixtures": () => envelope([fixtureNS, fixtureOtherLeague]) });
    const adapter = new FootballAdapter(client(fetchImpl), ["39"]);
    const fixtures = await adapter.fetchUpcoming(["2026-11-22", "2026-11-23"]);
    expect(fetchImpl.calls).toHaveLength(2);
    expect(fetchImpl.calls[0]).toContain("date=2026-11-22");
    expect(fixtures.map((f) => f.competition.externalId)).toEqual(["39", "39"]);
  });

  it("maps a squad", async () => {
    const adapter = new FootballAdapter(client(fakeFetch({ "/players/squads": () => envelope(squadResponse) })));
    const squad = await adapter.fetchSquad("50");
    expect(squad).toEqual([
      { externalId: "1001", name: "A. Keeper", position: "Goalkeeper", nationality: null, photoUrl: null },
      { externalId: "1002", name: "B. Striker", position: "Attacker", nationality: null, photoUrl: null },
    ]);
  });

  it("maps season stats, drops empty rows, and skips plan-restricted seasons", async () => {
    const fetchImpl = fakeFetch({
      "/players": (u) =>
        u.searchParams.get("season") === "2026"
          ? envelope(playerStatsResponse)
          : envelope([], { errors: { plan: "Free plans do not have access to this season, try from 2022 to 2024." } }),
    });
    const adapter = new FootballAdapter(client(fetchImpl));
    const { profile, stats } = await adapter.fetchPlayerSeasonStats("1002", adapter.statsSeasons("2026"));

    expect(fetchImpl.calls).toHaveLength(2); // 2026 + 2025
    expect(profile).toMatchObject({ externalId: "1002", nationality: "England", birthDate: "2000-02-02", position: "Attacker" });
    expect(stats).toHaveLength(1); // FA Cup row had 0 appearances
    expect(stats[0]!.competitionName).toBe("Premier League");
    const parsed = FootballStatsSchema.parse(stats[0]!.stats);
    expect(parsed).toMatchObject({ goals: 9, assists: 2, rating: 7.25, passAccuracy: 78, shotsOnTarget: 21 });
  });

  it("derives seasons when the match season is unknown", () => {
    const adapter = new FootballAdapter(client(fakeFetch({})));
    expect(adapter.statsSeasons(null, new Date("2026-03-01T00:00:00Z"))).toEqual(["2025", "2024"]);
    expect(adapter.statsSeasons(null, new Date("2026-09-01T00:00:00Z"))).toEqual(["2026", "2025"]);
  });
});

describe("ApiSportsClient", () => {
  it("follows pagination when asked", async () => {
    const fetchImpl = fakeFetch({
      "/fixtures": (u) => {
        const page = Number(u.searchParams.get("page") ?? 1);
        return envelope([{ ...fixtureNS, fixture: { ...fixtureNS.fixture, id: page } }], { paging: { current: page, total: 3 } });
      },
    });
    const rows = await client(fetchImpl).get("/fixtures", { date: "2026-11-22" }, true);
    expect(rows).toHaveLength(3);
  });

  it("surfaces API errors as ApiSportsError (plan errors are not retryable)", async () => {
    const fetchImpl = fakeFetch({ "/players": () => envelope([], { errors: { plan: "Free plans do not have access" } }) });
    const err = await client(fetchImpl).get("/players", { id: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiSportsError);
    expect(err.retryable).toBe(false);
  });

  it("does not call the API when the quota guard refuses", async () => {
    const fetchImpl = fakeFetch({ "/fixtures": () => envelope([]) });
    const quota: QuotaGuard = {
      reserve: vi.fn(async () => {
        throw new QuotaExceededError("football", 90, 90);
      }),
    };
    await expect(client(fetchImpl, quota).get("/fixtures", {})).rejects.toBeInstanceOf(QuotaExceededError);
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("nextQuotaReset is the next 00:05 UTC", () => {
    expect(nextQuotaReset(new Date("2026-11-20T23:59:00Z")).toISOString()).toBe("2026-11-21T00:05:00.000Z");
  });
});
