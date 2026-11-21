import { PlayerHistorySchema, type PlayerHistory } from "@tusky/shared";
import { MAX_EXTRACT_ATTEMPTS, type GraphState, type GraphUpdate } from "../state.ts";

const normalizeUrl = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();

/**
 * Deterministic guardrails on the LLM draft:
 *  - schema re-check
 *  - drop hallucinated source URLs (not in the research docs)
 *  - require citations when documents were available
 *  - cap confidence by the amount of evidence
 */
export function checkDraft(state: GraphState): { draft: PlayerHistory | null; errors: string[] } {
  const errors: string[] = [];
  const parsed = PlayerHistorySchema.safeParse(state.draft);
  if (!parsed.success) {
    return { draft: null, errors: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const draft = structuredClone(parsed.data);
  const known = new Set(state.documents.map((d) => normalizeUrl(d.url)));
  const isKnown = (u: string | null) => u !== null && known.has(normalizeUrl(u));

  const before = draft.sources.length;
  draft.sources = draft.sources.filter((s) => isKnown(s.url));
  for (const c of [...draft.winConditions, ...draft.lossConditions]) {
    if (c.sourceUrl && !isKnown(c.sourceUrl)) c.sourceUrl = null;
  }

  if (!draft.summary.trim()) errors.push("summary is empty");
  if (state.documents.length > 0 && draft.sources.length === 0) {
    errors.push(
      before > 0
        ? "sources contained URLs that are not in the provided documents; cite only provided URLs"
        : "no sources cited although documents were provided",
    );
  }
  if (state.documents.length > 0 && draft.winConditions.length + draft.lossConditions.length === 0) {
    errors.push("winConditions and lossConditions are both empty; extract situational patterns from the documents");
  }

  // Evidence-based confidence ceiling.
  const evidence = (state.apiStats.length > 0 ? 1 : 0) + Math.min(draft.sources.length, 3);
  const ceiling = [0.2, 0.45, 0.6, 0.75, 0.9][evidence] ?? 0.9;
  draft.confidence = Math.min(draft.confidence, ceiling);

  return { draft, errors };
}

export function validate() {
  return async (state: GraphState): Promise<GraphUpdate> => {
    const { draft, errors } = checkDraft(state);
    if (errors.length && state.attempts < MAX_EXTRACT_ATTEMPTS) {
      return { validationErrors: errors, outcome: null };
    }
    return {
      draft: draft ?? state.draft,
      validationErrors: errors,
      outcome: errors.length || !draft ? "needs_review" : "ready",
    };
  };
}

export function routeAfterValidate(state: GraphState): "extract" | "persist" {
  return state.outcome === null ? "extract" : "persist";
}
