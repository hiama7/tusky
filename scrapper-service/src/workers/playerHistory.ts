import {
  competitions,
  db,
  desc,
  eq,
  finishRun,
  hasManualInsight,
  insertPlayerInsight,
  matches,
  matchPlayers,
  players,
  setPlayerHistoryStatus,
  sports,
  sql,
  startRun,
  teams,
  upsertCompetition,
  upsertPlayerStats,
} from "@tusky/db";
import { API_SPORTS_PROVIDER, getAdapter, QuotaExceededError, type NormalizedSeasonStats } from "@tusky/providers";
import { childLogger, env, QUEUES, type PlayerHistoryJob, type SportCode } from "@tusky/shared";
import type { Job } from "pg-boss";
import { runPlayerHistoryGraph } from "../agent/graph.ts";
import { createStructuredInvoker, type StructuredInvoker } from "../agent/llm.ts";
import type { GraphDeps, GraphState, PlayerContext } from "../agent/state.ts";
import { createTavilySearch, type SearchFn } from "../agent/tools/search.ts";
import { deferUntilQuotaReset } from "../defer.ts";

const log = childLogger("player-history");

export async function loadPlayerContext(playerId: number): Promise<PlayerContext | null> {
  const [row] = await db
    .select({
      id: players.id,
      sport: sports.code,
      provider: players.provider,
      externalId: players.externalId,
      name: players.name,
      nationality: players.nationality,
      position: players.position,
      birthDate: players.birthDate,
      teamName: teams.name,
    })
    .from(players)
    .innerJoin(sports, eq(sports.id, players.sportId))
    .leftJoin(teams, eq(teams.id, players.currentTeamId))
    .where(eq(players.id, playerId));
  if (!row) return null;

  // Competition/season of the player's next (or most recent) match gives the stats season.
  const [next] = await db
    .select({ competitionName: competitions.name, season: competitions.season })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .leftJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(eq(matchPlayers.playerId, playerId))
    .orderBy(sql`(${matches.startTime} >= now() - interval '1 day') desc`, desc(matches.startTime))
    .limit(1);

  return {
    ...row,
    sport: row.sport as SportCode,
    competitionName: next?.competitionName ?? null,
    matchSeason: next?.season ?? null,
  };
}

/** Fetch season stats from API-Sports and persist them (source=api) + enrich the player profile. */
async function fetchAndStoreApiStats(player: PlayerContext): Promise<NormalizedSeasonStats[]> {
  if (player.provider !== API_SPORTS_PROVIDER) return [];
  const adapter = getAdapter(player.sport);
  const { profile, stats } = await adapter.fetchPlayerSeasonStats(player.externalId, adapter.statsSeasons(player.matchSeason));

  if (profile) {
    await db
      .update(players)
      .set({
        nationality: profile.nationality ?? undefined,
        birthDate: profile.birthDate ?? undefined,
        position: profile.position ?? undefined,
        photoUrl: profile.photoUrl ?? undefined,
      })
      .where(eq(players.id, player.id));
    player.nationality ??= profile.nationality;
    player.birthDate ??= profile.birthDate;
    player.position ??= profile.position;
  }

  const [sport] = await db.select({ id: sports.id }).from(sports).where(eq(sports.code, player.sport));
  for (const s of stats) {
    const competitionId = s.competitionExternalId
      ? await upsertCompetition({
          sportId: sport!.id,
          provider: API_SPORTS_PROVIDER,
          externalId: s.competitionExternalId,
          name: s.competitionName,
          country: s.competitionCountry,
          season: s.season,
        })
      : null;
    await upsertPlayerStats({
      playerId: player.id,
      season: s.season,
      competitionId,
      competitionName: s.competitionName,
      source: "api",
      stats: s.stats,
    });
  }
  return stats;
}

let defaultInvoke: StructuredInvoker | undefined;
let defaultSearch: SearchFn | undefined;

