import { TavilySearch } from "@langchain/tavily";
import { childLogger, env } from "@tusky/shared";

const log = childLogger("search");

export interface ResearchDoc {
  url: string;
  title: string | null;
  content: string;
  query: string;
}

export type SearchFn = (query: string) => Promise<ResearchDoc[]>;

interface TavilyResult {
  url: string;
  title?: string;
  content?: string;
}

/** Tavily-backed web search. Returns [] (and warns once) when no TAVILY_API_KEY is configured. */
export function createTavilySearch(maxResults = 4): SearchFn {
  if (!env.TAVILY_API_KEY) {
    log.warn("TAVILY_API_KEY not set: player research will use API stats only (lower confidence)");
    return async () => [];
  }
  const tool = new TavilySearch({ maxResults, topic: "general", tavilyApiKey: env.TAVILY_API_KEY });

  return async (query) => {
    const out: unknown = await tool.invoke({ query });
    const body = (typeof out === "string" ? JSON.parse(out) : out) as { results?: TavilyResult[]; error?: string };
    if (body.error) throw new Error(`Tavily: ${body.error}`);
    return (body.results ?? [])
      .filter((r) => r.url && r.content)
      .map((r) => ({ url: r.url, title: r.title ?? null, content: r.content!, query }));
  };
}
