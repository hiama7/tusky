"""openfootball importer: league results and fixtures from github.com/openfootball/football.json.

Licence: CC0 1.0 (public domain), confirmed from the repository's LICENSE.md. The data has
results only (no shots, cards or odds), and the daily-regenerated 2026-27 files lag the real
season: matches whose date has passed but that have no score are stored as completed with
provider_status `NR` and null scores, and get their result when a later import has it.

Identity rules (shared with the rest of the football data):
- competitions: the existing API-Sports rows (en.1 -> 39, es.1 -> 140, it.1 -> 135, de.1 -> 78, fr.1 -> 61)
- teams: learned from the seasons that overlap the API-Sports history (same date +/- 1 day and
  same score votes for a name -> team pairing), then normalized-name matching, then a new
  `openfootball` team. Every decision is stored as a team_aliases row "of:<league>:<name>".
- matches: a match that already exists (same teams, date +/- 1 day) is left alone, only
  checked; otherwise it is stored as provider `openfootball` with a date-independent
  external id, so a rescheduled game updates its own row instead of duplicating.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg

log = logging.getLogger("tusky_ml.openfootball")

SOURCE = "openfootball"
RAW_URL = "https://raw.githubusercontent.com/openfootball/football.json/master/{season}/{league}.json"

# football.json file -> (API-Sports league id, timezone of the printed kick-off times)
LEAGUES = {
    "en.1": ("39", "Europe/London"),
    "es.1": ("140", "Europe/Madrid"),
    "it.1": ("135", "Europe/Rome"),
    "de.1": ("78", "Europe/Berlin"),
    "fr.1": ("61", "Europe/Paris"),
}
DEFAULT_KICKOFF = "15:00"
SAME_FIXTURE_DAYS = 60  # keep equal to the football adapter's sameFixtureWindowHours (24 * 60 hours)

# (league file, normalized openfootball name) -> exact existing team name. Reviewed by hand: an
# automatic fuzzy rule would also merge different clubs (e.g. Paris FC into Paris Saint Germain).
# Add a line when the "possible duplicates" warning of an import points at the same club.
OVERRIDES: dict[tuple[str, str], str] = {
    ("fr.1", "es troyes"): "Estac Troyes",
    ("de.1", "07 elversberg"): "SV Elversberg",
}
MIN_VOTES = 8
VOTE_RATIO = 3.0

_DROP = {"fc", "afc", "cf", "ac", "as", "ss", "ssc", "sc", "sv", "fk", "rc", "rcd", "ud", "us", "cd",
         "vfb", "vfl", "tsg", "fsv", "bsc", "sco", "ogc", "hsc", "1"}


def similar_names(name: str, existing: list[str]) -> list[str]:
    """Existing names sharing a distinctive (5+ letter) token with `name`, for duplicate warnings."""
    mine = {t for t in normalize_team(name).split() if len(t) >= 5}
    return [e for e in existing if normalize_team(e) != normalize_team(name) and mine & set(normalize_team(e).split())]


def normalize_team(name: str) -> str:
    """Accent-free lowercase name without club-form prefixes/suffixes (FC, AFC, 1. ...)."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    toks = [t for t in re.sub(r"[^a-z0-9 ]", " ", s).split() if t not in _DROP]
    return " ".join(toks)


# ---- parsing (pure) ----------------------------------------------------------------------------


@dataclass(frozen=True)
class OFMatch:
    season: str  # "2025-26"
    league: str  # "en.1"
    date: str  # "YYYY-MM-DD" as printed (local calendar date)
    start: datetime  # UTC
    home: str
    away: str
    score: tuple[int, int] | None
    round: str | None

    @property
    def external_id(self) -> str:
        return f"{self.season}:{self.league}:{normalize_team(self.home)}:{normalize_team(self.away)}"


def parse_score(s) -> tuple[int, int] | None:
    """`{"ft": [a, b], "ht": [...]}` or a bare `[a, b]` (all bare lists in the data are draws)."""
    if not s:
        return None
    ft = s if isinstance(s, list) else s.get("ft")
    return (int(ft[0]), int(ft[1])) if ft and len(ft) == 2 else None


