/**
 * CricketData.org (cricapi) adapter: upcoming / live / recent cricket fixtures.
 *
 * History comes from Cricsheet (ml-service importer), so this adapter only covers what
 * Cricsheet cannot: fixtures before they are played, toss, and live state.
 *
 * NOT YET VERIFIED against the live API (no key was available and the docs render only
 * with JavaScript). Field names follow the publicly known v1 shape; every field is read
 * defensively and unknown shapes are skipped, not thrown. The only confirmed detail is the
 * failure envelope: HTTP 200 with {"status":"failure","reason":"..."}.
 */
import {
  CRICKET_KNOWN_ALIASES,
  cricketTeamKey,
  env,
  splitCricketGender,
  type CricketGender,
} from "@tusky/shared";
import type { MatchStatus, NormalizedFixture, NormalizedPlayerProfile, NormalizedSeasonStats, SportAdapter } from "../types.ts";
import { makePgQuotaGuard, type FetchLike, type QuotaGuard } from "../apiSports/client.ts";

export const CRICKETDATA_PROVIDER = "cricketdata";
const BASE_URL = "https://api.cricapi.com/v1";

export interface RawCricketDataMatch {
  id: string;
  name?: string;
  matchType?: string;
  status?: string;
  venue?: string;
  date?: string;
  dateTimeGMT?: string;
  teams?: string[];
  teamInfo?: { name: string; shortname?: string; img?: string }[];
  score?: { r?: number; w?: number; o?: number; inning?: string }[];
  series_id?: string;
  matchStarted?: boolean;
  matchEnded?: boolean;
  tossWinner?: string;
  tossChoice?: string;
  matchWinner?: string;
}

interface Envelope<T> {
  status: string;
  reason?: string;
  data?: T;
  info?: { hitsToday?: number; hitsLimit?: number; offsetRows?: number; totalRows?: number };
}

export class CricketDataError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CricketDataError";
  }
}

export class CricketDataClient {
  private lastCallAt = 0;

  constructor(
    private readonly opts: { apiKey?: string; fetchImpl?: FetchLike; quota?: QuotaGuard; minIntervalMs?: number } = {},
  ) {}

