import { and, db, eq, getSportId, lte, matches, sql } from "@tusky/db";
import { enabledAdapters } from "@tusky/providers";
import { childLogger, enqueue, QUEUES } from "@tusky/shared";

const log = childLogger("promote-live");

/**
 * Lifecycle: scheduled -> live (at kick-off) -> completed (after typical duration).
 * When the live-poll worker is implemented it will set `completed` from the real feed;
 * the duration-based rule is the fallback for matches without a live feed.
 */
export async function promoteLiveMatches(): Promise<void> {
  for (const adapter of enabledAdapters()) {
    const sportId = await getSportId(adapter.sport);

    const nowLive = await db
      .update(matches)
      .set({ status: "live" })
      .where(and(eq(matches.sportId, sportId), eq(matches.status, "scheduled"), lte(matches.startTime, new Date())))
      .returning({ id: matches.id });

    for (const m of nowLive) {
      await enqueue(QUEUES.matchLivePoll, { matchId: m.id }, `live:${m.id}`);
    }

    const finished = await db
      .update(matches)
      .set({ status: "completed" })
      .where(
        and(
          eq(matches.sportId, sportId),
          eq(matches.status, "live"),
          sql`${matches.startTime} + make_interval(mins => ${adapter.matchDurationMinutes}) < now()`,
        ),
      )
      .returning({ id: matches.id });

    if (nowLive.length || finished.length) {
      log.info({ sport: adapter.sport, live: nowLive.length, completed: finished.length }, "match statuses updated");
    }
  }
}
