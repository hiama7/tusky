import type { PlayerHistory } from "@tusky/shared";
import type { StructuredInvoker } from "../src/agent/llm.ts";
import type { ResearchDoc, SearchFn } from "../src/agent/tools/search.ts";

export const DOC_URL = "https://news.example.com/b-striker-form";

export function fakeSearch(docs: ResearchDoc[] = [{ url: DOC_URL, title: "Striker in form", content: "Scored 7 in his last 5 home games.", query: "" }]): SearchFn {
  return async (query) => docs.map((d) => ({ ...d, query }));
}

export function draft(overrides: Partial<PlayerHistory> = {}): PlayerHistory {
  return {
    summary: "Clinical striker who thrives at home.",
    recentForm: [{ period: "last 5", summary: "7 goals", rating: 8 }],
    winConditions: [{ situation: "home games", impact: "scores far more often", evidence: "7 in 5 at home", sourceUrl: DOC_URL }],
    lossConditions: [{ situation: "vs low blocks", impact: "few shots", evidence: null, sourceUrl: "https://invented.example.org" }],
    strengths: ["finishing"],
    weaknesses: ["aerial duels"],
    injuries: [],
    keyStats: [],
    sources: [{ url: DOC_URL, title: "Striker in form" }],
    confidence: 0.99,
    ...overrides,
  };
}

/** Returns the queued drafts in order (last one repeats), recording each call's prompt. */
export function scriptedInvoker(drafts: PlayerHistory[], provider = "gemini") {
  const prompts: string[] = [];
  let i = 0;
  const invoke: StructuredInvoker = async (_schema, input) => {
    const msgs = input as [string, string][];
    prompts.push(msgs.map((m) => m[1]).join("\n"));
    const data = drafts[Math.min(i++, drafts.length - 1)]!;
    return { data: structuredClone(data) as never, provider: provider as never, model: "fake-model", tokensIn: 100, tokensOut: 50 };
  };
  return { invoke, prompts };
}
