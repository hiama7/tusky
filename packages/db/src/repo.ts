import { and, eq, sql } from "drizzle-orm";
import type { PlayerHistory } from "@tusky/shared";
import { db, type Db, type Tx } from "./client.ts";
import {
  competitions,
  matches,
  matchPlayers,
  players,
  playerInsights,
  playerStats,
  scrapeRuns,
  sports,
  teamAliases,
  teams,
} from "./schema/index.ts";

type Conn = Db | Tx;

const sportIdCache = new Map<string, number>();

export async function getSportId(code: string, conn: Conn = db): Promise<number> {
  const cached = sportIdCache.get(code);
  if (cached) return cached;
  const [row] = await conn.select({ id: sports.id }).from(sports).where(eq(sports.code, code));
  if (!row) throw new Error(`Unknown sport '${code}'. Did you run 'npm run db:migrate' (it seeds sports)?`);
  sportIdCache.set(code, row.id);
  return row.id;
}

export interface CompetitionInput {
  sportId: number;
  provider: string;
  externalId: string;
  name: string;
  country?: string | null;
  season?: string | null;
  logoUrl?: string | null;
}

export async function upsertCompetition(input: CompetitionInput, conn: Conn = db): Promise<number> {
  const [row] = await conn
    .insert(competitions)
    .values(input)
    .onConflictDoUpdate({
      target: [competitions.sportId, competitions.provider, competitions.externalId],
      set: { name: input.name, country: input.country, season: input.season, logoUrl: input.logoUrl },
    })
    .returning({ id: competitions.id });
  return row!.id;
}

export interface TeamInput {
  sportId: number;
  provider: string;
  externalId: string;
  name: string;
  country?: string | null;
  logoUrl?: string | null;
}

export async function upsertTeam(input: TeamInput, conn: Conn = db): Promise<number> {
  const [row] = await conn
    .insert(teams)
    .values(input)
    .onConflictDoUpdate({
      target: [teams.sportId, teams.provider, teams.externalId],
      set: { name: input.name, country: input.country, logoUrl: input.logoUrl },
    })
    .returning({ id: teams.id });
  return row!.id;
}

/** Team id registered for an alias key (e.g. an old franchise name), if any. */
export async function resolveTeamAlias(sportId: number, alias: string, conn: Conn = db): Promise<number | null> {
  const [row] = await conn
    .select({ teamId: teamAliases.teamId })
    .from(teamAliases)
    .where(and(eq(teamAliases.sportId, sportId), eq(teamAliases.alias, alias)));
  return row?.teamId ?? null;
}

export interface PlayerInput {
  sportId: number;
  provider: string;
  externalId: string;
  name: string;
  nationality?: string | null;
  birthDate?: string | null;
  position?: string | null;
  photoUrl?: string | null;
  currentTeamId?: number | null;
}

export async function upsertPlayer(input: PlayerInput, conn: Conn = db): Promise<number> {
  // Only overwrite optional fields when the new value is known, so a sparse squad
  // listing never erases richer data from an earlier stats call.
  const [row] = await conn
    .insert(players)
    .values(input)
    .onConflictDoUpdate({
      target: [players.sportId, players.provider, players.externalId],
      set: {
        name: input.name,
        nationality: sql`coalesce(excluded.nationality, ${players.nationality})`,
        birthDate: sql`coalesce(excluded.birth_date, ${players.birthDate})`,
        position: sql`coalesce(excluded.position, ${players.position})`,
        photoUrl: sql`coalesce(excluded.photo_url, ${players.photoUrl})`,
        currentTeamId: sql`coalesce(excluded.current_team_id, ${players.currentTeamId})`,
      },
    })
    .returning({ id: players.id });
  return row!.id;
}

export interface MatchInput {
  sportId: number;
  competitionId: number | null;
  provider: string;
  externalId: string;
  homeTeamId: number;
  awayTeamId: number;
  startTime: Date;
  venue?: string | null;
  city?: string | null;
  status: (typeof matches.$inferInsert)["status"];
  providerStatus?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  format?: string | null;
  tossWinnerTeamId?: number | null;
  tossDecision?: string | null;
  winnerTeamId?: number | null;
  raw?: unknown;
}

