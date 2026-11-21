import { db, providerQuota, sql } from "@tusky/db";
import { childLogger, env, type SportCode } from "@tusky/shared";

const log = childLogger("api-sports");

export const API_SPORTS_PROVIDER = "api-sports";

const BASE_URLS: Record<SportCode, string> = {
  football: "https://v3.football.api-sports.io",
  basketball: "https://v1.basketball.api-sports.io",
};

export class QuotaExceededError extends Error {
  constructor(
    readonly sport: SportCode,
    readonly used: number,
    readonly budget: number,
  ) {
    super(`API-Sports daily budget reached for ${sport} (${used}/${budget})`);
    this.name = "QuotaExceededError";
  }
}

export class ApiSportsError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
    readonly errors: unknown,
    /** Plan / access errors won't succeed on retry. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ApiSportsError";
  }
}

export interface ApiSportsEnvelope<T> {
  get: string;
  parameters: Record<string, string>;
  errors: unknown[] | Record<string, string>;
  results: number;
  paging?: { current: number; total: number };
  response: T[];
}

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface QuotaGuard {
  /** Reserve one request; throws QuotaExceededError when the daily budget is used up. */
  reserve(sport: SportCode): Promise<void>;
}

/** Postgres-backed daily counter (API-Sports quotas reset at 00:00 UTC). */
export const pgQuotaGuard: QuotaGuard = {
  async reserve(sport) {
    const day = new Date().toISOString().slice(0, 10);
    const [row] = await db
      .insert(providerQuota)
      .values({ provider: API_SPORTS_PROVIDER, sport, day, requestsUsed: 1 })
      .onConflictDoUpdate({
        target: [providerQuota.provider, providerQuota.sport, providerQuota.day],
        set: { requestsUsed: sql`${providerQuota.requestsUsed} + 1` },
      })
      .returning({ used: providerQuota.requestsUsed });
    const used = row!.used;
    if (used > env.APISPORTS_DAILY_BUDGET) {
      throw new QuotaExceededError(sport, used - 1, env.APISPORTS_DAILY_BUDGET);
    }
  },
};

/** Next 00:05 UTC, when the API-Sports quota has reset. */
export function nextQuotaReset(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));
  return d;
}

function hasErrors(errors: ApiSportsEnvelope<unknown>["errors"]): boolean {
  return Array.isArray(errors) ? errors.length > 0 : Object.keys(errors ?? {}).length > 0;
}

export class ApiSportsClient {
  private lastCallAt = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly sport: SportCode,
    private readonly opts: {
      apiKey?: string;
      fetchImpl?: FetchLike;
      quota?: QuotaGuard;
      minIntervalMs?: number;
    } = {},
  ) {}

  /** GET an endpoint, following pagination when `allPages` is set. Calls are serialized + throttled. */
  async get<T>(path: string, params: Record<string, string | number>, allPages = false): Promise<T[]> {
    const first = await this.request<T>(path, params);
    const out = [...first.response];
    if (allPages && first.paging && first.paging.total > 1) {
      for (let page = 2; page <= first.paging.total; page++) {
        const next = await this.request<T>(path, { ...params, page });
        out.push(...next.response);
      }
    }
    return out;
  }

  private request<T>(path: string, params: Record<string, string | number>): Promise<ApiSportsEnvelope<T>> {
    const run = this.chain.then(() => this.doRequest<T>(path, params));
    // Keep the chain alive even if this call fails.
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async doRequest<T>(path: string, params: Record<string, string | number>): Promise<ApiSportsEnvelope<T>> {
    const apiKey = this.opts.apiKey ?? env.APISPORTS_KEY;
    if (!apiKey) throw new Error("APISPORTS_KEY is not set (see .env.example)");

    const wait = this.lastCallAt + (this.opts.minIntervalMs ?? env.APISPORTS_MIN_INTERVAL_MS) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    await (this.opts.quota ?? pgQuotaGuard).reserve(this.sport);

    const url = new URL(path, BASE_URLS[this.sport]);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    this.lastCallAt = Date.now();
    const fetchImpl: FetchLike = this.opts.fetchImpl ?? (fetch as unknown as FetchLike);
    const res = await fetchImpl(url.toString(), { headers: { "x-apisports-key": apiKey } });
    log.debug({ sport: this.sport, path, params, status: res.status }, "api-sports request");

    if (!res.ok) {
      throw new ApiSportsError(`HTTP ${res.status} for ${path}`, path, null, res.status >= 500 || res.status === 429);
    }
    const body = (await res.json()) as ApiSportsEnvelope<T>;
    if (hasErrors(body.errors)) {
      const text = JSON.stringify(body.errors);
      // "plan" errors = season/endpoint not available on the current subscription.
      const retryable = /rate ?limit|requests/i.test(text) && !/plan/i.test(text);
      throw new ApiSportsError(`API-Sports error on ${path}: ${text}`, path, body.errors, retryable);
    }
    return body;
  }
}
