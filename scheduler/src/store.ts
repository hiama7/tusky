import { db, findExistingMatch, resolveTeam, upsertCompetition, upsertMatch } from "@tusky/db";
import type { NormalizedFixture } from "@tusky/providers";

/** Upsert a fixture with its competition and teams in one transaction. Idempotent. */
export async function storeFixture(
  sportId: number,
  provider: string,
  f: NormalizedFixture,
  /** The adapter's `sameFixtureWindowHours`: how far a postponed game may move and still be the same fixture. */
  opts: { sameFixtureWindowHours?: number } = {},
) {
  return db.transaction(async (tx) => {
    const competitionId = await upsertCompetition({ sportId, provider, ...f.competition }, tx);
    // Cricket teams use a provider-independent key (see cricketTeamKey) so every source lands on the
    // same row. Other sports match a team new to this provider against an identically named
    // existing club (e.g. history loaded from openfootball), so ratings are never split.
    const team = async ({ provider: teamProvider, ...t }: typeof f.home) =>
      resolveTeam({ sportId, provider: teamProvider ?? provider, ...t }, tx, { matchByName: teamProvider === undefined });
    const homeTeamId = await team(f.home);
    const awayTeamId = await team(f.away);
    const idOf = (ext: string | null | undefined) =>
      ext === f.home.externalId ? homeTeamId : ext === f.away.externalId ? awayTeamId : null;
    // The same fixture may already be stored by another source (history or schedule imports):
    // update that row instead of inserting a duplicate.
    const existing = await findExistingMatch(
      { sportId, provider, externalId: f.externalId, homeTeamId, awayTeamId, startTime: f.startTime },
      tx,
      // A long window is only safe within one competition (shared across sources for league sports).
      { windowHours: opts.sameFixtureWindowHours, competitionId: opts.sameFixtureWindowHours ? competitionId : undefined },
    );
    return upsertMatch(
      {
        sportId,
        competitionId,
        provider: existing?.provider ?? provider,
        externalId: existing?.externalId ?? f.externalId,
        homeTeamId,
        awayTeamId,
        startTime: f.startTime,
        venue: f.venue,
        city: f.city,
        status: f.status,
        providerStatus: f.providerStatus,
        homeScore: f.score.home,
        awayScore: f.score.away,
        format: f.format ?? null,
        tossWinnerTeamId: idOf(f.toss?.winnerExternalId),
        tossDecision: f.toss?.decision ?? null,
        winnerTeamId: idOf(f.winnerExternalId),
        raw: f.raw,
      },
      tx,
    );
  });
}
