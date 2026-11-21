import {
  and,
  competitions,
  db,
  eq,
  inArray,
  lt,
  matches,
  or,
  players,
  sports,
  teams,
  upsertMatchPlayer,
  upsertPlayer,
} from "@tusky/db";
import { getAdapter, QuotaExceededError } from "@tusky/providers";
import { childLogger, enqueue, env, QUEUES, type MatchEnrichJob, type SportCode } from "@tusky/shared";
import type { Job } from "pg-boss";
import { deferUntilQuotaReset } from "../defer.ts";

const log = childLogger("enrich-match");

async function loadMatch(matchId: number) {
  const [m] = await db
    .select({
      id: matches.id,
      sportId: matches.sportId,
      sport: sports.code,
      provider: matches.provider,
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
      season: competitions.season,
    })
    .from(matches)
    .innerJoin(sports, eq(sports.id, matches.sportId))
    .leftJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(eq(matches.id, matchId));
  if (!m) return null;
  const teamRows = await db
    .select({ id: teams.id, externalId: teams.externalId, name: teams.name })
    .from(teams)
    .where(inArray(teams.id, [m.homeTeamId, m.awayTeamId]));
  return { ...m, sport: m.sport as SportCode, teams: teamRows };
}

/** Players linked to this match whose history is missing, failed or stale. */
async function playersNeedingHistory(playerIds: number[]): Promise<number[]> {
  if (!playerIds.length) return [];
  const staleBefore = new Date(Date.now() - env.HISTORY_STALE_DAYS * 86_400_000);
  const rows = await db
    .select({ id: players.id })
    .from(players)
    .where(
      and(
        inArray(players.id, playerIds),
        or(
          inArray(players.historyStatus, ["pending", "failed"]),
          and(inArray(players.historyStatus, ["ready", "needs_review"]), lt(players.historyUpdatedAt, staleBefore)),
          // A worker that crashed mid-scrape leaves 'scraping' behind; treat >1h as abandoned.
          and(eq(players.historyStatus, "scraping"), lt(players.updatedAt, new Date(Date.now() - 3_600_000))),
        ),
      ),
    );
  return rows.map((r) => r.id);
}

export async function enrichMatch(job: MatchEnrichJob): Promise<{ players: number; enqueued: number } | "deferred" | null> {
  const match = await loadMatch(job.matchId);
  if (!match) {
    log.warn({ matchId: job.matchId }, "match not found");
    return null;
  }
  const adapter = getAdapter(match.sport);

  const playerIds: number[] = [];
  try {
    for (const team of match.teams) {
      let squad = await adapter.fetchSquad(team.externalId, match.season);
      if (env.MAX_PLAYERS_PER_TEAM > 0) squad = squad.slice(0, env.MAX_PLAYERS_PER_TEAM);

      await db.transaction(async (tx) => {
        for (const sp of squad) {
          const playerId = await upsertPlayer(
            {
              sportId: match.sportId,
              provider: match.provider,
              externalId: sp.externalId,
              name: sp.name,
              position: sp.position,
              nationality: sp.nationality,
              photoUrl: sp.photoUrl,
              currentTeamId: team.id,
            },
            tx,
          );
          await upsertMatchPlayer({ matchId: match.id, playerId, teamId: team.id }, tx);
          playerIds.push(playerId);
        }
      });
      log.debug({ matchId: match.id, team: team.name, players: squad.length }, "squad stored");
    }
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      await deferUntilQuotaReset(QUEUES.matchEnrich, job, `match:${job.matchId}`);
      return "deferred";
    }
    throw err;
  }

  let enqueued = 0;
  for (const playerId of await playersNeedingHistory(playerIds)) {
    if (await enqueue(QUEUES.playerHistory, { playerId }, `player:${playerId}`)) enqueued++;
  }
  log.info({ matchId: match.id, players: playerIds.length, historyEnqueued: enqueued }, "match enriched");
  return { players: playerIds.length, enqueued };
}

export async function enrichMatchHandler(jobs: Job<MatchEnrichJob>[]): Promise<void> {
  for (const job of jobs) await enrichMatch(job.data);
}