/** Real dependencies; `overrides` lets tests/scripts swap the LLM or search without touching the DB parts. */
export function createDeps(overrides: Partial<Pick<GraphDeps, "invoke" | "search">> = {}): GraphDeps {
  return {
    invoke: overrides.invoke ?? (defaultInvoke ??= createStructuredInvoker()),
    search: overrides.search ?? (defaultSearch ??= createTavilySearch()),
    fetchApiStats: fetchAndStoreApiStats,
    async persist({ player, draft, outcome, usage }) {
      await db.transaction(async (tx) => {
        await insertPlayerInsight(
          { playerId: player.id, history: draft, source: "llm", model: usage.provider ? `${usage.provider}:${usage.model}` : null },
          tx,
        );
        await setPlayerHistoryStatus(player.id, outcome, tx);
      });
    },
  };
}

export function isHistoryFresh(updatedAt: Date | null, now = new Date()): boolean {
  return updatedAt !== null && now.getTime() - updatedAt.getTime() < env.HISTORY_STALE_DAYS * 86_400_000;
}

export type PlayerHistoryResult =
  | { status: "skipped"; reason: string }
  | { status: "deferred" }
  | { status: "done"; outcome: GraphState["outcome"]; state: GraphState };

/** Core unit of work, shared by the pg-boss worker and the `scrape:player` CLI. */
export async function runPlayerHistory(
  job: PlayerHistoryJob,
  opts: { jobId?: string; deps?: GraphDeps } = {},
): Promise<PlayerHistoryResult> {
  const [p] = await db
    .select({ status: players.historyStatus, updatedAt: players.historyUpdatedAt })
    .from(players)
    .where(eq(players.id, job.playerId));
  if (!p) return { status: "skipped", reason: "player not found" };

  if (!job.force) {
    if (p.status === "ready" && isHistoryFresh(p.updatedAt)) return { status: "skipped", reason: "history is fresh" };
    if (isHistoryFresh(p.updatedAt) && (await hasManualInsight(job.playerId))) {
      return { status: "skipped", reason: "manual history is fresh" };
    }
  }

  const player = await loadPlayerContext(job.playerId);
  if (!player) return { status: "skipped", reason: "player not found" };

  await setPlayerHistoryStatus(player.id, "scraping");
  const runId = await startRun({ jobName: QUEUES.playerHistory, jobId: opts.jobId, entityType: "player", entityId: player.id });

  try {
    const state = await runPlayerHistoryGraph(opts.deps ?? createDeps(), player);
    await finishRun(runId, {
      status: state.outcome === "ready" ? "succeeded" : "needs_review",
      error: state.validationErrors.length ? state.validationErrors.join("; ") : null,
      llmProvider: state.usage.provider,
      llmModel: state.usage.model,
      tokensIn: state.usage.tokensIn,
      tokensOut: state.usage.tokensOut,
      meta: { apiStatRows: state.apiStats.length, documents: state.documents.length, attempts: state.attempts },
    });
    log.info(
      { player: player.name, outcome: state.outcome, provider: state.usage.provider, tokens: state.usage.tokensIn + state.usage.tokensOut },
      "player history done",
    );
    return { status: "done", outcome: state.outcome, state };
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      await setPlayerHistoryStatus(player.id, "pending");
      await finishRun(runId, { status: "failed", error: err.message });
      await deferUntilQuotaReset(QUEUES.playerHistory, job, `player:${player.id}`);
      return { status: "deferred" };
    }
    await setPlayerHistoryStatus(player.id, "failed");
    await finishRun(runId, { status: "failed", error: (err as Error).message?.slice(0, 2000) ?? String(err) });
    throw err;
  }
}

export async function playerHistoryHandler(jobs: Job<PlayerHistoryJob>[]): Promise<void> {
  for (const job of jobs) {
    const res = await runPlayerHistory(job.data, { jobId: job.id });
    if (res.status === "skipped") log.debug({ playerId: job.data.playerId, reason: res.reason }, "skipped");
  }
}
