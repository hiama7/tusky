import { db, resolveTeamAlias, upsertCompetition, upsertMatch, upsertTeam } from "@tusky/db";
import type { NormalizedFixture } from "@tusky/providers";

/** Upsert a fixture with its competition and teams in one transaction. Idempotent. */
export async function storeFixture(sportId: number, provider: string, f: NormalizedFixture) {
  return db.transaction(async (tx) => {
    const competitionId = await upsertCompetition({ sportId, provider, ...f.competition }, tx);
    // Cricket teams use a provider-independent key (see cricketTeamKey) so every source
    // lands on the same row; aliases map old franchise names to the current team.
    const team = async ({ provider: teamProvider, ...t }: typeof f.home) =>
      (await resolveTeamAlias(sportId, t.externalId, tx)) ??
      upsertTeam({ sportId, provider: teamProvider ?? provider, ...t }, tx);
    const homeTeamId = await team(f.home);
    const awayTeamId = await team(f.away);
    const idOf = (ext: string | null | undefined) =>
      ext === f.home.externalId ? homeTeamId : ext === f.away.externalId ? awayTeamId : null;
    return upsertMatch(
      {
        sportId,
        competitionId,
        provider,
        externalId: f.externalId,
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