  async get<T>(path: string, params: Record<string, string | number> = {}): Promise<Envelope<T>> {
    const apiKey = this.opts.apiKey ?? env.CRICKETDATA_API_KEY;
    if (!apiKey) throw new Error("CRICKETDATA_API_KEY is not set (see .env.example)");
    const wait = this.lastCallAt + (this.opts.minIntervalMs ?? 1_000) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await (this.opts.quota ?? makePgQuotaGuard(CRICKETDATA_PROVIDER, () => env.CRICKETDATA_DAILY_BUDGET)).reserve("cricket");

    const url = new URL(`${BASE_URL}/${path}`);
    url.searchParams.set("apikey", apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    this.lastCallAt = Date.now();
    const fetchImpl: FetchLike = this.opts.fetchImpl ?? (fetch as unknown as FetchLike);
    const res = await fetchImpl(url.toString(), { headers: {} });
    if (!res.ok) throw new CricketDataError(`HTTP ${res.status} for ${path}`, res.status >= 500 || res.status === 429);
    const body = (await res.json()) as Envelope<T>;
    if (body.status !== "success") {
      const reason = body.reason ?? "unknown error";
      // "Invalid API Key" / plan errors will not fix themselves; limits reset daily.
      throw new CricketDataError(`CricketData ${path}: ${reason}`, /limit|hits|blocked/i.test(reason));
    }
    return body;
  }
}

const FORMAT: Record<string, string> = { t20: "T20", t20i: "T20", odi: "ODI", test: "Test" };

/** Splits "Wankhede Stadium, Mumbai" into venue + city (last comma part). */
function splitVenue(v: string | undefined): { venue: string | null; city: string | null } {
  if (!v) return { venue: null, city: null };
  const i = v.lastIndexOf(",");
  return i > 0 ? { venue: v.slice(0, i).trim(), city: v.slice(i + 1).trim() } : { venue: v.trim(), city: null };
}

function status(m: RawCricketDataMatch): MatchStatus {
  if (m.matchEnded) return "completed";
  if (m.matchStarted) return "live";
  if (m.status && /abandon|cancel/i.test(m.status)) return "cancelled";
  if (m.status && /postpone/i.test(m.status)) return "postponed";
  return "scheduled";
}

function team(name: string, gender: CricketGender, logo: string | undefined) {
  const canonical = CRICKET_KNOWN_ALIASES[name] ?? name;
  return { externalId: cricketTeamKey(canonical, gender), name: canonical, country: null, logoUrl: logo ?? null, provider: "cricket" };
}

/** Total runs per team across its innings (score[].inning looks like "India Inning 1"). */
function totals(m: RawCricketDataMatch, names: [string, string]): { home: number | null; away: number | null } {
  if (!m.matchEnded || !m.score?.length) return { home: null, away: null };
  const sum = (teamName: string) =>
    m.score!.filter((s) => s.inning?.toLowerCase().startsWith(teamName.toLowerCase())).reduce((t, s) => t + (s.r ?? 0), 0);
  return { home: sum(names[0]), away: sum(names[1]) };
}

export function mapCricketDataMatch(m: RawCricketDataMatch): NormalizedFixture | null {
  const when = m.dateTimeGMT ? new Date(m.dateTimeGMT.endsWith("Z") ? m.dateTimeGMT : `${m.dateTimeGMT}Z`) : null;
  if (!m.id || !m.teams || m.teams.length !== 2 || !when || Number.isNaN(when.getTime())) return null;
  const [a, b] = m.teams.map(splitCricketGender) as [ReturnType<typeof splitCricketGender>, ReturnType<typeof splitCricketGender>];
  const gender: CricketGender = a.gender === "female" || b.gender === "female" ? "female" : "male";
  const logo = (raw: string) => m.teamInfo?.find((t) => t.name === raw)?.img;
  const home = team(a.name, gender, logo(m.teams[0]!));
  const away = team(b.name, gender, logo(m.teams[1]!));
  const byRaw = new Map([
    [m.teams[0]!, home.externalId],
    [m.teams[1]!, away.externalId],
  ]);
  const { venue, city } = splitVenue(m.venue);
  const format = FORMAT[(m.matchType ?? "").toLowerCase()] ?? null;
  const decision = m.tossChoice?.toLowerCase().startsWith("bat") ? "bat" : m.tossChoice ? "field" : null;
  return {
    externalId: m.id,
    startTime: when,
    venue,
    city,
    status: status(m),
    providerStatus: m.status ?? null,
    competition: {
      externalId: m.series_id ?? `unknown:${format ?? "cricket"}`,
      name: m.name?.split(",").slice(1).join(",").trim() || "Cricket",
      country: null,
      season: when.getUTCFullYear().toString(),
      logoUrl: null,
    },
    home,
    away,
    score: totals(m, [m.teams[0]!, m.teams[1]!]),
    format,
    toss: m.tossWinner && byRaw.get(m.tossWinner) ? { winnerExternalId: byRaw.get(m.tossWinner)!, decision } : null,
    winnerExternalId: m.matchWinner ? (byRaw.get(m.matchWinner) ?? null) : null,
    raw: m,
  };
}

export class CricketDataAdapter implements SportAdapter {
  readonly sport = "cricket" as const;
  readonly provider = CRICKETDATA_PROVIDER;
  /** Used only when a format is unknown; see durationMinutes(). */
  readonly matchDurationMinutes = 480;
  /** Squads/history come from Cricsheet; no per-player enrichment from this source. */
  readonly enrichPlayers = false;

  constructor(
    private readonly client = new CricketDataClient(),
    private readonly formats: string[] = [],
    private readonly maxPages = 4,
  ) {}

  durationMinutes(format: string | null): number {
    if (format === "T20") return 240;
    if (format === "ODI") return 540;
    if (format === "Test") return 5 * 24 * 60;
    return this.matchDurationMinutes;
  }

  /** Pages through /matches (newest list the API offers) and keeps fixtures on the given UTC dates. */
  async fetchUpcoming(dates: string[]): Promise<NormalizedFixture[]> {
    const wanted = new Set(dates);
    const out = new Map<string, NormalizedFixture>();
    for (let page = 0; page < this.maxPages; page++) {
      const body = await this.client.get<RawCricketDataMatch[]>("matches", { offset: page * 25 });
      const rows = body.data ?? [];
      for (const raw of rows) {
        const f = mapCricketDataMatch(raw);
        if (!f || !wanted.has(f.startTime.toISOString().slice(0, 10))) continue;
        if (this.formats.length && (!f.format || !this.formats.includes(f.format))) continue;
        out.set(f.externalId, f);
      }
      const total = body.info?.totalRows;
      if (!rows.length || (total != null && (page + 1) * 25 >= total)) break;
    }
    return [...out.values()];
  }

  /** History is imported from Cricsheet instead (`npm run cricket:import`). */
  async fetchSeasonResults(): Promise<NormalizedFixture[]> {
    return [];
  }

  async fetchSquad(): Promise<[]> {
    return [];
  }

  async fetchPlayerSeasonStats(): Promise<{ profile: NormalizedPlayerProfile | null; stats: NormalizedSeasonStats[] }> {
    return { profile: null, stats: [] };
  }

  statsSeasons(): string[] {
    return [];
  }
}
