import { describe, expect, it } from "vitest";
import { upcomingDates } from "../src/jobs/fetchUpcomingMatches.ts";

describe("upcomingDates", () => {
  it("returns today..today+N in UTC, across month boundaries", () => {
    expect(upcomingDates(2, new Date("2026-11-30T23:30:00Z"))).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
  });
});
