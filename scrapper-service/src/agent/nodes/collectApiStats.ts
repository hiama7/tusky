import { QuotaExceededError } from "@tusky/providers";
import { childLogger } from "@tusky/shared";
import type { GraphDeps, GraphState, GraphUpdate } from "../state.ts";

const log = childLogger("node:collectApiStats");

/** Reliable, token-free data first. Quota errors bubble up (the worker defers the job). */
export function collectApiStats(deps: GraphDeps) {
  return async (state: GraphState): Promise<GraphUpdate> => {
    try {
      const apiStats = await deps.fetchApiStats(state.player);
      log.debug({ player: state.player.name, rows: apiStats.length }, "api stats collected");
      return { apiStats };
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
      log.warn({ player: state.player.name, err: (err as Error).message }, "api stats failed; continuing with research only");
      return { apiStats: [] };
    }
  };
}
