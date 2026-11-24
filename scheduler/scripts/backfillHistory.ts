/**
 * Backfill past seasons of fixtures + final scores, the training data for `ml-service`.
 *
 *   npm run history:backfill -- --sport football --seasons 2022,2023
 *   npm run history:backfill -- --sport football --seasons 2023 --leagues 39,140
 *   npm run history:backfill -- --sport basketball --seasons 2022-2023,2023-2024 --leagues 12
 *
 * Costs about 1 API-Sports request per (league, season). Leagues default to
 * FOOTBALL_LEAGUE_IDS / BASKETBALL_LEAGUE_IDS. Matches are stored as-is (completed with
 * scores); no player enrichment is queued for them.
 */
import { closeDb, getSportId } from "@tusky/db";
import { ApiSportsError, getAdapter, QuotaExceededError } from "@tusky/providers";
import { childLogger, env, type SportCode } from "@tusky/shared";
import { storeFixture } from "../src/store.ts";

const log = childLogger("backfill");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const list = (s: string | undefined) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const sport = (arg("sport") ?? "football") as SportCode;
if (sport !== "football" && sport !== "basketball") throw new Error(`--sport must be football|basketball, got '${sport}'`);
const seasons = list(arg("seasons"));
const leagues = list(arg("leagues")).length
  ? list(arg("leagues"))
  : sport === "football"
    ? env.FOOTBALL_LEAGUE_IDS
    : env.BASKETBALL_LEAGUE_IDS;

if (!seasons.length || !leagues.length) {
  console.error("usage: npm run history:backfill -- --sport <football|basketball> --seasons <s1,s2> [--leagues <id,id>]");
  process.exit(1);
}

const adapter = getAdapter(sport);
const sportId = await getSportId(sport);
let total = 0;
let scored = 0;
let exitCode = 0;

outer: for (const league of leagues) {
  for (const season of seasons) {
    try {
      const fixtures = await adapter.fetchSeasonResults(league, season);
      let withScore = 0;
      for (const f of fixtures) {
        await storeFixture(sportId, adapter.provider, f);
        if (f.score.home != null && f.score.away != null) withScore++;
      }
      total += fixtures.length;
      scored += withScore;
      log.info({ sport, league, season, fixtures: fixtures.length, withScore }, "season stored");
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        log.warn({ err: err.message }, "daily API quota reached; re-run tomorrow (already stored seasons are kept)");
        exitCode = 2;
        break outer;
      }
      if (err instanceof ApiSportsError && !err.retryable) {
        log.warn({ league, season, err: err.message }, "season not available on this plan; skipped");
        continue;
      }
      throw err;
    }
  }
}

log.info({ sport, leagues, seasons, fixtures: total, withScore: scored }, "backfill finished");
await closeDb();
process.exit(exitCode);
