"""Cricsheet ball-by-ball importer (https://cricsheet.org, Open Data Commons Attribution).

Reads match JSON files (format 1.x; see https://cricsheet.org/format/json/) from a
downloaded zip, a folder, or single files, and writes matches, innings, deliveries,
line-ups, teams, players and venues. Idempotent: a file whose content hash has not
changed is skipped; a changed file replaces that match's innings/deliveries/line-ups.

Identity rules (shared with the TypeScript CricketData adapter, see cricketTeamKey):
- teams:   provider "cricket", external_id = "<m|f>:<normalized name>", after aliases
- players: provider "cricsheet", external_id = Cricsheet people-register id
- venues:  provider "cricsheet", external_id = Cricsheet venue-register id (or "name:<venue>")
- matches: provider "cricsheet", external_id = file id; if the same fixture already exists
           from another provider (same teams, same date), the result attaches to that row
           and a match_aliases entry records the Cricsheet id.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import urllib.request
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import psycopg

log = logging.getLogger("tusky_ml.cricsheet")

SOURCE = "cricsheet"
TEAM_PROVIDER = "cricket"
DOWNLOAD_BASE = "https://cricsheet.org/downloads/"
DATASETS = {
    "ipl": "ipl_json.zip",
    "t20s": "t20s_json.zip",
    "odis": "odis_json.zip",
    "tests": "tests_json.zip",
    "it20s": "it20s_json.zip",
    "all": "all_json.zip",
    "recent": "recently_added_30_json.zip",
}

FORMATS = {"T20": "T20", "IT20": "T20", "ODI": "ODI", "ODM": "ListA", "Test": "Test", "MDM": "MultiDay"}

# Franchise renames: old name -> current name (same team, so ratings carry over).
KNOWN_ALIASES = {
    "Royal Challengers Bangalore": "Royal Challengers Bengaluru",
    "Delhi Daredevils": "Delhi Capitals",
    "Kings XI Punjab": "Punjab Kings",
    "Rising Pune Supergiants": "Rising Pune Supergiant",
}

NOT_A_WICKET = {"retired hurt", "retired not out"}


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s&]", " ", name.lower())).strip()


def team_key(name: str, gender: str) -> str:
    """Canonical team id: gender initial + normalized name. Must match cricketTeamKey (TS)."""
    canonical = KNOWN_ALIASES.get(name, name)
    return f"{'f' if gender == 'female' else 'm'}:{normalize_name(canonical)}"


def phases(fmt: str) -> tuple[range, range, range] | None:
    """0-based over ranges for powerplay / middle / death."""
    if fmt == "T20":
        return range(0, 6), range(6, 15), range(15, 20)
    if fmt in ("ODI", "ListA"):
        return range(0, 10), range(10, 40), range(40, 50)
    return None


# ---- parsing (pure) ------------------------------------------------------------------


@dataclass
class Delivery:
    over: int
    ball: int
    batter: str
    bowler: str
    non_striker: str | None
    runs_batter: int
    runs_extras: int
    runs_total: int
    extras_kind: str | None
    is_legal: bool
    non_boundary: bool
    wicket_kind: str | None
    player_out: str | None
    extra_wickets: list | None


@dataclass
class Innings:
    number: int
    team: str
    runs: int
    wickets: int
    legal_balls: int
    extras: int
    target_runs: int | None
    target_overs: float | None
    declared: bool
    forfeited: bool
    super_over: bool
    phase: dict[str, int | None]
    deliveries: list[Delivery] = field(default_factory=list)


@dataclass
class ParsedMatch:
    file_id: str
    match_type: str
    format: str
    gender: str
    team_type: str
    teams: list[str]
    start_date: str
    season: str
    event: str | None
    venue: str | None
    venue_id: str | None
    city: str | None
    toss_winner: str | None
    toss_decision: str | None
    winner: str | None
    result_type: str
    registry: dict[str, str]
    players: dict[str, list[str]]
    innings: list[Innings]
    info: dict


def _result(outcome: dict) -> tuple[str | None, str]:
    result = outcome.get("result")
    if result == "tie":
        if outcome.get("eliminator"):
            return outcome["eliminator"], "super_over"
        if outcome.get("bowl_out"):
            return outcome["bowl_out"], "bowl_out"
        return None, "tie"
    if result == "no result":
        return None, "no_result"
    if result == "draw":
        return None, "draw"
    winner = outcome.get("winner")
    method = outcome.get("method")
    if not winner:
        return None, "other"
    if method in ("D/L", "VJD"):
        return winner, "dls"
    if method == "Awarded":
        return winner, "awarded"
    if method:
        return winner, "other"
    return winner, "normal"


def parse_match(doc: dict, file_id: str) -> ParsedMatch:
    info = doc["info"]
    fmt = FORMATS.get(info["match_type"], info["match_type"])
    ph = phases(fmt)
    winner, result_type = _result(info.get("outcome", {}))
    innings: list[Innings] = []
    for n, inn in enumerate(doc.get("innings", []), start=1):
        dels: list[Delivery] = []
        runs = wkts = legal = extras = 0
        phase_runs = [0, 0, 0]
        phase_wkts = [0, 0, 0]
        for over in inn.get("overs", []):
            o = int(over["over"])
            for b, d in enumerate(over["deliveries"], start=1):
                ex = d.get("extras") or {}
                is_legal = not ("wides" in ex or "noballs" in ex)
                r = d["runs"]
                ws = d.get("wickets") or []
                counted = [w for w in ws if w.get("kind") not in NOT_A_WICKET]
                dels.append(
                    Delivery(
                        over=o,
                        ball=b,
                        batter=d["batter"],
                        bowler=d["bowler"],
                        non_striker=d.get("non_striker"),
                        runs_batter=int(r.get("batter", 0)),
                        runs_extras=int(r.get("extras", 0)),
                        runs_total=int(r.get("total", 0)),
                        extras_kind=",".join(sorted(ex)) or None,
                        is_legal=is_legal,
                        non_boundary=bool(r.get("non_boundary", False)),
                        wicket_kind=ws[0]["kind"] if ws else None,
                        player_out=ws[0]["player_out"] if ws else None,
                        extra_wickets=ws[1:] or None,
                    )
                )
                runs += int(r.get("total", 0))
                extras += int(r.get("extras", 0))
                wkts += len(counted)
                legal += is_legal
                if ph:
                    for i, rng in enumerate(ph):
                        if o in rng:
                            phase_runs[i] += int(r.get("total", 0))
                            phase_wkts[i] += len(counted)
        pen = inn.get("penalty_runs") or {}
        runs += int(pen.get("pre", 0)) + int(pen.get("post", 0))
        target = inn.get("target") or {}
        innings.append(
            Innings(
                number=n,
                team=inn["team"],
                runs=runs,
                wickets=wkts,
                legal_balls=legal,
                extras=extras,
                target_runs=target.get("runs"),
                target_overs=target.get("overs"),
                declared=bool(inn.get("declared", False)),
                forfeited=bool(inn.get("forfeited", False)),
                super_over=bool(inn.get("super_over", False)),
                phase={
                    "pp_runs": phase_runs[0] if ph else None,
                    "pp_wkts": phase_wkts[0] if ph else None,
                    "mid_runs": phase_runs[1] if ph else None,
                    "mid_wkts": phase_wkts[1] if ph else None,
                    "death_runs": phase_runs[2] if ph else None,
                    "death_wkts": phase_wkts[2] if ph else None,
                },
                deliveries=dels,
            )
        )
    registry = info.get("registry", {})
    venue = info.get("venue")
    toss = info.get("toss") or {}
    return ParsedMatch(
        file_id=file_id,
        match_type=info["match_type"],
        format=fmt,
        gender=info.get("gender", "male"),
        team_type=info.get("team_type", "international"),
        teams=list(info["teams"]),
        start_date=info["dates"][0],
        season=str(info.get("season", info["dates"][0][:4])),
        event=(info.get("event") or {}).get("name"),
        venue=venue,
        venue_id=(registry.get("venues") or {}).get(venue) if venue else None,
        city=info.get("city"),
        toss_winner=toss.get("winner"),
        toss_decision=toss.get("decision"),
        winner=winner,
        result_type=result_type,
        registry=dict(registry.get("people") or {}),
        players={k: list(v) for k, v in (info.get("players") or {}).items()},
        innings=innings,
        info={k: v for k, v in info.items() if k != "registry"},
    )


# ---- sources ---------------------------------------------------------------------------


def iter_files(path: Path) -> Iterator[tuple[str, bytes]]:
    """Yield (file id, content) for every match JSON in a zip, a folder or a single file."""
    if path.is_dir():
        for p in sorted(path.glob("*.json")):
            yield p.stem, p.read_bytes()
    elif path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            for name in sorted(z.namelist()):
                if name.endswith(".json"):
                    yield Path(name).stem, z.read(name)
    elif path.suffix == ".json":
        yield path.stem, path.read_bytes()
    else:
        raise ValueError(f"not a zip, folder or .json file: {path}")


def download(dataset: str, dest_dir: Path) -> Path:
    """Download one Cricsheet zip into dest_dir (overwrites an older copy)."""
    if dataset not in DATASETS:
        raise ValueError(f"unknown dataset '{dataset}', choose from {', '.join(DATASETS)}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    target = dest_dir / DATASETS[dataset]
    req = urllib.request.Request(DOWNLOAD_BASE + DATASETS[dataset], headers={"User-Agent": "tusky-ingest/0.1"})
    with urllib.request.urlopen(req, timeout=120) as res, open(target, "wb") as out:
        while chunk := res.read(1 << 20):
            out.write(chunk)
    log.info("downloaded %s (%.1f MB)", target, target.stat().st_size / 1e6)
    return target


# ---- writing ---------------------------------------------------------------------------


class Importer:
    """Writes parsed matches. One transaction per match; small id caches per run."""

    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        row = conn.execute("select id from sports where code = 'cricket'").fetchone()
        if not row:
            raise RuntimeError("sport 'cricket' missing: run `npm run db:migrate` (it seeds sports)")
        self.sport_id = int(row[0])
        self.teams: dict[str, int] = {}
        self.players: dict[str, int] = {}
        self.venues: dict[str, int] = {}
        self.comps: dict[str, int] = {}

    # -- entities --

    def _team(self, name: str, gender: str) -> int:
        key = team_key(name, gender)
        if key in self.teams:
            return self.teams[key]
        alias = self.conn.execute(
            "select team_id from team_aliases where sport_id = %s and alias = %s", (self.sport_id, key)
        ).fetchone()
        if alias:
            tid = int(alias[0])
        else:
            tid = self.conn.execute(
                """insert into teams (sport_id, provider, external_id, name)
                   values (%s, %s, %s, %s)
                   on conflict (sport_id, provider, external_id) do update set updated_at = now()
                   returning id""",
                (self.sport_id, TEAM_PROVIDER, key, KNOWN_ALIASES.get(name, name)),
            ).fetchone()[0]
        if name in KNOWN_ALIASES:
            # Record the old name so other sources (CricketData, manual tools) resolve it too.
            old_key = f"{'f' if gender == 'female' else 'm'}:{normalize_name(name)}"
            self.conn.execute(
                "insert into team_aliases (sport_id, alias, team_id) values (%s, %s, %s) on conflict do nothing",
                (self.sport_id, old_key, tid),
            )
        self.teams[key] = tid
        return tid

    def _player(self, name: str, registry: dict[str, str], team_id: int | None) -> int:
        ext = registry.get(name) or f"name:{normalize_name(name)}"
        if ext in self.players:
            return self.players[ext]
        pid = self.conn.execute(
            """insert into players (sport_id, provider, external_id, name, current_team_id)
               values (%s, %s, %s, %s, %s)
               on conflict (sport_id, provider, external_id) do update set
                 name = excluded.name, updated_at = now()
               returning id""",
            (self.sport_id, SOURCE, ext, name, team_id),
        ).fetchone()[0]
        self.players[ext] = pid
        return pid

    def _venue(self, m: ParsedMatch) -> int | None:
        if not m.venue:
            return None
        ext = m.venue_id or f"name:{normalize_name(m.venue)}"
        if ext in self.venues:
            return self.venues[ext]
        vid = self.conn.execute(
            """insert into venues (sport_id, provider, external_id, name, city)
               values (%s, %s, %s, %s, %s)
               on conflict (sport_id, provider, external_id) do update set
                 name = excluded.name, city = coalesce(excluded.city, venues.city), updated_at = now()
               returning id""",
            (self.sport_id, SOURCE, ext, m.venue, m.city),
        ).fetchone()[0]
        self.venues[ext] = vid
        return vid

    def _competition(self, m: ParsedMatch) -> int:
        name = m.event or f"{m.team_type.title()} {m.format}{' (women)' if m.gender == 'female' else ''}"
        ext = f"{m.gender[0]}:{normalize_name(name)}:{m.season}"
        if ext in self.comps:
            return self.comps[ext]
        cid = self.conn.execute(
            """insert into competitions (sport_id, provider, external_id, name, season, format)
               values (%s, %s, %s, %s, %s, %s)
               on conflict (sport_id, provider, external_id) do update set updated_at = now()
               returning id""",
            (self.sport_id, SOURCE, ext, name, m.season, m.format),
        ).fetchone()[0]
        self.comps[ext] = cid
        return cid

    def _find_match(self, m: ParsedMatch, home: int, away: int) -> int | None:
        row = self.conn.execute(
            "select match_id from match_aliases where provider = %s and external_id = %s", (SOURCE, m.file_id)
        ).fetchone()
        if row:
            return int(row[0])
        # Same fixture from another provider (e.g. CricketData), same UTC date, either order.
        row = self.conn.execute(
            """select id from matches
               where sport_id = %s and provider <> 'cricsheet' and start_time::date = %s::date
                 and ((home_team_id = %s and away_team_id = %s) or (home_team_id = %s and away_team_id = %s))
               order by id limit 1""",
            (self.sport_id, m.start_date, home, away, away, home),
        ).fetchone()
        return int(row[0]) if row else None

    # -- match --

    def import_match(self, m: ParsedMatch) -> int:
        conn = self.conn
        home = self._team(m.teams[0], m.gender)
        away = self._team(m.teams[1], m.gender)
        team_ids = {m.teams[0]: home, m.teams[1]: away}
        venue_id = self._venue(m)
        comp_id = self._competition(m)
        totals = {home: 0, away: 0}
        for inn in m.innings:
            if not inn.super_over and inn.team in team_ids:
                totals[team_ids[inn.team]] += inn.runs
        has_play = any(inn.deliveries for inn in m.innings)
        start = datetime.fromisoformat(m.start_date).replace(tzinfo=timezone.utc)
        values = dict(
            competition_id=comp_id,
            venue=m.venue,
            city=m.city,
            venue_id=venue_id,
            format=m.format,
            toss_winner_team_id=team_ids.get(m.toss_winner) if m.toss_winner else None,
            toss_decision=m.toss_decision,
            winner_team_id=team_ids.get(m.winner) if m.winner else None,
            result_type=m.result_type,
            home_score=totals[home] if has_play else None,
            away_score=totals[away] if has_play else None,
            raw=json.dumps(m.info),
        )
        existing = self._find_match(m, home, away)
        if existing:
            sets = ", ".join(f"{k} = %({k})s" for k in values)
            conn.execute(
                f"update matches set {sets}, status = 'completed', updated_at = now() where id = %(id)s",
                {**values, "id": existing},
            )
            match_id = existing
        else:
            match_id = conn.execute(
                """insert into matches (sport_id, provider, external_id, home_team_id, away_team_id, start_time,
                     status, provider_status, competition_id, venue, city, venue_id, format, toss_winner_team_id,
                     toss_decision, winner_team_id, result_type, home_score, away_score, raw)
                   values (%(sport_id)s, %(provider)s, %(external_id)s, %(home)s, %(away)s, %(start)s,
                     'completed', 'cricsheet', %(competition_id)s, %(venue)s, %(city)s, %(venue_id)s, %(format)s,
                     %(toss_winner_team_id)s, %(toss_decision)s, %(winner_team_id)s, %(result_type)s,
                     %(home_score)s, %(away_score)s, %(raw)s)
                   returning id""",
                {**values, "sport_id": self.sport_id, "provider": SOURCE, "external_id": m.file_id, "home": home, "away": away, "start": start},
            ).fetchone()[0]
        conn.execute(
            "insert into match_aliases (match_id, provider, external_id) values (%s, %s, %s) on conflict do nothing",
            (match_id, SOURCE, m.file_id),
        )

        # Replace children so a corrected file fully supersedes the old import.
        conn.execute("delete from deliveries where match_id = %s", (match_id,))
        conn.execute("delete from cricket_innings where match_id = %s", (match_id,))
        conn.execute("delete from match_lineups where match_id = %s", (match_id,))

        for team, names in m.players.items():
            tid = team_ids.get(team)
            if tid is None:
                continue
            for name in names:
                pid = self._player(name, m.registry, tid)
                conn.execute(
                    """insert into match_lineups (match_id, team_id, player_id, source) values (%s, %s, %s, %s)
                       on conflict (match_id, player_id) do nothing""",
                    (match_id, tid, pid, SOURCE),
                )

        rows = []
        for inn in m.innings:
            bat = team_ids.get(inn.team)
            if bat is None:
                continue
            bowl = away if bat == home else home
            conn.execute(
                """insert into cricket_innings (match_id, innings_no, batting_team_id, bowling_team_id, runs, wickets,
                     legal_balls, extras, target_runs, target_overs, declared, forfeited, is_super_over,
                     pp_runs, pp_wkts, mid_runs, mid_wkts, death_runs, death_wkts)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (match_id, inn.number, bat, bowl, inn.runs, inn.wickets, inn.legal_balls, inn.extras, inn.target_runs,
                 inn.target_overs, inn.declared, inn.forfeited, inn.super_over, *inn.phase.values()),
            )
            for d in inn.deliveries:
                rows.append(
                    (
                        match_id,
                        inn.number,
                        d.over,
                        d.ball,
                        self._player(d.batter, m.registry, bat),
                        self._player(d.bowler, m.registry, bowl),
                        self._player(d.non_striker, m.registry, bat) if d.non_striker else None,
                        d.runs_batter,
                        d.runs_extras,
                        d.runs_total,
                        d.extras_kind,
                        d.is_legal,
                        d.non_boundary,
                        d.wicket_kind,
                        self._player(d.player_out, m.registry, bat) if d.player_out else None,
                        json.dumps(d.extra_wickets) if d.extra_wickets else None,
                    )
                )
        if rows:
            with conn.cursor() as cur, cur.copy(
                """copy deliveries (match_id, innings_no, over, ball, batter_id, bowler_id, non_striker_id,
                     runs_batter, runs_extras, runs_total, extras_kind, is_legal, non_boundary, wicket_kind,
                     player_out_id, extra_wickets) from stdin"""
            ) as cp:
                for r in rows:
                    cp.write_row(r)
        return match_id

    # -- files --

    def import_file(self, file_id: str, content: bytes, force: bool = False) -> str:
        """Returns 'imported', 'skipped' (unchanged) or 'failed'."""
        digest = hashlib.sha256(content).hexdigest()
        if not force:
            row = self.conn.execute(
                "select sha256, status from ingest_files where source = %s and file_name = %s", (SOURCE, file_id)
            ).fetchone()
            if row and row[0] == digest and row[1] == "imported":
                return "skipped"
        try:
            parsed = parse_match(json.loads(content), file_id)
            match_id = self.import_match(parsed)
            status, error = "imported", None
        except Exception as e:  # noqa: BLE001 - one bad file must not stop a bulk import
            self.conn.rollback()
            self.teams.clear()
            self.players.clear()
            self.venues.clear()
            self.comps.clear()
            match_id, status, error = None, "failed", f"{type(e).__name__}: {e}"
            log.warning("cricsheet %s failed: %s", file_id, error)
        self.conn.execute(
            """insert into ingest_files (source, file_name, sha256, match_id, status, error)
               values (%s, %s, %s, %s, %s, %s)
               on conflict (source, file_name) do update set sha256 = excluded.sha256, match_id = excluded.match_id,
                 status = excluded.status, error = excluded.error, imported_at = now()""",
            (SOURCE, file_id, digest, match_id, status, error),
        )
        self.conn.commit()
        return status


def import_path(conn: psycopg.Connection, path: Path, force: bool = False, limit: int | None = None) -> dict[str, int]:
    imp = Importer(conn)
    counts = {"imported": 0, "skipped": 0, "failed": 0}
    for i, (file_id, content) in enumerate(iter_files(path)):
        if limit is not None and i >= limit:
            break
        counts[imp.import_file(file_id, content, force=force)] += 1
        if (i + 1) % 500 == 0:
            log.info("%s: %d files processed %s", path.name, i + 1, counts)
    return counts


def read_bytes(doc: dict) -> bytes:
    """Helper for tests: serialize a match dict as Cricsheet would."""
    buf = io.StringIO()
    json.dump(doc, buf)
    return buf.getvalue().encode()
