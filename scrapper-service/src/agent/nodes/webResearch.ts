import { childLogger } from "@tusky/shared";
import type { PlayerContext, GraphDeps, GraphState, GraphUpdate } from "../state.ts";
import type { ResearchDoc } from "../tools/search.ts";

const log = childLogger("node:webResearch");

const MAX_DOC_CHARS = 1_500;
const MAX_TOTAL_CHARS = 12_000;

export function researchQueries(p: PlayerContext): string[] {
  const who = [p.name, p.teamName].filter(Boolean).join(" ");
  const sport = p.sport;
  return [
    `${who} ${sport} recent form statistics this season`,
    `${who} performance home vs away against top teams big matches strengths weaknesses`,
    `${who} injury news latest`,
  ];
}

/** Dedupe by URL, trim each doc, and cap the total so the prompt stays cheap. */
export function budgetDocuments(docs: ResearchDoc[]): ResearchDoc[] {
  const seen = new Set<string>();
  const out: ResearchDoc[] = [];
  let total = 0;
  for (const d of docs) {
    if (seen.has(d.url)) continue;
    seen.add(d.url);
    const content = d.content.length > MAX_DOC_CHARS ? `${d.content.slice(0, MAX_DOC_CHARS)}…` : d.content;
    if (total + content.length > MAX_TOTAL_CHARS) break;
    total += content.length;
    out.push({ ...d, content });
  }
  return out;
}

export function webResearch(deps: GraphDeps) {
  return async (state: GraphState): Promise<GraphUpdate> => {
    const results = await Promise.allSettled(researchQueries(state.player).map((q) => deps.search(q)));
    const docs: ResearchDoc[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") docs.push(...r.value);
      else log.warn({ err: String(r.reason).slice(0, 200) }, "search query failed");
    }
    const documents = budgetDocuments(docs);
    log.debug({ player: state.player.name, documents: documents.length }, "research done");
    return { documents };
  };
}