def kickoff_utc(date: str, hhmm: str | None, tz: str) -> datetime:
    h, m = (hhmm or DEFAULT_KICKOFF).split(":")
    d = datetime.fromisoformat(date).replace(hour=int(h), minute=int(m), tzinfo=ZoneInfo(tz))
    return d.astimezone(timezone.utc)


def parse_file(doc: dict, season: str, league: str) -> list[OFMatch]:
    tz = LEAGUES[league][1]
    return [
        OFMatch(
            season=season,
            league=league,
            date=m["date"],
            start=kickoff_utc(m["date"], m.get("time"), tz),
            home=m["team1"],
            away=m["team2"],
            score=parse_score(m.get("score")),
            round=m.get("round"),
        )
        for m in doc["matches"]
    ]


# ---- downloading ---------------------------------------------------------------------------------


def download(season: str, league: str, dest_dir: Path, attempts: int = 5) -> Path:
    """Fetch one file with retries (raw.githubusercontent.com resolves flakily on some networks)."""
    target = dest_dir / season / f"{league}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    url = RAW_URL.format(season=season, league=league)
    last: Exception | None = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "tusky-ingest/0.1"})
            with urllib.request.urlopen(req, timeout=30) as res:
                body = res.read()
            json.loads(body)  # fail now on a truncated body, not at import time
            target.write_bytes(body)
            return target
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"could not download {url}: {last}")


# ---- team identity ---------------------------------------------------------------------------------


def learn_votes(of: list[OFMatch], db: list[tuple[str, int, int, int, int, int]]) -> dict[str, dict[str, Counter]]:
    """Vote for name -> team pairings. `db` rows: (league id, ordinal day, home id, away id, home score, away score).
    A DB match votes when it is within a day of an openfootball match with the same score."""
    index: dict[tuple[str, int, int], list[tuple[int, int, int]]] = defaultdict(list)
    for league, day, h, a, hs, as_ in db:
        index[(league, hs, as_)].append((day, h, a))
    votes: dict[str, dict[str, Counter]] = defaultdict(lambda: defaultdict(Counter))
    for m in of:
        if m.score is None:
            continue
        lid = LEAGUES[m.league][0]
        day = datetime.fromisoformat(m.date).toordinal()
        for d, h, a in index.get((lid, *m.score), ()):
            if abs(d - day) <= 1:
                votes[m.league][m.home][h] += 1
                votes[m.league][m.away][a] += 1
    return votes


def pick(counter: Counter) -> int | None:
    """The clear winner of a vote, else None."""
    top = counter.most_common(2)
    if not top or top[0][1] < MIN_VOTES:
        return None
    if len(top) > 1 and top[0][1] < VOTE_RATIO * top[1][1]:
        return None
    return top[0][0]


# ---- importer ----------------------------------------------------------------------------------------


@dataclass
class Result:
    seasons: dict[str, dict[str, int]] = field(default_factory=dict)
    team_decisions: Counter = field(default_factory=Counter)
    new_teams: list[str] = field(default_factory=list)
    unresolved_ambiguous: list[str] = field(default_factory=list)
    possible_duplicates: list[str] = field(default_factory=list)
    overlap_pairs: int = 0
    overlap_same_score: int = 0
    overlap_missing_in_db: int = 0
    mismatches: list[str] = field(default_factory=list)

    def bump(self, key: str, what: str, n: int = 1) -> None:
        self.seasons.setdefault(key, Counter())[what] += n


