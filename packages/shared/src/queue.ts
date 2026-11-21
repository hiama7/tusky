import { PgBoss } from "pg-boss";
import { env } from "./env.ts";
import { logger } from "./logger.ts";

/** Queue names shared by the scheduler (producer) and the scraper (consumer). */
export const QUEUES = {
  matchEnrich: "match.enrich",
  playerHistory: "player.history",
  matchLivePoll: "match.live-poll",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface MatchEnrichJob {
  matchId: number;
}
export interface PlayerHistoryJob {
  playerId: number;
  /** Re-scrape even if the history is fresh / manual. */
  force?: boolean;
}
export interface MatchLivePollJob {
  matchId: number;
}

export interface JobPayloads {
  [QUEUES.matchEnrich]: MatchEnrichJob;
  [QUEUES.playerHistory]: PlayerHistoryJob;
  [QUEUES.matchLivePoll]: MatchLivePollJob;
}

/**
 * `stately` = at most one queued + one active job per singletonKey,
 * which is how we de-duplicate "enrich match X" / "scrape player Y".
 */
const QUEUE_CONFIG: Record<QueueName, Parameters<PgBoss["createQueue"]>[1]> = {
  [QUEUES.matchEnrich]: { policy: "stately", retryLimit: 3, retryDelay: 60, retryBackoff: true },
  [QUEUES.playerHistory]: {
    policy: "stately",
    retryLimit: 3,
    retryDelay: 120,
    retryBackoff: true,
    retryDelayMax: 6 * 60 * 60,
  },
  [QUEUES.matchLivePoll]: { policy: "stately", retryLimit: 1, retryDelay: 30 },
};

let bossPromise: Promise<PgBoss> | undefined;

/** Starts pg-boss once per process and makes sure all queues exist. */
export function getBoss(): Promise<PgBoss> {
  bossPromise ??= (async () => {
    const boss = new PgBoss(env.DATABASE_URL);
    boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
    await boss.start();
    for (const [name, options] of Object.entries(QUEUE_CONFIG)) {
      const existing = await boss.getQueue(name);
      if (!existing) await boss.createQueue(name, options);
    }
    return boss;
  })();
  return bossPromise;
}

export async function enqueue<Q extends QueueName>(
  queue: Q,
  data: JobPayloads[Q],
  singletonKey: string,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(queue, data as object, { singletonKey });
}

export async function stopBoss(): Promise<void> {
  if (!bossPromise) return;
  const boss = await bossPromise;
  await boss.stop({ graceful: true });
  bossPromise = undefined;
}
