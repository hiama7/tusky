/**
 * Run the player-history graph for one player, synchronously (no queue). For debugging prompts/providers.
 *
 *   npm run scrape:player -- --player-id 42
 *   npm run scrape:player -- --external-id 276 --sport football
 */
import { parseArgs } from "node:util";
import { and, closeDb, db, eq, players, sports } from "@tusky/db";
import { logger } from "@tusky/shared";
import { runPlayerHistory } from "../src/workers/playerHistory.ts";

const { values } = parseArgs({
  options: {
    "player-id": { type: "string" },
    "external-id": { type: "string" },
    sport: { type: "string", default: "football" },
    provider: { type: "string", default: "api-sports" },
  },
});

let playerId = values["player-id"] ? Number(values["player-id"]) : undefined;
if (!playerId && values["external-id"]) {
  const [row] = await db
    .select({ id: players.id })
    .from(players)
    .innerJoin(sports, eq(sports.id, players.sportId))
    .where(
      and(eq(players.externalId, values["external-id"]), eq(players.provider, values.provider!), eq(sports.code, values.sport!)),
    );
  playerId = row?.id;
}
if (!playerId) {
  logger.error("player not found: pass --player-id <id> or --external-id <id> [--sport football]");
  await closeDb();
  process.exit(1);
}

try {
  const res = await runPlayerHistory({ playerId, force: true });
  if (res.status === "done") {
    console.log(JSON.stringify({ outcome: res.outcome, usage: res.state.usage, errors: res.state.validationErrors, draft: res.state.draft }, null, 2));
  } else {
    console.log(res);
  }
} finally {
  const { stopBoss } = await import("@tusky/shared");
  await stopBoss();
  await closeDb();
}
