import { nextQuotaReset } from "@tusky/providers";
import { childLogger, getBoss, type JobPayloads, type QueueName } from "@tusky/shared";

const log = childLogger("defer");

/**
 * Re-queue a job to run after the API quota resets (00:05 UTC), instead of burning
 * pg-boss retries while the quota is exhausted. The current job then completes normally.
 */
export async function deferUntilQuotaReset<Q extends QueueName>(
  queue: Q,
  data: JobPayloads[Q],
  singletonKey: string,
): Promise<void> {
  const boss = await getBoss();
  const startAfter = nextQuotaReset();
  const id = await boss.send(queue, data as object, { singletonKey, startAfter });
  log.info({ queue, singletonKey, startAfter: startAfter.toISOString(), queued: Boolean(id) }, "deferred until quota reset");
}
