import { describe, expect, it } from "vitest";
import {
  ApiSportsClient,
  ApiSportsError,
  BasketballAdapter,
  FootballAdapter,
  type FetchLike,
  type QuotaGuard,
  type RawBasketballGame,
} from "../src/index.ts";
import { envelope, fixtureNS } from "./fixtures.ts";

const noQuota: QuotaGuard = { reserve: async () => {} };

// Verbatim error body returned by API-Sports on 2026-11-24 for a date outside the free plan.
const planError = { plan: "Free plans do not have access to this date, try from 2026-11-23 to 2026-11-25." };
const ALLOWED = new Set(["2026-11-23", "2026-11-24", "2026-11-25"]);

function freePlanFetch(body: (date: string) => unknown[]): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    const date = new URL(url).searchParams.get("date")!;
    const payload = ALLOWED.has(date) ? envelope(body(date)) : { ...envelope([]), errors: planError, results: 0 };
    return { ok: true, status: 200, json: async () => payload };
  };
  return Object.assign(fn, { calls });
}

const game: RawBasketballGame = {
  id: 1,
  date: "2026-11-25T01:00:00+00:00",
  status: { short: "NS" },
  league: { id: 12, name: "NBA", season: "2026-2027", logo: null },
  country: { name: "USA" },
  teams: { home: { id: 1, name: "A", logo: null }, away: { id: 2, name: "B", logo: null } },
};

describe("free-plan date window", () => {
  it("football: skips dates the plan refuses and keeps the allowed ones", async () => {
    const fetchImpl = freePlanFetch((date) => [{ ...fixtureNS, fixture: { ...fixtureNS.fixture, id: Number(date.slice(-2)) } }]);
    const client = new ApiSportsClient("football", { apiKey: "k", fetchImpl, quota: noQuota, minIntervalMs: 0 });
    const out = await new FootballAdapter(client).fetchUpcoming(["2026-11-22", "2026-11-24", "2026-11-25", "2026-11-26"]);
    expect(out.map((f) => f.externalId)).toEqual(["24", "25"]);
    expect(fetchImpl.calls).toHaveLength(4);
  });

  it("basketball: same behaviour", async () => {
    const client = new ApiSportsClient("basketball", { apiKey: "k", fetchImpl: freePlanFetch(() => [game]), quota: noQuota, minIntervalMs: 0 });
    const out = await new BasketballAdapter(client).fetchUpcoming(["2026-11-22", "2026-11-23"]);
    expect(out).toHaveLength(1);
  });

  it("other errors still fail the call", async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const client = new ApiSportsClient("football", { apiKey: "k", fetchImpl, quota: noQuota, minIntervalMs: 0 });
    await expect(new FootballAdapter(client).fetchUpcoming(["2026-11-24"])).rejects.toBeInstanceOf(ApiSportsError);
  });
});
