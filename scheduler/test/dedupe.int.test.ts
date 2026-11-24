/**
 * storeFixture against tusky_test: an API-Sports fixture must attach to a match (and clubs) that
 * another source already stored, instead of duplicating them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, closeDb, db, eq, getSportId, inArray, matchAliases, matches, sql, teamAliases, teams, upsertCompetition } from "@tusky/db";
import { mapFootballFixture, type RawFootballFixture } from "@tusky/providers";
import { fixtureNS } from "../../packages/providers/test/fixtures.ts";
import { storeFixture } from "../src/store.ts";

const dbAvailable = process.env.TUSKY_DB_AVAILABLE === "1";

const OF = "openfootball";
const raw = (over: Partial<RawFootballFixture> = {}): RawFootballFixture => ({
  ...fixtureNS,
  fixture: { ...fixtureNS.fixture, id: 9990001, date: "2026-12-05T15:00:00+00:00", status: { short: "FT" } },
  teams: { home: { id: 9990746, name: "Sunderland", logo: null }, away: { id: 9990047, name: "Tottenham", logo: null } },
  goals: { home: 2, away: 1 },
  score: { fulltime: { home: 2, away: 1 } },
  ...over,
});

async function clean(sportId: number) {
  await db.execute(sql`delete from matches where sport_id = ${sportId} and (external_id in ('9990001', 'of-dedupe-1', 'of-dedupe-2', '9990002', '9990003', '9990004'))`);
  await db.execute(sql`delete from team_aliases where sport_id = ${sportId} and alias in ('9990746', '9990047', '9990100', '9990101')`);
  await db.execute(sql`delete from teams where sport_id = ${sportId} and external_id in ('9990746', '9990047', '9990100', '9990101', 'of:en.1:sunderland', 'of:en.1:tottenham', 'of:en.1:alphatown', 'of:en.1:betaville')`);
}

describe.skipIf(!dbAvailable)("same fixture from two sources (integration)", () => {
  let sportId: number;
  let sunderland: number;
  let spurs: number;
  let seeded: number;

  beforeAll(async () => {
    sportId = await getSportId("football");
    await clean(sportId);
    const competitionId = await upsertCompetition({ sportId, provider: "api-sports", externalId: "39", name: "Premier League", season: "2026" });
    // What the openfootball importer leaves behind: its clubs and an upcoming fixture.
    const [a] = await db.insert(teams).values({ sportId, provider: OF, externalId: "of:en.1:sunderland", name: "Sunderland AFC" }).returning({ id: teams.id });
    const [b] = await db.insert(teams).values({ sportId, provider: OF, externalId: "of:en.1:tottenham", name: "Tottenham Hotspur FC" }).returning({ id: teams.id });
    sunderland = a!.id;
    spurs = b!.id;
    const [m] = await db
      .insert(matches)
      .values({ sportId, competitionId, provider: OF, externalId: "of-dedupe-1", homeTeamId: sunderland, awayTeamId: spurs, startTime: new Date("2026-12-05T15:00:00Z"), status: "scheduled", providerStatus: "NS" })
      .returning({ id: matches.id });
    seeded = m!.id;
  });
  afterAll(async () => {
    await clean(sportId);
    await closeDb();
  });

  it("an identically named club resolves to the existing team and the fixture updates the existing row", async () => {
    const f = mapFootballFixture(raw());
    // "Tottenham" normalizes to "tottenham", not "tottenham hotspur": it is NOT silently merged ...
    const first = await storeFixture(sportId, "api-sports", f);
    const spursNew = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.sportId, sportId), eq(teams.externalId, "9990047")));
    expect(spursNew).toHaveLength(1);
    // ... while "Sunderland" == "Sunderland AFC" is, so the home side maps to the existing club.
    const alias = await db.select().from(teamAliases).where(and(eq(teamAliases.sportId, sportId), eq(teamAliases.alias, "9990746")));
    expect(alias[0]?.teamId).toBe(sunderland);
    expect(await db.select({ id: teams.id }).from(teams).where(and(eq(teams.sportId, sportId), eq(teams.externalId, "9990746")))).toHaveLength(0);

    // Different away team id means this is a different pairing: a new match is stored (not the seeded one).
    expect(first.id).not.toBe(seeded);
  });

  it("the same fixture (same two clubs) is attached to the existing match, not duplicated", async () => {
    // Make the away club resolvable too, as it would be after the clubs are reconciled.
    await db.insert(teamAliases).values({ sportId, alias: "9990047", teamId: spurs }).onConflictDoNothing();
    await db.execute(sql`delete from matches where sport_id = ${sportId} and external_id = '9990001'`);

    const f = mapFootballFixture(raw({ fixture: { ...fixtureNS.fixture, id: 9990002, date: "2026-12-05T15:00:00+00:00", status: { short: "FT" } } }));
    const stored = await storeFixture(sportId, "api-sports", f);
    expect(stored.id).toBe(seeded);
    expect(stored.inserted).toBe(false);

    const [row] = await db.select().from(matches).where(eq(matches.id, seeded));
    expect(row!.provider).toBe(OF); // keeps its original key
    expect(row!.status).toBe("completed");
    expect([row!.homeScore, row!.awayScore]).toEqual([2, 1]);
    expect(row!.providerStatus).toBe("FT");

    const aliases = await db.select().from(matchAliases).where(eq(matchAliases.matchId, seeded));
    expect(aliases.map((a) => `${a.provider}:${a.externalId}`)).toEqual(["api-sports:9990002"]);

    // Idempotent: the same sync again changes nothing and creates nothing.
    const again = await storeFixture(sportId, "api-sports", f);
    expect(again.id).toBe(seeded);
    const count = await db.select({ id: matches.id }).from(matches).where(and(eq(matches.sportId, sportId), inArray(matches.externalId, ["of-dedupe-1", "9990002"])));
    expect(count).toHaveLength(1);
  });

  describe("a postponed game", () => {
    let seeded2: number;
    const moved = (id: number) =>
      mapFootballFixture(
        raw({
          fixture: { ...fixtureNS.fixture, id, date: "2026-12-23T15:00:00+00:00", status: { short: "NS" } },
          teams: { home: { id: 9990100, name: "Alphatown", logo: null }, away: { id: 9990101, name: "Betaville", logo: null } },
          goals: { home: null, away: null },
          score: { fulltime: { home: null, away: null } },
        }),
      );

    beforeAll(async () => {
      const competitionId = await upsertCompetition({ sportId, provider: "api-sports", externalId: "39", name: "Premier League", season: "2026" });
      const [a] = await db.insert(teams).values({ sportId, provider: OF, externalId: "of:en.1:alphatown", name: "Alphatown FC" }).returning({ id: teams.id });
      const [b] = await db.insert(teams).values({ sportId, provider: OF, externalId: "of:en.1:betaville", name: "Betaville FC" }).returning({ id: teams.id });
      const [m] = await db
        .insert(matches)
        .values({ sportId, competitionId, provider: OF, externalId: "of-dedupe-2", homeTeamId: a!.id, awayTeamId: b!.id, startTime: new Date("2026-12-20T15:00:00Z"), status: "scheduled", providerStatus: "NS" })
        .returning({ id: matches.id });
      seeded2 = m!.id;
    });

    it("is a different fixture under the default 36-hour window (sports where pairings recur within weeks)", async () => {
      const stored = await storeFixture(sportId, "api-sports", moved(9990003));
      expect(stored.id).not.toBe(seeded2);
    });

    it("is still the same fixture under the league window (a pairing happens once per season)", async () => {
      const stored = await storeFixture(sportId, "api-sports", moved(9990004), { sameFixtureWindowHours: 24 * 60 });
      expect(stored.id).toBe(seeded2);
      const [row] = await db.select().from(matches).where(eq(matches.id, seeded2));
      expect(row!.startTime.toISOString()).toBe("2026-12-23T15:00:00.000Z"); // moved to the new date
      expect(row!.provider).toBe(OF);
    });
  });
});
