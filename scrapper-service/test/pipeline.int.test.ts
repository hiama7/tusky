/**
 * End-to-end pipeline against a real Postgres (`tusky_test`), with API-Sports, the LLM and search faked:
 * scheduler fetchUpcomingMatches -> pg-boss match.enrich -> enrichMatch -> pg-boss player.history -> runPlayerHistory.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, db, eq, matches, matchPlayers, players, playerInsights, playerStats, providerQuota, scrapeRuns, sql } from "@tusky/db";
import { stopBoss } from "@tusky/shared";
import { envelope, fixtureNS, playerStatsResponse, squadResponse } from "../../packages/providers/test/fixtures.ts";
import { fetchUpcomingMatches } from "../../scheduler/src/jobs/fetchUpcomingMatches.ts";
import { enrichMatch } from "../src/workers/enrichMatch.ts";
import { createDeps, runPlayerHistory } from "../src/workers/playerHistory.ts";
import { draft, fakeSearch, scriptedInvoker } from "./helpers.ts";

const dbAvailable = process.env.TUSKY_DB_AVAILABLE === "1";

const kickoff = new Date(Date.now() + 24 * 3_600_000);
const upcoming = { ...fixtureNS, fixture: { ...fixtureNS.fixture, date: kickoff.toISOString() } };

async function jobs(queue: string) {
  const res = await db.execute(sql`select data, state from pgboss.job where name = ${queue} order by created_on`);
  return res.rows as { data: Record<string, number>; state: string }[];
}

describe.skipIf(!dbAvailable)("pipeline (integration)", () => {
  beforeAll(async () => {
    await db.execute(
      sql`truncate match_events, match_players, player_insights, player_stats, scrape_runs, provider_quota, matches, players, teams, competitions restart identity cascade`,
    );
    await db.execute(sql`do $$ begin if exists (select 1 from pg_namespace where nspname='pgboss') then delete from pgboss.job; end if; end $$`);

    vi.stubGlobal("fetch", async (url: string) => {
      const u = new URL(url);
      const body =
        u.pathname === "/fixtures"
          ? envelope(u.searchParams.get("date") === kickoff.toISOString().slice(0, 10) ? [upcoming] : [])
          : u.pathname === "/players/squads"
            ? envelope(u.searchParams.get("team") === "50" ? squadResponse : [{ team: { id: 42, name: "Away City" }, players: [] }])
            : u.pathname === "/players"
              ? envelope(u.searchParams.get("id") === "1002" && u.searchParams.get("season") === "2026" ? playerStatsResponse : [])
              : envelope([]);
      return new Response(JSON.stringify(body), { status: 200 });
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await stopBoss();
    await closeDb();
  });

  it("scheduler stores upcoming matches and enqueues enrichment once", async () => {
    await fetchUpcomingMatches();
    const rows = await db.select().from(matches);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "1208001", status: "scheduled", venue: "Example Park" });

    const enrich = await jobs("match.enrich");
    expect(enrich).toHaveLength(1);
    expect(enrich[0]!.data).toEqual({ matchId: rows[0]!.id });

    // Idempotent: second run neither duplicates the match nor the queued job.
    await fetchUpcomingMatches();
    expect(await db.select().from(matches)).toHaveLength(1);
    expect(await jobs("match.enrich")).toHaveLength(1);

    const [quota] = await db.select().from(providerQuota);
    expect(quota!.requestsUsed).toBe(4); // 2 dates x 2 runs
  });

  it("enrichMatch stores squads and enqueues player history", async () => {
    const [m] = await db.select().from(matches);
    const res = await enrichMatch({ matchId: m!.id });
    expect(res).toEqual({ players: 2, enqueued: 2 });
    expect(await db.select().from(matchPlayers)).toHaveLength(2);
    expect((await jobs("player.history")).map((j) => j.data.playerId).sort()).toHaveLength(2);
  });

  it("runPlayerHistory stores API stats + LLM insight and marks the player ready", async () => {
    const [striker] = await db.select().from(players).where(eq(players.externalId, "1002"));
    const { invoke } = scriptedInvoker([draft()], "groq");
    const res = await runPlayerHistory({ playerId: striker!.id }, { deps: createDeps({ invoke, search: fakeSearch() }) });
    expect(res.status).toBe("done");

    const [p] = await db.select().from(players).where(eq(players.id, striker!.id));
    expect(p).toMatchObject({ historyStatus: "ready", nationality: "England", birthDate: "2000-02-02" });

    const stats = await db.select().from(playerStats).where(eq(playerStats.playerId, striker!.id));
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ source: "api", season: "2026", competitionName: "Premier League" });
    expect(stats[0]!.stats).toMatchObject({ goals: 9 });

    const [insight] = await db.select().from(playerInsights).where(eq(playerInsights.playerId, striker!.id));
    expect(insight).toMatchObject({ source: "llm", model: "groq:fake-model" });

    const [run] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.entityId, striker!.id));
    expect(run).toMatchObject({ status: "succeeded", llmProvider: "groq", tokensIn: 100, tokensOut: 50 });

    // Fresh history is skipped on the next run (no extra LLM spend).
    const again = await runPlayerHistory({ playerId: striker!.id }, { deps: createDeps({ invoke, search: fakeSearch() }) });
    expect(again).toEqual({ status: "skipped", reason: "history is fresh" });
  });

  it("scheduler promotes matches to live at kick-off and enqueues live polling", async () => {
    const { promoteLiveMatches } = await import("../../scheduler/src/jobs/promoteLiveMatches.ts");
    await db.update(matches).set({ startTime: new Date(Date.now() - 60_000) });
    await promoteLiveMatches();
    const [m] = await db.select().from(matches);
    expect(m!.status).toBe("live");
    expect(await jobs("match.live-poll")).toHaveLength(1);

    await db.update(matches).set({ startTime: new Date(Date.now() - 4 * 3_600_000) });
    await promoteLiveMatches();
    expect((await db.select().from(matches))[0]!.status).toBe("completed");
  });
});
