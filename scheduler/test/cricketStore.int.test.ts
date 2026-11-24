/** storeFixture with cricket fixtures against tusky_test: canonical teams, aliases, toss/winner columns. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, eq, getSportId, matches, sql, teamAliases, teams } from "@tusky/db";
import { mapCricketDataMatch, type RawCricketDataMatch } from "@tusky/providers";
import { storeFixture } from "../src/store.ts";

const dbAvailable = process.env.TUSKY_DB_AVAILABLE === "1";

const raw: RawCricketDataMatch = {
  id: "fx-1",
  name: "Punjab Kings vs Delhi Capitals, 13th Match, IPL 2026",
  matchType: "t20",
  dateTimeGMT: "2026-04-01T14:00:00",
  venue: "Mullanpur Stadium, Mullanpur",
  teams: ["Punjab Kings", "Delhi Capitals"],
  matchStarted: true,
  matchEnded: true,
  tossWinner: "Delhi Capitals",
  tossChoice: "bat",
  matchWinner: "Punjab Kings",
  score: [
    { r: 150, inning: "Delhi Capitals Inning 1" },
    { r: 151, inning: "Punjab Kings Inning 1" },
  ],
};

async function clean(sportId: number) {
  await db.execute(sql`delete from matches where sport_id = ${sportId}`);
  await db.execute(sql`delete from team_aliases where sport_id = ${sportId}`);
  await db.execute(sql`delete from teams where sport_id = ${sportId}`);
  await db.execute(sql`delete from competitions where sport_id = ${sportId}`);
}

describe.skipIf(!dbAvailable)("cricket fixtures (integration)", () => {
  let sportId: number;
  beforeAll(async () => {
    sportId = await getSportId("cricket");
    await clean(sportId);
  });
  afterAll(async () => {
    await clean(sportId);
    await closeDb();
  });

  it("stores canonical teams, toss, winner and format; resolves aliases to an existing team", async () => {
    // A team imported earlier from Cricsheet under its old name, plus the alias row.
    const [old] = await db
      .insert(teams)
      .values({ sportId, provider: "cricket", externalId: "m:punjab kings", name: "Punjab Kings" })
      .returning({ id: teams.id });
    await db.insert(teamAliases).values({ sportId, alias: "m:kings xi punjab", teamId: old!.id });

    const f = mapCricketDataMatch({ ...raw, teams: ["Kings XI Punjab", "Delhi Capitals"], matchWinner: "Kings XI Punjab" })!;
    const { id } = await storeFixture(sportId, "cricketdata", f);
    const [m] = await db.select().from(matches).where(eq(matches.id, id));
    expect(m!.homeTeamId).toBe(old!.id);
    expect(m!.winnerTeamId).toBe(old!.id);
    expect(m!.format).toBe("T20");
    expect(m!.tossDecision).toBe("bat");
    expect(m!.tossWinnerTeamId).toBe(m!.awayTeamId);
    expect(m!.status).toBe("completed");

    // Re-storing the same fixture without toss info keeps what we already knew.
    await storeFixture(sportId, "cricketdata", { ...f, toss: null, winnerExternalId: null });
    const [again] = await db.select().from(matches).where(eq(matches.id, id));
    expect(again!.tossDecision).toBe("bat");
    expect(again!.winnerTeamId).toBe(old!.id);

    const all = await db.select({ provider: teams.provider }).from(teams).where(eq(teams.sportId, sportId));
    expect(new Set(all.map((t) => t.provider))).toEqual(new Set(["cricket"]));
  });
});
