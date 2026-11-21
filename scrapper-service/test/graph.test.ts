import { describe, expect, it, vi } from "vitest";
import { QuotaExceededError, type NormalizedSeasonStats } from "@tusky/providers";
import { PlayerHistorySchema } from "@tusky/shared";
import { runPlayerHistoryGraph } from "../src/agent/graph.ts";
import { createStructuredInvoker, AllProvidersFailedError, type LlmProvider } from "../src/agent/llm.ts";
import { budgetDocuments } from "../src/agent/nodes/webResearch.ts";
import type { GraphDeps, PlayerContext } from "../src/agent/state.ts";
import { DOC_URL, draft, fakeSearch, scriptedInvoker } from "./helpers.ts";

const player: PlayerContext = {
  id: 1,
  sport: "football",
  provider: "api-sports",
  externalId: "1002",
  name: "B. Striker",
  nationality: null,
  position: "Attacker",
  birthDate: null,
  teamName: "Home United",
  competitionName: "Premier League",
  matchSeason: "2026",
};

const apiStats: NormalizedSeasonStats[] = [
  { season: "2026", competitionExternalId: "39", competitionName: "Premier League", competitionCountry: "England", teamName: "Home United", stats: { goals: 9, assists: null } },
];

function deps(overrides: Partial<GraphDeps> = {}): GraphDeps & { persist: ReturnType<typeof vi.fn> } {
  return {
    fetchApiStats: async () => apiStats,
    search: fakeSearch(),
    invoke: scriptedInvoker([draft()]).invoke,
    persist: vi.fn(async () => {}),
    ...overrides,
  } as GraphDeps & { persist: ReturnType<typeof vi.fn> };
}

describe("player history graph", () => {
  it("happy path: persists a ready profile, strips invented URLs, caps confidence", async () => {
    const d = deps();
    const state = await runPlayerHistoryGraph(d, player);

    expect(state.outcome).toBe("ready");
    expect(state.attempts).toBe(1);
    expect(d.persist).toHaveBeenCalledOnce();
    const saved = d.persist.mock.calls[0]![0];
    expect(saved.outcome).toBe("ready");
    expect(saved.draft.lossConditions[0].sourceUrl).toBeNull(); // invented URL removed
    expect(saved.draft.winConditions[0].sourceUrl).toBe(DOC_URL);
    expect(saved.draft.confidence).toBe(0.6); // api stats + 1 source => ceiling 0.6
    expect(saved.usage).toMatchObject({ provider: "gemini", tokensIn: 100, tokensOut: 50 });
  });

  it("passes API stats and documents into the prompt (nulls omitted)", async () => {
    const { invoke, prompts } = scriptedInvoker([draft()]);
    await runPlayerHistoryGraph(deps({ invoke }), player);
    expect(prompts[0]).toContain('"goals":9');
    expect(prompts[0]).not.toContain('"assists":null');
    expect(prompts[0]).toContain(DOC_URL);
  });

  it("retries extract once with the validation errors, then succeeds", async () => {
    const bad = draft({ sources: [{ url: "https://hallucinated.example", title: null }] });
    const { invoke, prompts } = scriptedInvoker([bad, draft()]);
    const d = deps({ invoke });
    const state = await runPlayerHistoryGraph(d, player);

    expect(state.attempts).toBe(2);
    expect(state.outcome).toBe("ready");
    expect(prompts[1]).toContain("PREVIOUS ANSWER WAS REJECTED");
    expect(state.usage.tokensIn).toBe(200); // summed across attempts
  });

  it("marks needs_review when the model keeps failing validation", async () => {
    const bad = draft({ sources: [], winConditions: [], lossConditions: [] });
    const d = deps({ invoke: scriptedInvoker([bad]).invoke });
    const state = await runPlayerHistoryGraph(d, player);

    expect(state.attempts).toBe(2);
    expect(state.outcome).toBe("needs_review");
    expect(d.persist.mock.calls[0]![0].outcome).toBe("needs_review");
  });

  it("still works with no web documents (low confidence)", async () => {
    const d = deps({ search: fakeSearch([]), fetchApiStats: async () => [] });
    const state = await runPlayerHistoryGraph(d, player);
    expect(state.outcome).toBe("ready");
    expect(d.persist.mock.calls[0]![0].draft.confidence).toBe(0.2);
  });

  it("continues when API stats fail, but propagates quota errors", async () => {
    const failing = deps({ fetchApiStats: async () => Promise.reject(new Error("HTTP 500")) });
    await expect(runPlayerHistoryGraph(failing, player)).resolves.toMatchObject({ outcome: "ready", apiStats: [] });

    const quota = deps({ fetchApiStats: async () => Promise.reject(new QuotaExceededError("football", 90, 90)) });
    await expect(runPlayerHistoryGraph(quota, player)).rejects.toBeInstanceOf(QuotaExceededError);
  });
});

describe("structured invoker fallback", () => {
  const schema = PlayerHistorySchema;

  function provider(name: LlmProvider["name"], result: () => unknown): LlmProvider {
    const chat = {
      withStructuredOutput: () => ({
        invoke: async () => ({ raw: { usage_metadata: { input_tokens: 10, output_tokens: 5 } }, parsed: result() }),
      }),
    };
    return { name, model: `${name}-model`, chat: chat as never };
  }

  it("falls back from gemini to groq and reports who answered", async () => {
    const invoke = createStructuredInvoker([
      provider("gemini", () => {
        throw new Error("429 quota");
      }),
      provider("groq", () => draft()),
    ]);
    const res = await invoke(schema, "x", "player_history");
    expect(res).toMatchObject({ provider: "groq", model: "groq-model", tokensIn: 10, tokensOut: 5 });
  });

  it("treats schema-invalid output as a failure and throws when all providers fail", async () => {
    const invoke = createStructuredInvoker([provider("gemini", () => ({ summary: 1 })), provider("groq", () => null)]);
    await expect(invoke(schema, "x", "player_history")).rejects.toBeInstanceOf(AllProvidersFailedError);
  });
});

describe("budgetDocuments", () => {
  it("dedupes by URL and trims long content", () => {
    const docs = budgetDocuments([
      { url: "a", title: null, content: "x".repeat(5000), query: "q" },
      { url: "a", title: null, content: "dup", query: "q" },
      { url: "b", title: null, content: "short", query: "q" },
    ]);
    expect(docs.map((d) => d.url)).toEqual(["a", "b"]);
    expect(docs[0]!.content.length).toBe(1501);
  });
});