/** Returns the match id and whether the row was newly inserted. */
export async function upsertMatch(input: MatchInput, conn: Conn = db): Promise<{ id: number; inserted: boolean }> {
  const [row] = await conn
    .insert(matches)
    .values(input)
    .onConflictDoUpdate({
      target: [matches.sportId, matches.provider, matches.externalId],
      set: {
        competitionId: input.competitionId,
        homeTeamId: input.homeTeamId,
        awayTeamId: input.awayTeamId,
        startTime: input.startTime,
        venue: input.venue,
        city: input.city,
        providerStatus: input.providerStatus,
        // A feed without scores (e.g. an upcoming-fixtures call) never erases a known result.
        homeScore: sql`coalesce(excluded.home_score, ${matches.homeScore})`,
        awayScore: sql`coalesce(excluded.away_score, ${matches.awayScore})`,
        format: sql`coalesce(excluded.format, ${matches.format})`,
        tossWinnerTeamId: sql`coalesce(excluded.toss_winner_team_id, ${matches.tossWinnerTeamId})`,
        tossDecision: sql`coalesce(excluded.toss_decision, ${matches.tossDecision})`,
        winnerTeamId: sql`coalesce(excluded.winner_team_id, ${matches.winnerTeamId})`,
        raw: input.raw,
        // Never move a match backwards (e.g. live -> scheduled) because of a stale feed,
        // but do accept provider-side postponements / cancellations.
        status: sql`case
          when ${matches.status} in ('live','completed') and excluded.status = 'scheduled' then ${matches.status}
          else excluded.status end`,
      },
    })
    // xmax = 0 only for freshly inserted rows.
    .returning({ id: matches.id, inserted: sql<boolean>`(xmax = 0)` });
  return { id: row!.id, inserted: row!.inserted };
}

export async function upsertMatchPlayer(
  input: { matchId: number; playerId: number; teamId: number; role?: "squad" | "starting" | "bench" },
  conn: Conn = db,
): Promise<void> {
  await conn
    .insert(matchPlayers)
    .values({ role: "squad", ...input })
    .onConflictDoUpdate({
      target: [matchPlayers.matchId, matchPlayers.playerId],
      set: { teamId: input.teamId, ...(input.role ? { role: input.role } : {}) },
    });
}

export async function upsertPlayerStats(
  input: {
    playerId: number;
    season: string;
    competitionId?: number | null;
    competitionName?: string;
    source: "api" | "llm" | "manual";
    stats: Record<string, unknown>;
  },
  conn: Conn = db,
): Promise<void> {
  const values = { ...input, competitionName: input.competitionName ?? "", fetchedAt: new Date() };
  await conn
    .insert(playerStats)
    .values(values)
    .onConflictDoUpdate({
      target: [playerStats.playerId, playerStats.season, playerStats.competitionName, playerStats.source],
      set: { stats: values.stats, competitionId: values.competitionId, fetchedAt: values.fetchedAt },
    });
}

export async function insertPlayerInsight(
  input: { playerId: number; history: PlayerHistory; source: "llm" | "manual"; model?: string | null },
  conn: Conn = db,
): Promise<number> {
  const h = input.history;
  const [row] = await conn
    .insert(playerInsights)
    .values({
      playerId: input.playerId,
      summary: h.summary,
      recentForm: h.recentForm,
      winConditions: h.winConditions,
      lossConditions: h.lossConditions,
      strengths: h.strengths,
      weaknesses: h.weaknesses,
      injuries: h.injuries,
      keyStats: h.keyStats,
      sources: h.sources,
      confidence: h.confidence,
      source: input.source,
      model: input.model ?? null,
    })
    .returning({ id: playerInsights.id });
  return row!.id;
}

export async function setPlayerHistoryStatus(
  playerId: number,
  status: (typeof players.$inferInsert)["historyStatus"] & string,
  conn: Conn = db,
): Promise<void> {
  await conn
    .update(players)
    .set({
      historyStatus: status,
      ...(status === "ready" || status === "needs_review" ? { historyUpdatedAt: new Date() } : {}),
    })
    .where(eq(players.id, playerId));
}

export async function hasManualInsight(playerId: number, conn: Conn = db): Promise<boolean> {
  const [row] = await conn
    .select({ id: playerInsights.id })
    .from(playerInsights)
    .where(and(eq(playerInsights.playerId, playerId), eq(playerInsights.source, "manual")))
    .limit(1);
  return Boolean(row);
}

// ---- scrape_runs ---------------------------------------------------------

export async function startRun(input: {
  jobName: string;
  jobId?: string | null;
  entityType: string;
  entityId: number;
}): Promise<number> {
  const [row] = await db.insert(scrapeRuns).values(input).returning({ id: scrapeRuns.id });
  return row!.id;
}

export async function finishRun(
  runId: number,
  result: {
    status: "succeeded" | "failed" | "needs_review";
    error?: string | null;
    llmProvider?: string | null;
    llmModel?: string | null;
    tokensIn?: number;
    tokensOut?: number;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .update(scrapeRuns)
    .set({ ...result, finishedAt: new Date() })
    .where(eq(scrapeRuns.id, runId));
}
