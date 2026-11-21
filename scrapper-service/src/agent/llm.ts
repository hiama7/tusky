import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { AIMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import type { z } from "zod";
import { childLogger, env } from "@tusky/shared";

const log = childLogger("llm");

export type LlmProviderName = "gemini" | "groq" | "claude";

export interface LlmProvider {
  name: LlmProviderName;
  model: string;
  chat: BaseChatModel;
}

export interface StructuredResult<T> {
  data: T;
  provider: LlmProviderName;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export class AllProvidersFailedError extends Error {
  constructor(readonly failures: { provider: string; error: string }[]) {
    super(`All LLM providers failed: ${failures.map((f) => `${f.provider}: ${f.error}`).join(" | ")}`);
    this.name = "AllProvidersFailedError";
  }
}

/**
 * Provider order: Gemini (primary) -> Groq (fallback) -> Claude (only if a key is set; used sparingly).
 * Providers without an API key are skipped. maxRetries is low so we fall through quickly.
 */
export function buildProviders(): LlmProvider[] {
  const providers: LlmProvider[] = [];
  if (env.GOOGLE_API_KEY) {
    providers.push({
      name: "gemini",
      model: env.LLM_GEMINI_MODEL,
      chat: new ChatGoogleGenerativeAI({
        model: env.LLM_GEMINI_MODEL,
        apiKey: env.GOOGLE_API_KEY,
        temperature: 0,
        maxRetries: 1,
      }),
    });
  }
  if (env.GROQ_API_KEY) {
    providers.push({
      name: "groq",
      model: env.LLM_GROQ_MODEL,
      chat: new ChatGroq({ model: env.LLM_GROQ_MODEL, apiKey: env.GROQ_API_KEY, temperature: 0, maxRetries: 1 }),
    });
  }
  if (env.ANTHROPIC_API_KEY) {
    providers.push({
      name: "claude",
      model: env.LLM_CLAUDE_MODEL,
      chat: new ChatAnthropic({
        model: env.LLM_CLAUDE_MODEL,
        apiKey: env.ANTHROPIC_API_KEY,
        temperature: 0,
        maxRetries: 1,
        maxTokens: 4096,
      }),
    });
  }
  return providers;
}

export type StructuredInvoker = <T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  input: BaseLanguageModelInput,
  name: string,
) => Promise<StructuredResult<T>>;

/**
 * Calls providers in order until one returns output that parses against `schema`.
 * Implemented as an explicit loop (rather than `.withFallbacks`) so we know which
 * provider answered and can record its token usage in `scrape_runs`.
 */
export function createStructuredInvoker(providers: LlmProvider[] = buildProviders()): StructuredInvoker {
  if (!providers.length) {
    throw new Error("No LLM provider configured: set GOOGLE_API_KEY and/or GROQ_API_KEY (see .env.example)");
  }
  return async (schema, input, name) => {
    const failures: { provider: string; error: string }[] = [];
    for (const p of providers) {
      try {
        const runnable = p.chat.withStructuredOutput(schema, { name, includeRaw: true });
        const res = (await runnable.invoke(input)) as { raw: AIMessage; parsed: unknown };
        const parsed = schema.safeParse(res.parsed);
        if (!parsed.success) {
          throw new Error(`output did not match schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        }
        const usage = res.raw?.usage_metadata;
        return {
          data: parsed.data,
          provider: p.name,
          model: p.model,
          tokensIn: usage?.input_tokens ?? 0,
          tokensOut: usage?.output_tokens ?? 0,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ provider: p.name, model: p.model, err: msg.slice(0, 300) }, "LLM provider failed, trying next");
        failures.push({ provider: p.name, error: msg.slice(0, 300) });
      }
    }
    throw new AllProvidersFailedError(failures);
  };
}
