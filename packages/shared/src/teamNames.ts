/**
 * Club-name normalization for matching the same club across data sources. MUST stay in sync
 * with `normalize_team` in ml-service/tusky_ml/ingest/openfootball.py (a parity test in each
 * language uses the same cases).
 *
 * "FC Bayern München" -> "bayern munchen", "AFC Bournemouth" -> "bournemouth", "1. FC Köln" -> "koln".
 */
const DROP = new Set([
  "fc", "afc", "cf", "ac", "as", "ss", "ssc", "sc", "sv", "fk", "rc", "rcd", "ud", "us", "cd",
  "vfb", "vfl", "tsg", "fsv", "bsc", "sco", "ogc", "hsc", "1",
]);

export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !DROP.has(t))
    .join(" ");
}
