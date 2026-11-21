import { closeDb } from "@tusky/db";
import { childLogger, env, getBoss, QUEUES, stopBoss } from "@tusky/shared";
import { enrichMatchHandler } from "./workers/enrichMatch.ts";
import { livePollHandler } from "./workers/livePoll.ts";
import { createDeps, playerHistoryHandler } from "./workers/playerHistory.ts";

const log = childLogger("scrapper-service");

// Fail fast on missing LLM config instead of on the first job.
createDeps();

const boss = await getBoss();

await boss.work(QUEUES.matchEnrich, { localConcurrency: env.MATCH_ENRICH_CONCURRENCY, batchSize: 1 }, enrichMatchHandler);
await boss.work(
  QUEUES.playerHistory,
  { localConcurrency: env.PLAYER_HISTORY_CONCURRENCY, batchSize: 1 },
  playerHistoryHandler,
);
await boss.work(QUEUES.matchLivePoll, { batchSize: 1 }, livePollHandler);

log.info(
  {
    queues: Object.values(QUEUES),
    concurrency: { matchEnrich: env.MATCH_ENRICH_CONCURRENCY, playerHistory: env.PLAYER_HISTORY_CONCURRENCY },
  },
  "scraper workers started",
);

async function shutdown() {
  log.info("shutting down (waiting for active jobs)");
  await stopBoss();
  await closeDb();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
