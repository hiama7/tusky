import type { GraphDeps, GraphState, GraphUpdate } from "../state.ts";

export function persist(deps: GraphDeps) {
  return async (state: GraphState): Promise<GraphUpdate> => {
    if (state.draft && state.outcome) {
      await deps.persist({ player: state.player, draft: state.draft, outcome: state.outcome, usage: state.usage });
    }
    return {};
  };
}
