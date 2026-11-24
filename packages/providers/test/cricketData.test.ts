import { describe, expect, it } from "vitest";
import {
  CricketDataAdapter,
  CricketDataClient,
  CricketDataError,
  mapCricketDataMatch,
  type FetchLike,
  type QuotaGuard,
  type RawCricketDataMatch,
} from "../src/index.ts";

const noQuota: QuotaGuard = { reserve: async () => {} };

const upcoming: RawCricketDataMatch = {
  id: "a1b2c3",
  name: "India vs Australia, 2nd T20I, Australia tour of India, 2026",
  matchType: "t20",
  status: "Match not started",
  venue: "Wankhede Stadium, Mumbai",
  date: "2026-11-25",
  dateTimeGMT: "2026-11-25T13:30:00",
  teams: ["India", "Australia"],
  teamInfo: [{ name: "India", shortname: "IND", img: "https://x/ind.png" }],
  series_id: "s-99",
  matchStarted: false,
  matchEnded: false,
};

const finished: RawCricketDataMatch = {
  ...upcoming,
  id: "d4e5f6",
  dateTimeGMT: "2026-11-24T13:30:00",
  teams: ["Kings XI Punjab", "Delhi Capitals"],
  matchStarted: true,
  matchEnded: true,
  status: "Kings XI Punjab won by 5 runs",
  tossWinner: "Delhi Capitals",
  tossChoice: "bowl",
  matchWinner: "Kings XI Punjab",
  score: [
    { r: 180, w: 6, o: 20, inning: "Kings XI Punjab Inning 1" },
    { r: 175, w: 8, o: 20, inning: "Delhi Capitals Inning 1" },
  ],
};

describe("mapCricketDataMatch", () => {
  it("maps an upcoming fixture with canonical team keys", () => {
    const f = mapCricketDataMatch(upcoming)!;
    expect(f.externalId).toBe("a1b2c3");
    expect(f.startTime.toISOString()).toBe("2026-11-25T13:30:00.000Z");
    expect(f.status).toBe("scheduled");
    expect(f.format).toBe("T20");
    expect(f.home).toMatchObject({ externalId: "m:india", name: "India", logoUrl: "https://x/ind.png", provider: "cricket" });
    expect(f.away.externalId).toBe("m:australia");
    expect({ venue: f.venue, city: f.city }).toEqual({ venue: "Wankhede Stadium", city: "Mumbai" });
    expect(f.score).toEqual({ home: null, away: null });
    expect(f.toss).toBeNull();
  });

  it("maps a finished match: renamed franchise, toss, winner, runs", () => {
    const f = mapCricketDataMatch(finished)!;
    expect(f.status).toBe("completed");
    expect(f.home).toMatchObject({ externalId: "m:punjab kings", name: "Punjab Kings" });
    expect(f.toss).toEqual({ winnerExternalId: "m:delhi capitals", decision: "field" });
    expect(f.winnerExternalId).toBe("m:punjab kings");
    expect(f.score).toEqual({ home: 180, away: 175 });
  });

  it("women's fixtures get the female key; malformed rows are skipped", () => {
    expect(mapCricketDataMatch({ ...upcoming, teams: ["India Women", "England Women"] })!.home.externalId).toBe("f:india");
    expect(mapCricketDataMatch({ ...upcoming, teams: ["India"] })).toBeNull();
    expect(mapCricketDataMatch({ ...upcoming, dateTimeGMT: undefined })).toBeNull();
  });
});

function fakeFetch(pages: RawCricketDataMatch[][], total: number): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    const offset = Number(new URL(url).searchParams.get("offset") ?? 0);
    const data = pages[offset / 25] ?? [];
    return { ok: true, status: 200, json: async () => ({ status: "success", data, info: { totalRows: total } }) };
  };
  return Object.assign(fn, { calls });
}

describe("CricketDataAdapter.fetchUpcoming", () => {
  it("pages /matches and keeps only the requested dates and formats", async () => {
    const odi = { ...upcoming, id: "odi-1", matchType: "odi" };
    const page1 = Array.from({ length: 25 }, (_, i) => ({ ...upcoming, id: `p1-${i}`, dateTimeGMT: "2026-12-30T10:00:00" }));
    const page2 = [upcoming, odi, finished];
    const fetchImpl = fakeFetch([page1, page2], 28);
    const adapter = new CricketDataAdapter(new CricketDataClient({ apiKey: "k", fetchImpl, quota: noQuota, minIntervalMs: 0 }), ["T20"]);
    const out = await adapter.fetchUpcoming(["2026-11-25"]);
    expect(out.map((f) => f.externalId)).toEqual(["a1b2c3"]);
    expect(fetchImpl.calls).toHaveLength(2); // stops once totalRows is covered
    expect(new URL(fetchImpl.calls[0]!).searchParams.get("apikey")).toBe("k");
  });

  it("per-format durations", () => {
    const a = new CricketDataAdapter(new CricketDataClient({ apiKey: "k", quota: noQuota }));
    expect([a.durationMinutes("T20"), a.durationMinutes("ODI"), a.durationMinutes("Test")]).toEqual([240, 540, 7200]);
  });
});

describe("CricketDataClient errors", () => {
  it("turns the failure envelope (HTTP 200) into a non-retryable error", async () => {
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ status: "failure", reason: "Invalid API Key" }) });
    const client = new CricketDataClient({ apiKey: "bad", fetchImpl, quota: noQuota, minIntervalMs: 0 });
    const err = await client.get("matches").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CricketDataError);
    expect((err as CricketDataError).retryable).toBe(false);
  });

  it("reserves quota before calling", async () => {
    let reserved = 0;
    const quota: QuotaGuard = { reserve: async (sport) => void (reserved += sport === "cricket" ? 1 : 0) };
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ status: "success", data: [] }) });
    await new CricketDataClient({ apiKey: "k", fetchImpl, quota, minIntervalMs: 0 }).get("matches");
    expect(reserved).toBe(1);
  });
});
