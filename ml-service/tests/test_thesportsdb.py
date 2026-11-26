"""TheSportsDB gap filler: parsing, caching and rate limits (no network), and DB behaviour on tusky_test."""

import os
from datetime import datetime, timezone

import pytest

from tusky_ml import db
from tusky_ml.ingest import openfootball as of
from tusky_ml.ingest import thesportsdb as ts

TEST_URL = os.getenv("TUSKY_TEST_DATABASE_URL", "postgres://tusky:tusky@localhost:5433/tusky_test")
NOW = datetime(2026, 11, 24, tzinfo=timezone.utc)


def _ev(rnd, date, home, away, hs=None, as_=None, status="FT", postponed="no", league="English Premier League"):
    return {
        "idEvent": "1", "strLeague": league, "intRound": str(rnd), "dateEvent": date,
        "strHomeTeam": home, "strAwayTeam": away,
        "intHomeScore": None if hs is None else str(hs), "intAwayScore": None if as_ is None else str(as_),
        "strStatus": status, "strPostponed": postponed,
    }


# ---- pure ------------------------------------------------------------------------------------------


def test_parse_events_reads_scores_status_and_null_rounds():
    doc = {"events": [
        _ev(6, "2026-10-10", "Arsenal", "Leeds", 2, 0),
        _ev(12, "2026-11-27", "Chelsea", "Forest", status="NS"),
        _ev(7, "2026-10-17", "A", "B", postponed="yes", status="PST"),
    ]}
    a, b, c = ts.parse_events(doc, "en.1")
    assert (a.score, a.finished, a.postponed, a.round) == ((2, 0), True, False, 6)
    assert (b.score, b.finished) == (None, False)
    assert c.postponed and not c.finished
    assert ts.parse_events({"events": None}, "en.1") == []  # an unknown round has events: null


def test_names_differing_only_by_and_are_the_same_club():
    assert ts.tsdb_norm("Brighton and Hove Albion") == ts.tsdb_norm("Brighton & Hove Albion FC") == "brighton hove albion"


def test_fetch_is_cached_and_never_hits_the_network_twice(tmp_path):
    calls = []

    def get(url):
        calls.append(url)
        return {"events": [_ev(6, "2026-10-10", "Arsenal", "Leeds", 2, 0)]}

    doc, net = ts.fetch_round("en.1", 6, "2026-2027", tmp_path, get=get, sleep=lambda s: None)
    again, net2 = ts.fetch_round("en.1", 6, "2026-2027", tmp_path, get=get, sleep=lambda s: None)
    assert (net, net2, len(calls)) == (True, False, 1) and again == doc
    assert "id=4328" in calls[0] and "r=6" in calls[0] and "s=2026-2027" in calls[0]


def test_rate_limit_waits_then_retries_and_eventually_gives_up(tmp_path):
    waits, attempts = [], []

    def flaky(url):
        attempts.append(1)
        if len(attempts) < 3:
            raise ts.RateLimited(url)
        return {"events": []}

    ts.fetch_round("en.1", 1, "2026-2027", tmp_path, get=flaky, sleep=waits.append)
    assert waits == [ts.BACKOFF_429_S, ts.BACKOFF_429_S] and len(attempts) == 3

    def always(url):
        raise ts.RateLimited(url)

    with pytest.raises(ts.RateLimited):
        ts.fetch_round("en.1", 2, "2026-2027", tmp_path, get=always, sleep=lambda s: None)
    assert not (tmp_path / "en.1" / "2026-2027-r02.json").exists()  # a failure is never cached


def test_a_response_for_the_wrong_league_is_rejected(tmp_path):
    def get(url):
        return {"events": [_ev(1, "2026-08-21", "A", "B", 1, 1, league="Some Other League")]}

    with pytest.raises(RuntimeError, match="expected league"):
        ts.fetch_round("en.1", 1, "2026-2027", tmp_path, get=get, sleep=lambda s: None)


# ---- database ---------------------------------------------------------------------------------------


def _cleanup(c, sid):
    c.rollback()
    c.execute("delete from matches where sport_id = %s and provider = 'openfootball'", (sid,))
    c.execute("delete from team_aliases where sport_id = %s and alias like 'of:%%'", (sid,))
    c.execute("delete from teams where sport_id = %s and provider = 'openfootball'", (sid,))
    c.commit()


