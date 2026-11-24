import { describe, expect, it } from "vitest";
import { upcomingDates } from "../src/jobs/fetchUpcomingMatches.ts";

describe("upcomingDates", () => {
  it("returns today..today+N in UTC, across month boundaries", () => {
    expect(upcomingDates(2, new Date("2026-11-30T23:30:00Z"))).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
  });
});

describe("recentDates", () => {
  it("returns the N days before today, oldest first", async () => {
    const { recentDates } = await import("../src/jobs/syncRecentResults.ts");
    expect(recentDates(2, new Date("2026-12-01T00:10:00Z"))).toEqual(["2026-11-29", "2026-11-30"]);
  });
});
