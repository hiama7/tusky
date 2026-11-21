import { END, START, StateGraph } from "@langchain/langgraph";
import { collectApiStats } from "./nodes/collectApiStats.ts";
import { extract } from "./nodes/extract.ts";
import { persist } from "./nodes/persist.ts";
import { routeAfterValidate, validate } from "./nodes/validate.ts";
import { webResearch } from "./nodes/webResearch.ts";
import { initialState, PlayerHistoryState, type GraphDeps, type GraphState, type PlayerContext } from "./state.ts";

/**
 *  START -> collectApiStats -> webResearch -> extract -> validate --(errors, attempts left)--> extract
 *                                                             \--(ok / out of attempts)--> persist -> END
 */
export function buildPlayerHistoryGraph(deps: GraphDeps) {
  return new StateGraph(PlayerHistoryState)
    .addNode("collectApiStats", collectApiStats(deps))
    .addNode("webResearch", webResearch(deps))
    .addNode("extract", extract(deps))
    .addNode("validate", validate())
    .addNode("persist", persist(deps))
    .addEdge(START, "collectApiStats")
    .addEdge("collectApiStats", "webResearch")
    .addEdge("webResearch", "extract")
    .addEdge("extract", "validate")
    .addConditionalEdges("validate", routeAfterValidate, { extract: "extract", persist: "persist" })
    .addEdge("persist", END)
    .compile();
}

export async function runPlayerHistoryGraph(deps: GraphDeps, player: PlayerContext): Promise<GraphState> {
  const graph = buildPlayerHistoryGraph(deps);
  return (await graph.invoke(initialState(player), { recursionLimit: 20 })) as GraphState;
}