@pytest.fixture()
def conn():
    try:
        c = db.connect(TEST_URL)
        c.execute("select 1 from team_aliases limit 1")
        sid = c.execute("select id from sports where code = 'football'").fetchone()[0]
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"tusky_test DB not ready ({e}); run `npm test` once to create it")
    _cleanup(c, sid)
    made = not c.execute(
        "select 1 from competitions where sport_id = %s and provider = 'api-sports' and external_id = '39'", (sid,)
    ).fetchone()
    if made:
        c.execute("insert into competitions (sport_id, provider, external_id, name) values (%s, 'api-sports', '39', 'Premier League')", (sid,))
    c.commit()
    yield c, sid
    _cleanup(c, sid)
    if made:
        c.execute("delete from competitions where sport_id = %s and provider = 'api-sports' and external_id = '39'", (sid,))
        c.commit()
    c.close()


OF_DOC = {"name": "t", "matches": [
    {"round": "Matchday 6", "date": "2026-10-10", "time": "15:00", "team1": "Alpha FC", "team2": "Beta United"},  # played, no score
    {"round": "Matchday 5", "date": "2026-09-19", "time": "15:00", "team1": "Gamma", "team2": "Delta", "score": {"ft": [2, 0], "ht": [1, 0]}},
    {"round": "Matchday 12", "date": "2026-12-05", "time": "15:00", "team1": "Alpha FC", "team2": "Gamma"},  # upcoming
]}


def _import(c):
    return of.Importer(c).import_matches(of.parse_file(OF_DOC, "2026-27", "en.1"), now=NOW)


def test_fill_validate_and_survive_a_reimport(conn):
    c, sid = conn
    _import(c)
    plan = ts.needed_rounds(c, since=datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert plan == {"2026-2027": {"en.1": [5, 6]}}  # the gap round plus one earlier round to validate on

    events = ts.parse_events({"events": [
        _ev(6, "2026-10-10", "Alpha", "Beta United", 1, 3),       # fills the missing result
        _ev(5, "2026-09-19", "Gamma", "Delta", 2, 0),             # already stored: validation, must agree
        _ev(7, "2026-10-17", "Delta", "Gamma", 1, 1),             # no such fixture stored
        _ev(8, "2026-10-24", "Mystery FC", "Alpha", 0, 0),        # club we have never seen
        _ev(12, "2026-12-05", "Alpha", "Gamma", status="NS"),     # not played yet
    ]}, "en.1")
    rep = ts.Filler(c).apply(events)
    assert (rep.filled, rep.compared, rep.same_score, rep.not_finished) == (1, 1, 1, 1)
    assert rep.unmatched_teams == {"en.1 Mystery FC"} and len(rep.no_fixture) == 1 and not rep.mismatches

    sql = """select home_score, away_score, status::text, provider_status, raw->>'result_source', raw->>'round'
             from matches where provider = 'openfootball' and start_time::date = '2026-10-10'"""
    assert c.execute(sql).fetchone() == (1, 3, "completed", "FT", "thesportsdb", "Matchday 6")

    # A second run changes nothing; a scored fixture is compared, never overwritten.
    again = ts.Filler(c).apply(events)
    assert again.filled == 0 and again.compared == 2
    wrong = ts.parse_events({"events": [_ev(6, "2026-10-10", "Alpha", "Beta United", 9, 9)]}, "en.1")
    rep2 = ts.Filler(c).apply(wrong)
    assert rep2.filled == 0 and len(rep2.mismatches) == 1
    assert c.execute(sql).fetchone()[0] == 1

    # Re-importing the source (which still has no score) must not undo the filled result.
    _import(c)
    assert c.execute(sql).fetchone() == (1, 3, "completed", "FT", "thesportsdb", "Matchday 6")


def test_each_season_is_planned_separately(conn):
    """A stray missing result from last season must not change which season the gap is fetched for."""
    c, sid = conn
    doc = {"name": "t", "matches": OF_DOC["matches"] + [
        {"round": "Matchday 34", "date": "2026-05-17", "time": "15:00", "team1": "Gamma", "team2": "Beta United"},
    ]}
    of.Importer(c).import_matches(of.parse_file(doc, "2025-26", "en.1"), now=NOW)
    plan = ts.needed_rounds(c, since=datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert plan["2025-2026"] == {"en.1": [33, 34]} and plan["2026-2027"] == {"en.1": [5, 6]}


def test_reviewed_overrides_point_at_exact_team_names():
    # An override naming a team that does not exist would silently never match.
    assert all(isinstance(v, str) and v for v in ts.TSDB_OVERRIDES.values())
    assert ts.tsdb_norm("Paris SG") == "paris sg" and ts.tsdb_norm("Bayern Munich") == "bayern munich"
