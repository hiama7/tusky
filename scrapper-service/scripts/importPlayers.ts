/**
 * Manual player-history import (the "provide it manually" path).
 *
 *   npm run player:import -- ./data/sample-players.json
 *
 * File = JSON array validated by ManualImportFileSchema (@tusky/shared). Each entry identifies a player
 * either by provider+externalId (must already exist) or by name+sport (+team); unknown players are created
 * with provider "manual". Manual insights get confidence 1 by default and mark the player history `ready`,
 * so the scraper skips them until they become stale.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  and,
  closeDb,
  db,
  eq,
  getSportId,
  insertPlayerInsight,
  players,
  setPlayerHistoryStatus,
  sql,
  teams,
  upsertPlayer,
  upsertPlayerStats,
  type Tx,
} from "@tusky/db";
import { logger, ManualImportFileSchema, type ManualPlayerImport } from "@tusky/shared";

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "");

async function resolvePlayer(ref: ManualPlayerImport["player"], tx: Tx): Promise<number> {
  if ("externalId" in ref) {
    const [row] = await tx
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.provider, ref.provider), eq(players.externalId, ref.externalId)));
    if (!row) throw new Error(`player ${ref.provider}:${ref.externalId} not found`);
    return row.id;
  }

  const sportId = await getSportId(ref.sport, tx);
  let teamId: number | null = null;
  if (ref.team) {
    const [t] = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.sportId, sportId), sql`lower(${teams.name}) = lower(${ref.team})`))
      .limit(1);
    teamId = t?.id ?? null;
  }

  // Prefer an existing (e.g. API-sourced) player with the same name (and team, if given).
  const conds = [eq(players.sportId, sportId), sql`lower(${players.name}) = lower(${ref.name})`];
  if (teamId) conds.push(eq(players.currentTeamId, teamId));
  const [existing] = await tx.select({ id: players.id }).from(players).where(and(...conds)).limit(1);
  if (existing) return existing.id;

  return upsertPlayer(
    {
      sportId,
      provider: "manual",
      externalId: slug(`${ref.name}-${ref.team ?? ""}`),
      name: ref.name,
      nationality: ref.nationality ?? null,
      position: ref.position ?? null,
      currentTeamId: teamId,
    },
    tx,
  );
}

const file = process.argv[2];
if (!file) {
  logger.error("usage: npm run player:import -- <path/to/players.json>");
  process.exit(1);
}

const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
const parsed = ManualImportFileSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
if (!parsed.success) {
  logger.error({ issues: parsed.error.issues.slice(0, 10) }, `invalid import file ${path}`);
  await closeDb();
  process.exit(1);
}

let ok = 0;
let failed = 0;
for (const [i, entry] of parsed.data.entries()) {
  try {
    await db.transaction(async (tx) => {
      const playerId = await resolvePlayer(entry.player, tx);
      for (const s of entry.stats) {
        await upsertPlayerStats(
          { playerId, season: s.season, competitionName: s.competition ?? "", source: "manual", stats: s.stats },
          tx,
        );
      }
      await insertPlayerInsight({ playerId, history: entry.history, source: "manual", model: null }, tx);
      await setPlayerHistoryStatus(playerId, "ready", tx);
    });
    ok++;
  } catch (err) {
    failed++;
    logger.error({ index: i, err: (err as Error).message }, "import entry failed");
  }
}

logger.info({ file: path, imported: ok, failed }, "manual import finished");
await closeDb();
process.exit(failed ? 1 : 0);
