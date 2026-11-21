import { Annotation } from "@langchain/langgraph";
import type { NormalizedSeasonStats } from "@tusky/providers";
import type { PlayerHistory, SportCode } from "@tusky/shared";
import type { StructuredInvoker } from "./llm.ts";
import type { ResearchDoc, SearchFn } from "./tools/search.ts";

export interface PlayerContext {
  id: number;
  sport: SportCode;
  provider: string;
  externalId: string;
  name: string;
  nationality: string | null;
  position: string | null;
  birthDate: string | null;
  teamName: string | null;
  /** Competition + season of the player's next match, if any. */
  competitionName: string | null;
  matchSeason: string | null;
}

export interface LlmUsage {
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
}

export type Outcome = "ready" | "needs_review";

export const MAX_EXTRACT_ATTEMPTS = 2;

export const PlayerHistoryState = Annotation.Root({
  player: Annotation<PlayerContext>(),
  apiStats: Annotation<NormalizedSeasonStats[]>(),
  documents: Annotation<ResearchDoc[]>(),
  draft: Annotation<PlayerHistory | null>(),
  validationErrors: Annotation<string[]>(),
  attempts: Annotation<number>(),
  usage: Annotation<LlmUsage>({
    // Accumulate token usage across extract retries; last provider wins.
    reducer: (a, b) => ({
      provider: b.provider ?? a.provider,
      model: b.model ?? a.model,
      tokensIn: a.tokensIn + b.tokensIn,
      tokensOut: a.tokensOut + b.tokensOut,
    }),
    default: () => ({ provider: null, model: null, tokensIn: 0, tokensOut: 0 }),
  }),
  outcome: Annotation<Outcome | null>(),
});

export type GraphState = typeof PlayerHistoryState.State;
export type GraphUpdate = typeof PlayerHistoryState.Update;

/** Side-effecting dependencies, injected so the graph can be unit-tested with fakes. */
export interface GraphDeps {
  /** Fetch (and persist) structured season stats from the sports API. */
  fetchApiStats(player: PlayerContext): Promise<NormalizedSeasonStats[]>;
  search: SearchFn;
  invoke: StructuredInvoker;
  persist(input: { player: PlayerContext; draft: PlayerHistory; outcome: Outcome; usage: LlmUsage }): Promise<void>;
}

export function initialState(player: PlayerContext): GraphUpdate {
  return { player, apiStats: [], documents: [], draft: null, validationErrors: [], attempts: 0, outcome: null };
}