class Importer:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self.sport_id = int(conn.execute("select id from sports where code = 'football'").fetchone()[0])
        self.comp = {
            ext: cid
            for ext, cid in conn.execute(
                "select external_id, id from competitions where sport_id = %s and provider = 'api-sports'", (self.sport_id,)
            ).fetchall()
        }
        self.teams = {
            tid: name for tid, name in conn.execute("select id, name from teams where sport_id = %s", (self.sport_id,)).fetchall()
        }
        by_norm: dict[str, list[int]] = defaultdict(list)
        for tid, name in self.teams.items():
            by_norm[normalize_team(name)].append(tid)
        self.by_norm = by_norm
        self.alias = dict(
            conn.execute("select alias, team_id from team_aliases where sport_id = %s and alias like 'of:%%'", (self.sport_id,)).fetchall()
        )
        self.result = Result()

    # -- teams --

    def _db_history(self) -> list[tuple[str, int, int, int, int, int]]:
        rows = self.conn.execute(
            """select c.external_id, m.start_time::date, m.home_team_id, m.away_team_id, m.home_score, m.away_score
               from matches m join competitions c on c.id = m.competition_id
               where m.sport_id = %s and m.provider = 'api-sports' and m.home_score is not null and c.external_id = any(%s)""",
            (self.sport_id, [v[0] for v in LEAGUES.values()]),
        ).fetchall()
        return [(lg, d.toordinal(), h, a, hs, as_) for lg, d, h, a, hs, as_ in rows]

    def resolve_teams(self, matches: list[OFMatch]) -> dict[tuple[str, str], int]:
        """(league, openfootball name) -> team id, creating teams that don't exist yet."""
        votes = learn_votes(matches, self._db_history())
        out: dict[tuple[str, str], int] = {}
        names = sorted({(m.league, n) for m in matches for n in (m.home, m.away)})
        for league, name in names:
            alias = f"of:{league}:{normalize_team(name)}"
            if alias in self.alias:
                out[(league, name)] = self.alias[alias]
                self.result.team_decisions["alias (earlier import)"] += 1
                continue
            tid, how = None, "override"
            wanted = OVERRIDES.get((league, normalize_team(name)))
            if wanted:
                found = [t for t, n in self.teams.items() if n == wanted]
                tid = found[0] if len(found) == 1 else None
            if tid is None:
                tid = pick(votes[league][name]) if league in votes and name in votes[league] else None
                how = "learned from overlapping scores"
            if tid is None:
                cands = self.by_norm.get(normalize_team(name), [])
                if len(cands) == 1:
                    tid, how = cands[0], "normalized name"
                elif len(cands) > 1:
                    self.result.unresolved_ambiguous.append(f"{league} {name}: {len(cands)} teams share that name")
            if tid is None:
                tid = self.conn.execute(
                    """insert into teams (sport_id, provider, external_id, name) values (%s, %s, %s, %s)
                       on conflict (sport_id, provider, external_id) do update set name = excluded.name returning id""",
                    (self.sport_id, SOURCE, alias, name),
                ).fetchone()[0]
                lookalikes = similar_names(name, [n for t, n in self.teams.items() if t != tid])
                self.teams[tid] = name
                how = "new team"
                self.result.new_teams.append(f"{league} {name}")
                if lookalikes:
                    self.result.possible_duplicates.append(f"{league} {name} ~ {', '.join(sorted(set(lookalikes)))}")
            self.conn.execute(
                "insert into team_aliases (sport_id, alias, team_id) values (%s, %s, %s) on conflict (sport_id, alias) do update set team_id = excluded.team_id",
                (self.sport_id, alias, tid),
            )
            self.alias[alias] = tid
            out[(league, name)] = tid
            self.result.team_decisions[how] += 1
        self.conn.commit()
        return out

    # -- matches --

    def _existing(self, home: int, away: int, start: datetime, competition_id: int | None) -> tuple[int, int | None, int | None] | None:
        """The same fixture from another provider (API-Sports), if any. Our own rows are excluded.
        A league pairing (home, away) happens once per season, so within one competition a
        postponed game that moved by days or weeks is still the same fixture."""
        row = self.conn.execute(
            """select id, home_score, away_score from matches
               where sport_id = %s and provider <> %s and home_team_id = %s and away_team_id = %s
                 and (%s::int is null or competition_id = %s)
                 and start_time between %s and %s order by abs(extract(epoch from start_time - %s)) limit 1""",
            (self.sport_id, SOURCE, home, away, competition_id, competition_id,
             start - timedelta(days=SAME_FIXTURE_DAYS), start + timedelta(days=SAME_FIXTURE_DAYS), start),
        ).fetchone()
        return (int(row[0]), row[1], row[2]) if row else None

    def import_matches(self, matches: list[OFMatch], now: datetime | None = None) -> Result:
        now = now or datetime.now(timezone.utc)
        team_ids = self.resolve_teams(matches)
        for m in matches:
            key = f"{m.season}/{m.league}"
            home, away = team_ids[(m.league, m.home)], team_ids[(m.league, m.away)]
            existing = self._existing(home, away, m.start, self.comp.get(LEAGUES[m.league][0]))
            if existing:
                # The fixture is already represented by another provider's row: never insert a second one.
                if existing[1] is not None and m.score is not None:
                    # Both have a result: compare, never overwrite.
                    self.result.overlap_pairs += 1
                    if (existing[1], existing[2]) == m.score:
                        self.result.overlap_same_score += 1
                    else:
                        self.result.mismatches.append(f"{m.date} {m.home} {m.score} vs db {existing[1]}-{existing[2]}")
                elif existing[1] is None and m.score is not None:
                    # Their row has no result yet: fill it in from this source.
                    self.conn.execute(
                        "update matches set home_score = %s, away_score = %s, status = 'completed', updated_at = now() where id = %s",
                        (m.score[0], m.score[1], existing[0]),
                    )
                    self.result.bump(key, "result added to existing match")
                self.result.bump(key, "already in db")
                continue
            if m.start < datetime(2025, 7, 1, tzinfo=timezone.utc) and m.score is not None:
                self.result.overlap_missing_in_db += 1  # in the overlap seasons but not in API-Sports data
            if m.score is not None:
                status, pstatus, label = "completed", "FT", "stored scored"
            elif m.start <= now:
                # Played, but the source has no result yet (it lags). Stored so the feature replay
                # knows the match happened (rest days, off-season detection); `NR` = no result.
                status, pstatus, label = "completed", "NR", "stored, result missing in source"
            else:
                status, pstatus, label = "scheduled", "NS", "stored upcoming"
            self.conn.execute(
                """insert into matches (sport_id, competition_id, provider, external_id, home_team_id, away_team_id,
                       start_time, status, provider_status, home_score, away_score, raw)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (sport_id, provider, external_id) do update set
                       start_time = excluded.start_time,
                       status = case when matches.status in ('live', 'completed') and excluded.status = 'scheduled'
                                     then matches.status else excluded.status end,
                       provider_status = excluded.provider_status,
                       home_score = coalesce(excluded.home_score, matches.home_score),
                       away_score = coalesce(excluded.away_score, matches.away_score),
                       raw = excluded.raw, updated_at = now()""",
                (self.sport_id, self.comp.get(LEAGUES[m.league][0]), SOURCE, m.external_id, home, away, m.start, status, pstatus,
                 m.score[0] if m.score else None, m.score[1] if m.score else None,
                 json.dumps({"round": m.round, "date": m.date, "source": "openfootball"})),
            )
            self.result.bump(key, label)
        self.conn.commit()
        return self.result


def import_files(conn: psycopg.Connection, files: list[tuple[str, str, Path]], now: datetime | None = None) -> Result:
    """Import (season, league, path) files; records each file's hash in ingest_files."""
    matches: list[OFMatch] = []
    for season, league, path in files:
        content = path.read_bytes()
        matches += parse_file(json.loads(content), season, league)
        conn.execute(
            """insert into ingest_files (source, file_name, sha256, status) values (%s, %s, %s, 'imported')
               on conflict (source, file_name) do update set sha256 = excluded.sha256, status = 'imported', imported_at = now()""",
            (SOURCE, f"{season}/{league}", hashlib.sha256(content).hexdigest()),
        )
    return Importer(conn).import_matches(matches, now=now)
