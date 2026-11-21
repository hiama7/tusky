import { childLogger, type MatchLivePollJob } from "@tusky/shared";
import type { Job } from "pg-boss";

const log = childLogger("live-poll");

/**
 * STUB — live in-match data (toss, goals, penalties, cards, wickets...).
 *
 * Planned implementation:
 *  1. GET /fixtures/events?fixture=<externalId> (football) every ~60s while the match is live.
 *  2. Insert each event into `match_events` with dedupeKey = `${provider}:${fixtureId}:${eventHash}`
 *     (ON CONFLICT DO NOTHING) so polling is idempotent.
 *  3. Update `matches.status` from the feed (FT/AET/PEN -> completed).
 *  4. While still live, re-enqueue itself with startAfter = now + 60s (same singletonKey `live:<id>`).
 *
 * Note: live polling costs ~90 requests per football match, so it needs a paid API-Sports plan
 * (or should be limited to a few featured matches).
 */
export async function livePollHandler(jobs: Job<MatchLivePollJob>[]): Promise<void> {
  for (const job of jobs) {
    log.info({ matchId: job.data.matchId }, "match is live (live polling not implemented yet)");
  }
}
