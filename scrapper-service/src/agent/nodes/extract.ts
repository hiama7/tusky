import { PlayerHistorySchema } from "@tusky/shared";
import type { GraphDeps, GraphState, GraphUpdate } from "../state.ts";

const SYSTEM_PROMPT = `You are a sports data analyst building a factual player profile for a match-prediction system.

Rules:
- Use ONLY the API stats and web documents provided. Never invent numbers, matches, injuries or quotes.
- Every winCondition / lossCondition must be a concrete, repeatable situation (venue, opponent strength,
  game state, schedule, conditions, role) and should reference a sourceUrl from the documents when possible.
- sources: list only URLs that appear in the provided documents.
- keyStats: only stats NOT already in the API stats, each tied to the documents.
- Use null / empty arrays for anything the evidence does not support.
- confidence: ~0.8+ only with API stats AND multiple consistent documents; <=0.4 when evidence is thin.`;

export function buildExtractPrompt(state: GraphState): string {
  const p = state.player;
  const context = {
    name: p.name,
    sport: p.sport,
    team: p.teamName,
    position: p.position,
    nationality: p.nationality,
    birthDate: p.birthDate,
    nextCompetition: p.competitionName,
    season: p.matchSeason,
  };
  const stats = state.apiStats.map((s) => ({
    season: s.season,
    competition: s.competitionName,
    team: s.teamName,
    ...Object.fromEntries(Object.entries(s.stats).filter(([, v]) => v !== null)),
  }));
  const docs = state.documents
    .map((d, i) => `[${i + 1}] ${d.title ?? "(untitled)"}\nURL: ${d.url}\n${d.content}`)
    .join("\n\n");

  let prompt = `PLAYER:\n${JSON.stringify(context)}\n\nAPI STATS (authoritative):\n${
    stats.length ? JSON.stringify(stats) : "none available"
  }\n\nWEB DOCUMENTS:\n${docs || "none available"}`;

  if (state.validationErrors.length) {
    prompt += `\n\nYOUR PREVIOUS ANSWER WAS REJECTED. Fix these problems:\n- ${state.validationErrors.join("\n- ")}`;
  }
  return prompt;
}

export function extract(deps: GraphDeps) {
  return async (state: GraphState): Promise<GraphUpdate> => {
    const res = await deps.invoke(
      PlayerHistorySchema,
      [
        ["system", SYSTEM_PROMPT],
        ["human", buildExtractPrompt(state)],
      ],
      "player_history",
    );
    return {
      draft: res.data,
      attempts: state.attempts + 1,
      usage: { provider: res.provider, model: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut },
    };
  };
}
