import cron from "node-cron";
import { closeDb } from "@tusky/db";
import { childLogger, env, getBoss, stopBoss } from "@tusky/shared";
import { fetchUpcomingMatches } from "./jobs/fetchUpcomingMatches.ts";
import { promoteLiveMatches } from "./jobs/promoteLiveMatches.ts";
import { syncRecentResults } from "./jobs/syncRecentResults.ts";

const log = childLogger("scheduler");
const once = process.argv.includes("--once");

async function safely(name: string, fn: () => Promise<void>) {
  const started = Date.now();
  try {
    await fn();
    log.debug({ job: name, ms: Date.now() - started }, "job finished");
  } catch (err) {
    log.error({ job: name, err }, "job failed");
  }
}

async function shutdown(code = 0) {
  log.info("shutting down");
  await cron.shutdown?.();
  await stopBoss();
  await closeDb();
  process.exit(code);
}

await getBoss(); // creates queues if needed

if (once) {
  log.info("running jobs once (--once)");
  await safely("fetchUpcomingMatches", fetchUpcomingMatches);
  await safely("promoteLiveMatches", promoteLiveMatches);
  if (process.argv.includes("--results")) await safely("syncRecentResults", syncRecentResults);
  await shutdown(0);
} else {
  cron.schedule(env.FETCH_FIXTURES_CRON, () => safely("fetchUpcomingMatches", fetchUpcomingMatches), {
    name: "fetchUpcomingMatches",
    timezone: "UTC",
    noOverlap: true,
  });
  cron.schedule(env.PROMOTE_LIVE_CRON, () => safely("promoteLiveMatches", promoteLiveMatches), {
    name: "promoteLiveMatches",
    timezone: "UTC",
    noOverlap: true,
  });
  cron.schedule(env.SYNC_RESULTS_CRON, () => safely("syncRecentResults", syncRecentResults), {
    name: "syncRecentResults",
    timezone: "UTC",
    noOverlap: true,
  });
  log.info(
    {
      fetchFixtures: env.FETCH_FIXTURES_CRON,
      promoteLive: env.PROMOTE_LIVE_CRON,
      syncResults: env.SYNC_RESULTS_CRON,
      sports: env.ENABLED_SPORTS,
    },
    "scheduler started",
  );

  // Kick off a sync immediately on boot instead of waiting up to 6h.
  void safely("fetchUpcomingMatches", fetchUpcomingMatches);

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
}
