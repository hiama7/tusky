import { and, db, getSportId, gt, inArray, matches, matchPlayers, sql } from "@tusky/db";
import { enabledAdapters, QuotaExceededError, type SportAdapter } from "@tusky/providers";
import { childLogger, enqueue, env, QUEUES } from "@tusky/shared";

import { storeFixture } from "../store.ts";

const log = childLogger("fetch-upcoming");

/** UTC dates from today through today + daysAhead, as YYYY-MM-DD. */
export function upcomingDates(daysAhead: number, now = new Date()): string[] {
  return Array.from({ length: daysAhead + 1 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    return d.toISOString().slice(0, 10);
  });
}

async function runForAdapter(adapter: SportAdapter) {
  const dates = upcomingDates(env.FIXTURE_DAYS_AHEAD);
  const fixtures = await adapter.fetchUpcoming(dates);
  const sportId = await getSportId(adapter.sport);

  let inserted = 0;
  const matchIds: number[] = [];
  for (const f of fixtures) {
    const { id, inserted: isNew } = await storeFixture(sportId, adapter.provider, f);
    matchIds.push(id);
    if (isNew) inserted++;
  }

  // Enqueue enrichment for upcoming matches that don't have their players yet.
  let enqueued = 0;
  if (matchIds.length && adapter.enrichPlayers !== false) {
    const pending = await db
      .select({ id: matches.id })
      .from(matches)
      .where(
        and(
          inArray(matches.id, matchIds),
          inArray(matches.status, ["scheduled", "postponed"]),
          gt(matches.startTime, new Date()),
          sql`not exists (select 1 from ${matchPlayers} mp where mp.match_id = ${matches.id})`,
        ),
      )
      .orderBy(matches.startTime);

    for (const m of pending) {
      const jobId = await enqueue(QUEUES.matchEnrich, { matchId: m.id }, `match:${m.id}`);
      if (jobId) enqueued++;
    }
  }

  log.info(
    { sport: adapter.sport, dates, fixtures: fixtures.length, inserted, enrichEnqueued: enqueued },
    "upcoming matches synced",
  );
}

export async function fetchUpcomingMatches(): Promise<void> {
  for (const adapter of enabledAdapters()) {
    try {
      await runForAdapter(adapter);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        log.warn({ sport: adapter.sport, err: err.message }, "daily API quota reached; will retry on next tick");
        continue;
      }
      log.error({ sport: adapter.sport, err }, "fetching upcoming matches failed");
    }
  }
}
