"""TheSportsDB results (thesportsdb.com), used to fill scores that openfootball does not have yet.

Terms (read 2026-11-24, page dated 17/09/2026): the API may be used for development projects with
the free key; publishing an app needs a paid subscription; the API must not be resold. No limit on
machine-learning use was found. The free key `123` is public and SHARED by everyone, so it
rate-limits (HTTP 429) without warning. This module is therefore slow (one request every few
seconds), caches every response under data/thesportsdb/, and is resumable: re-running only fetches
what is missing. Volume is small (one request per league per matchday that lacks results).
Before this project is published as a product, replace this source with a licensed one.

It only ever FILLS a missing score on an existing fixture; a stored score is compared, never
overwritten, and the agreement rate is reported. Provenance is recorded in `matches.raw`
(`result_source`).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import psycopg

from .openfootball import LEAGUES, SAME_FIXTURE_DAYS, normalize_team

log = logging.getLogger("tusky_ml.thesportsdb")

SOURCE = "thesportsdb"
API = "https://www.thesportsdb.com/api/v1/json/123/eventsround.php?id={lid}&r={rnd}&s={season}"
# our league file -> (TheSportsDB league id, the league name its responses must carry)
TSDB_LEAGUES = {
    "en.1": (4328, "English Premier League"),
    "es.1": (4335, "Spanish La Liga"),
    "it.1": (4332, "Italian Serie A"),
    "de.1": (4331, "German Bundesliga"),
    "fr.1": (4334, "French Ligue 1"),
}
MIN_INTERVAL_S = 6.0
BACKOFF_429_S = 65.0
MAX_429_RETRIES = 3

# (league, tsdb_norm(name)) -> exact existing team name. Reviewed by hand, like openfootball's OVERRIDES.
TSDB_OVERRIDES: dict[tuple[str, str], str] = {
    ("de.1", "bayern munich"): "Bayern München",
    ("de.1", "hamburg"): "Hamburger SV",
    ("de.1", "hoffenheim"): "1899 Hoffenheim",
    ("de.1", "mainz"): "FSV Mainz 05",
    ("es.1", "athletic bilbao"): "Athletic Club",
    ("fr.1", "brest"): "Stade Brestois 29",
    ("fr.1", "paris sg"): "Paris Saint Germain",
    ("it.1", "inter milan"): "Inter",
    ("it.1", "pisa"): "AC Pisa 1909",
    ("de.1", "paderborn"): "SC Paderborn 07",
    ("es.1", "deportivo de a coruna"): "RC Deportivo La Coruña",
    ("es.1", "racing de santander"): "Real Racing Club de Santander",
    ("fr.1", "troyes"): "Estac Troyes",
}


class RateLimited(RuntimeError):
    pass


def tsdb_norm(name: str) -> str:
    """normalize_team plus 'and' dropped ("Brighton and Hove Albion" == "Brighton & Hove Albion")."""
    return " ".join(t for t in normalize_team(name).split() if t != "and")


# ---- parsing (pure) -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Event:
    league: str
    round: int
    date: str
    home: str
    away: str
    score: tuple[int, int] | None
    finished: bool
    postponed: bool


def _int(v) -> int | None:
    return int(v) if v not in (None, "") else None


def parse_events(doc: dict, league: str) -> list[Event]:
    """Events of one `eventsround` response. A response for an unknown round has `events: null`."""
    out = []
    for e in doc.get("events") or []:
        hs, as_ = _int(e.get("intHomeScore")), _int(e.get("intAwayScore"))
        out.append(
            Event(
                league=league,
                round=int(e["intRound"]),
                date=e["dateEvent"],
                home=e["strHomeTeam"],
                away=e["strAwayTeam"],
                score=(hs, as_) if hs is not None and as_ is not None else None,
                finished=e.get("strStatus") in ("FT", "AET", "PEN"),
                postponed=str(e.get("strPostponed", "no")).lower() == "yes",
            )
        )
    return out


# ---- fetching (slow, cached, resumable) -----------------------------------------------------------


def http_get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "tusky-ingest/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise RateLimited(url) from e
        raise


def season_label(start: datetime) -> str:
    y = start.year if start.month >= 7 else start.year - 1
    return f"{y}-{y + 1}"


def fetch_round(
    league: str, rnd: int, season: str, cache_dir: Path, refresh: bool = False,
    get: Callable[[str], dict] = http_get_json, sleep: Callable[[float], None] = time.sleep,
) -> tuple[dict, bool]:
    """Returns (response, fetched_from_network). Cached responses never touch the network."""
    path = cache_dir / league / f"{season}-r{rnd:02d}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8")), False
    lid, expected = TSDB_LEAGUES[league]
    url = API.format(lid=lid, rnd=rnd, season=season)
    for attempt in range(MAX_429_RETRIES + 1):
        try:
            doc = get(url)
            break
        except RateLimited:
            if attempt == MAX_429_RETRIES:
                raise
            log.warning("429 from thesportsdb (shared key); waiting %.0fs", BACKOFF_429_S)
            sleep(BACKOFF_429_S)
    names = {e.get("strLeague") for e in doc.get("events") or []}
    if names and names != {expected}:
        raise RuntimeError(f"{league} round {rnd}: expected league '{expected}', got {names}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc), encoding="utf-8")
    return doc, True


# ---- applying -----------------------------------------------------------------------------------------


@dataclass
class Report:
    events: int = 0
    filled: int = 0
    compared: int = 0
    same_score: int = 0
    not_finished: int = 0
    unmatched_teams: set[str] = field(default_factory=set)
    no_fixture: list[str] = field(default_factory=list)
    mismatches: list[str] = field(default_factory=list)
    per_league: dict[str, Counter] = field(default_factory=dict)


class Filler:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self.sport_id = int(conn.execute("select id from sports where code = 'football'").fetchone()[0])
        self.comp = {lg: self._comp_id(v[0]) for lg, v in LEAGUES.items()}
        self.names = dict(conn.execute("select id, name from teams where sport_id = %s", (self.sport_id,)).fetchall())
        self.by_norm: dict[str, list[int]] = {}
        for tid, name in self.names.items():
            self.by_norm.setdefault(tsdb_norm(name), []).append(tid)
        self.alias = dict(conn.execute("select alias, team_id from team_aliases where sport_id = %s and alias like 'of:%%'", (self.sport_id,)).fetchall())

    def _comp_id(self, ext: str) -> int | None:
        row = self.conn.execute(
            "select id from competitions where sport_id = %s and provider = 'api-sports' and external_id = %s", (self.sport_id, ext)
        ).fetchone()
        return int(row[0]) if row else None

    def team(self, league: str, name: str) -> int | None:
        key = tsdb_norm(name)
        wanted = TSDB_OVERRIDES.get((league, key))
        if wanted:
            hit = [t for t, n in self.names.items() if n == wanted]
            return hit[0] if len(hit) == 1 else None
        for alias in (f"of:{league}:{key}", f"of:{league}:{normalize_team(name)}"):
            if alias in self.alias:
                return self.alias[alias]
        cands = self.by_norm.get(key, [])
        return cands[0] if len(cands) == 1 else None

    def _fixture(self, league: str, home: int, away: int, date: str) -> tuple[int, int | None, int | None] | None:
        day = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
        row = self.conn.execute(
            """select id, home_score, away_score from matches
               where sport_id = %s and home_team_id = %s and away_team_id = %s and competition_id = %s
                 and start_time between %s and %s
               order by abs(extract(epoch from start_time - %s)) limit 1""",
            (self.sport_id, home, away, self.comp[league], day - timedelta(days=SAME_FIXTURE_DAYS), day + timedelta(days=SAME_FIXTURE_DAYS), day),
        ).fetchone()
        return (int(row[0]), row[1], row[2]) if row else None

    def apply(self, events: list[Event], report: Report | None = None) -> Report:
        rep = report or Report()
        for ev in events:
            lg = rep.per_league.setdefault(ev.league, Counter())
            rep.events += 1
            if not ev.finished or ev.postponed or ev.score is None:
                rep.not_finished += 1
                continue
            h, a = self.team(ev.league, ev.home), self.team(ev.league, ev.away)
            if h is None or a is None:
                rep.unmatched_teams.update(n for n, t in ((f"{ev.league} {ev.home}", h), (f"{ev.league} {ev.away}", a)) if t is None)
                lg["unmatched team"] += 1
                continue
            fx = self._fixture(ev.league, h, a, ev.date)
            if fx is None:
                rep.no_fixture.append(f"{ev.date} {ev.home} - {ev.away}")
                lg["no fixture"] += 1
                continue
            mid, hs, as_ = fx
            if hs is not None:
                rep.compared += 1
                if (hs, as_) == ev.score:
                    rep.same_score += 1
                    lg["agrees"] += 1
                else:
                    rep.mismatches.append(f"{ev.date} {ev.home} {ev.score[0]}-{ev.score[1]} {ev.away} vs stored {hs}-{as_}")
                    lg["differs"] += 1
                continue
            self.conn.execute(
                """update matches set home_score = %s, away_score = %s, status = 'completed', provider_status = 'FT',
                       raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('result_source', %s::text), updated_at = now()
                   where id = %s and home_score is null""",
                (ev.score[0], ev.score[1], SOURCE, mid),
            )
            rep.filled += 1
            lg["filled"] += 1
        self.conn.commit()
        return rep


def needed_rounds(conn: psycopg.Connection, since: datetime | None = None) -> dict[str, dict[str, list[int]]]:
    """{season label: {league: matchdays}} for matches that still lack results (parsed from
    openfootball's round label). Each league also gets the matchday before its first missing one,
    which has trusted scores and is used to validate this source. Seasons are kept apart because
    matchday numbers repeat from season to season. Only fixtures since `since` (default: the last
    200 days) are considered."""
    since = since or datetime.now(timezone.utc) - timedelta(days=200)
    inv = {ext: lg for lg, (ext, _) in LEAGUES.items()}
    rows = conn.execute(
        r"""select c.external_id, (regexp_match(m.raw->>'round', '(\d+)'))[1]::int, m.start_time
           from matches m join competitions c on c.id = m.competition_id
           where m.provider = 'openfootball' and m.provider_status = 'NR' and m.start_time >= %s
           order by m.start_time""",
        (since,),
    ).fetchall()
    out: dict[str, dict[str, set[int]]] = {}
    for ext, rnd, start in rows:
        if rnd is not None and ext in inv:
            out.setdefault(season_label(start), {}).setdefault(inv[ext], set()).add(int(rnd))
    result: dict[str, dict[str, list[int]]] = {}
    for season, leagues in sorted(out.items()):
        for lg, rs in leagues.items():
            ordered = sorted(rs)
            if ordered[0] > 1:
                ordered.insert(0, ordered[0] - 1)
            result.setdefault(season, {})[lg] = ordered
    return result


def fill(conn: psycopg.Connection, cache_dir: Path, refresh: bool = False, only: list[str] | None = None,
         get: Callable[[str], dict] = http_get_json, sleep: Callable[[float], None] = time.sleep, log_fn=print) -> Report:
    plan = needed_rounds(conn)
    filler = Filler(conn)
    report = Report()
    fetched = 0
    for season, leagues in plan.items():
        for lg, rs in leagues.items():
            if only and lg not in only:
                continue
            for rnd in rs:
                doc, from_net = fetch_round(lg, rnd, season, cache_dir, refresh, get, sleep)
                if from_net:
                    fetched += 1
                    conn.execute(
                        """insert into ingest_files (source, file_name, sha256, status) values (%s, %s, %s, 'imported')
                           on conflict (source, file_name) do update set sha256 = excluded.sha256, imported_at = now()""",
                        (SOURCE, f"{lg}/{season}-r{rnd:02d}", hashlib.sha256(json.dumps(doc, sort_keys=True).encode()).hexdigest()),
                    )
                    conn.commit()
                    log_fn(f"  fetched {season} {lg} round {rnd} ({len(doc.get('events') or [])} events)")
                    sleep(MIN_INTERVAL_S)
                filler.apply(parse_events(doc, lg), report)
    log_fn(f"  {fetched} requests made, the rest came from the cache")
    return report
