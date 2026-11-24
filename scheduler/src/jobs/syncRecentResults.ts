import { getSportId } from "@tusky/db";
import { enabledAdapters, QuotaExceededError } from "@tusky/providers";
import { childLogger, env } from "@tusky/shared";
import { storeFixture } from "../store.ts";

const log = childLogger("sync-results");

/** The `daysBack` UTC dates before today, oldest first, as YYYY-MM-DD. */
export function recentDates(daysBack: number, now = new Date()): string[] {
  return Array.from({ length: daysBack }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (daysBack - i)));
    return d.toISOString().slice(0, 10);
  });
}

/**
 * Re-fetches the last few days of fixtures so matches that finished get their final
 * score and provider status. These completed results are the ML model's training labels.
 * Costs `RESULTS_DAYS_BACK` requests per sport per run.
 */
export async function syncRecentResults(): Promise<void> {
  const dates = recentDates(env.RESULTS_DAYS_BACK);
  for (const adapter of enabledAdapters()) {
    try {
      const fixtures = await adapter.fetchUpcoming(dates);
      const sportId = await getSportId(adapter.sport);
      let withScore = 0;
      for (const f of fixtures) {
        await storeFixture(sportId, adapter.provider, f, { sameFixtureWindowHours: adapter.sameFixtureWindowHours });
        if (f.score.home != null) withScore++;
      }
      log.info({ sport: adapter.sport, dates, fixtures: fixtures.length, withScore }, "recent results synced");
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        log.warn({ sport: adapter.sport, err: err.message }, "daily API quota reached; results sync skipped");
        continue;
      }
      log.error({ sport: adapter.sport, err }, "syncing recent results failed");
    }
  }
}
