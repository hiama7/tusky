/**
 * Cricket team identity, shared by every cricket source. MUST stay in sync with
 * `team_key` / `KNOWN_ALIASES` in ml-service/tusky_ml/ingest/cricsheet.py, otherwise the
 * Cricsheet history and the live fixtures would create two rows for the same team.
 *
 * Key = "<m|f>:<normalized name>", e.g. "m:punjab kings", "f:india".
 */

/** Franchise renames: old name -> current name (same team, so ratings carry over). */
export const CRICKET_KNOWN_ALIASES: Record<string, string> = {
  "Royal Challengers Bangalore": "Royal Challengers Bengaluru",
  "Delhi Daredevils": "Delhi Capitals",
  "Kings XI Punjab": "Punjab Kings",
  "Rising Pune Supergiants": "Rising Pune Supergiant",
};

export function normalizeCricketName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s&]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type CricketGender = "male" | "female";

/** Splits a provider team name like "India Women" / "India W" into name + gender. */
export function splitCricketGender(name: string): { name: string; gender: CricketGender } {
  const m = /^(.*?)\s+(women|w)$/i.exec(name.trim());
  return m ? { name: m[1]!, gender: "female" } : { name: name.trim(), gender: "male" };
}

export function cricketTeamKey(name: string, gender: CricketGender = "male"): string {
  const canonical = CRICKET_KNOWN_ALIASES[name] ?? name;
  return `${gender === "female" ? "f" : "m"}:${normalizeCricketName(canonical)}`;
}
