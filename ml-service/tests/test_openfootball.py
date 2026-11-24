"""openfootball importer: parsing, name normalization, vote learning, and a Postgres round trip."""

import os
from collections import Counter
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pytest

from tusky_ml import db
from tusky_ml.ingest import openfootball as of

TEST_URL = os.getenv("TUSKY_TEST_DATABASE_URL", "postgres://tusky:tusky@localhost:5433/tusky_test")


# ---- pure ---------------------------------------------------------------------------------------


def test_parse_score_forms():
    assert of.parse_score({"ft": [4, 2], "ht": [1, 0]}) == (4, 2)
    assert of.parse_score([1, 1]) == (1, 1)  # bare list = full-time draw
    assert of.parse_score(None) is None
    assert of.parse_score({}) is None


def test_kickoff_is_local_time_converted_to_utc():
    # Premier League opener 2025-08-15, printed 20:00 UK time = 19:00 UTC (BST).
    assert of.kickoff_utc("2025-08-15", "20:00", "Europe/London") == datetime(2025, 8, 15, 19, 0, tzinfo=timezone.utc)
    # Winter: no offset. Missing time falls back to 15:00 local.
    assert of.kickoff_utc("2026-01-10", "12:30", "Europe/London").hour == 12
    assert of.kickoff_utc("2026-01-10", None, "Europe/Berlin") == datetime(2026, 1, 10, 14, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "a, b",
    [
        ("AFC Bournemouth", "Bournemouth"),
        ("FC Bayern München", "Bayern Munchen"),
        ("1. FC Köln", "Koln"),
        ("Brighton & Hove Albion FC", "Brighton Hove Albion"),
        ("Sunderland AFC", "Sunderland"),
    ],
)
def test_normalize_team(a, b):
    assert of.normalize_team(a) == of.normalize_team(b)


def test_votes_pick_the_clear_winner_only():
    assert of.pick(Counter({7: 12, 9: 2})) == 7
    assert of.pick(Counter({7: 12, 9: 6})) is None  # runner-up too close
    assert of.pick(Counter({7: 3})) is None  # too few votes
    assert of.pick(Counter()) is None


# ---- database ---------------------------------------------------------------------------------------


NAMES_DB = ["Alpha", "Man City", "Cobra", "Delta", "Echo", "Foxtrot"]
NAMES_OF = ["Alpha FC", "Manchester City FC", "Cobra AFC", "Delta", "Echo CF", "Foxtrot"]


def _league(seed=1):
    """30 matches (double round robin of 6), 3 days apart so score votes can't collide."""
    rng = np.random.default_rng(seed)
    pairs = [(h, a) for h in range(6) for a in range(6) if h != a]
    return [(date(2023, 9, 1) + timedelta(days=3 * i), h, a, int(rng.integers(0, 5)), int(rng.integers(0, 5))) for i, (h, a) in enumerate(pairs)]


def _doc(rows, names):
    return {
        "name": "test",
        "matches": [
            {"round": "Matchday 1", "date": d.isoformat(), "time": "15:00", "team1": names[h], "team2": names[a],
             **({"score": {"ft": [hs, as_], "ht": [0, 0]}} if hs is not None else {})}
            for d, h, a, hs, as_ in rows
        ],
    }


def _cleanup(c):
    c.rollback()
    sid = c.execute("select id from sports where code = 'football'").fetchone()[0]
    c.execute("delete from matches where sport_id = %s and (external_id like 'pytest-of-%%' or provider = 'openfootball')", (sid,))
    c.execute("delete from team_aliases where sport_id = %s and alias like 'of:%%'", (sid,))
    c.execute("delete from teams where sport_id = %s and (external_id like 'pytest-of-%%' or provider = 'openfootball')", (sid,))
    c.commit()


@pytest.fixture()
def conn():
    try:
        c = db.connect(TEST_URL)
        c.execute("select 1 from team_aliases limit 1")
        sid = c.execute("select id from sports where code = 'football'").fetchone()[0]
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"tusky_test DB not ready ({e}); run `npm test` once to create it")
    _cleanup(c)
    created = False
    if not c.execute("select 1 from competitions where sport_id = %s and provider = 'api-sports' and external_id = '39'", (sid,)).fetchone():
        c.execute("insert into competitions (sport_id, provider, external_id, name) values (%s, 'api-sports', '39', 'Premier League')", (sid,))
        created = True
    c.commit()
    yield c, sid
    _cleanup(c)
    if created:
        c.execute("delete from competitions where sport_id = %s and provider = 'api-sports' and external_id = '39'", (sid,))
        c.commit()
    c.close()


def _seed_history(c, sid, rows):
    comp = c.execute("select id from competitions where sport_id = %s and provider = 'api-sports' and external_id = '39'", (sid,)).fetchone()[0]
    ids = [c.execute("insert into teams (sport_id, provider, external_id, name) values (%s, 'api-sports', %s, %s) returning id",
                     (sid, f"pytest-of-{i}", n)).fetchone()[0] for i, n in enumerate(NAMES_DB)]
    for i, (d, h, a, hs, as_) in enumerate(rows):
        c.execute(
            """insert into matches (sport_id, competition_id, provider, external_id, home_team_id, away_team_id, start_time, status, home_score, away_score)
               values (%s, %s, 'api-sports', %s, %s, %s, %s, 'completed', %s, %s)""",
            (sid, comp, f"pytest-of-m{i}", ids[h], ids[a], datetime(d.year, d.month, d.day, 15, tzinfo=timezone.utc), hs, as_),
        )
    c.commit()
    return ids


def test_overlap_teams_learned_by_score_votes_and_new_data_stored(conn):
    c, sid = conn
    rows = _league()
    ids = _seed_history(c, sid, rows)

    # 1. Overlap season: names differ ("Manchester City FC" vs "Man City"), only scores can link them.
    imp = of.Importer(c)
    res = imp.import_matches(of.parse_file(_doc(rows, NAMES_OF), "2023-24", "en.1"), now=datetime(2026, 11, 24, tzinfo=timezone.utc))
    assert res.overlap_pairs == 30 and res.overlap_same_score == 30 and not res.mismatches
    assert res.new_teams == []
    assert c.execute("select team_id from team_aliases where alias = 'of:en.1:manchester city'").fetchone()[0] == ids[1]
    assert c.execute("select count(*) from matches where provider = 'openfootball'").fetchone()[0] == 0  # nothing duplicated

    # 2. A later season: a new club, a scored match, a played-but-unscored one (source lag), an upcoming one.
    later = [
        (date(2026, 9, 12), 0, 1, 2, 1),
        (date(2026, 11, 1), 2, 3, None, None),
        (date(2026, 12, 5), 4, 5, None, None),
    ]
    names = NAMES_OF + ["Newcomers AFC"]
    later.append((date(2026, 12, 12), 6, 0, None, None))
    doc = _doc(later, names)
    now = datetime(2026, 11, 24, 12, tzinfo=timezone.utc)
    res = of.Importer(c).import_matches(of.parse_file(doc, "2026-27", "en.1"), now=now)
    counts = res.seasons["2026-27/en.1"]
    assert counts["stored scored"] == 1 and counts["stored upcoming"] == 2
    assert counts["stored, result missing in source"] == 1
    assert res.new_teams == ["en.1 Newcomers AFC"]

    stored = c.execute("select status::text, home_score, provider_status from matches where provider = 'openfootball' order by start_time").fetchall()
    assert stored == [("completed", 2, "FT"), ("completed", None, "NR"), ("scheduled", None, "NS"), ("scheduled", None, "NS")]

    # 3. Idempotent: same file again changes nothing.
    again = of.Importer(c).import_matches(of.parse_file(doc, "2026-27", "en.1"), now=now)
    assert c.execute("select count(*) from matches where provider = 'openfootball'").fetchone()[0] == 4
    assert again.new_teams == []

    # 4. A result arriving later updates the stored upcoming match instead of duplicating it.
    later[2] = (date(2026, 12, 5), 4, 5, 3, 3)
    after = datetime(2026, 12, 6, tzinfo=timezone.utc)
    of.Importer(c).import_matches(of.parse_file(_doc(later, names), "2026-27", "en.1"), now=after)
    row = c.execute("select status::text, home_score, away_score from matches where provider = 'openfootball' and home_team_id = %s", (ids[4],)).fetchone()
    assert row == ("completed", 3, 3)
    assert c.execute("select count(*) from matches where provider = 'openfootball'").fetchone()[0] == 4


def test_score_disagreement_is_reported_not_overwritten(conn):
    c, sid = conn
    rows = _league(seed=2)
    ids = _seed_history(c, sid, rows)
    wrong = list(rows)
    d, h, a, hs, as_ = wrong[5]
    wrong[5] = (d, h, a, hs + 1, as_)
    res = of.Importer(c).import_matches(of.parse_file(_doc(wrong, NAMES_OF), "2023-24", "en.1"), now=datetime(2026, 11, 24, tzinfo=timezone.utc))
    # One of 30 disagrees: it is reported, and the stored (API-Sports) score is left untouched.
    assert (res.overlap_pairs, res.overlap_same_score, len(res.mismatches)) == (30, 29, 1)
    kept = c.execute("select home_score, away_score from matches where home_team_id = %s and away_team_id = %s", (ids[h], ids[a])).fetchone()
    assert kept == (hs, as_)
    assert c.execute("select count(*) from matches where provider = 'openfootball'").fetchone()[0] == 0


def test_similar_names_flags_lookalikes_but_not_exact_or_unrelated():
    existing = ["Estac Troyes", "Paris Saint Germain", "Lyon"]
    assert of.similar_names("ES Troyes AC", existing) == ["Estac Troyes"]
    assert of.similar_names("Paris FC", existing) == ["Paris Saint Germain"]  # warned about, never auto-merged
    assert of.similar_names("Lyon", existing) == []


def test_override_maps_a_renamed_club_to_the_existing_team(conn, monkeypatch):
    c, sid = conn
    ids = _seed_history(c, sid, _league(seed=3))
    monkeypatch.setitem(of.OVERRIDES, ("en.1", "foxtrot united"), "Foxtrot")
    doc = _doc([(date(2026, 12, 5), 5, 0, None, None)], NAMES_OF[:5] + ["Foxtrot United"])
    res = of.Importer(c).import_matches(of.parse_file(doc, "2026-27", "en.1"), now=datetime(2026, 11, 24, tzinfo=timezone.utc))
    assert res.new_teams == []
    assert c.execute("select team_id from team_aliases where alias = 'of:en.1:foxtrot united'").fetchone()[0] == ids[5]
    assert c.execute("select home_team_id from matches where provider = 'openfootball'").fetchone()[0] == ids[5]


def test_source_without_a_score_never_duplicates_an_existing_match_and_fills_a_missing_result(conn):
    c, sid = conn
    rows = _league(seed=4)
    ids = _seed_history(c, sid, rows)
    # The source lags for match 7 (no score); the DB row for match 9 has no result yet but the source has it.
    c.execute("update matches set home_score = null, away_score = null, status = 'scheduled' where external_id = 'pytest-of-m9'")
    c.commit()
    lagging = list(rows)
    d, h, a, _, _ = lagging[7]
    lagging[7] = (d, h, a, None, None)
    res = of.Importer(c).import_matches(of.parse_file(_doc(lagging, NAMES_OF), "2023-24", "en.1"), now=datetime(2026, 11, 24, tzinfo=timezone.utc))
    assert c.execute("select count(*) from matches where provider = 'openfootball'").fetchone()[0] == 0  # no duplicate rows
    assert c.execute("select home_score, status::text from matches where external_id = 'pytest-of-m7'").fetchone()[0] is not None  # DB score untouched
    filled = c.execute("select home_score, away_score, status::text from matches where external_id = 'pytest-of-m9'").fetchone()
    assert filled == (rows[9][3], rows[9][4], "completed")
    assert res.seasons["2023-24/en.1"]["result added to existing match"] == 1
    assert res.overlap_pairs == 28 and res.overlap_same_score == 28


def test_postponed_game_is_still_the_same_fixture_but_90_days_away_is_not(conn):
    c, sid = conn
    rows = _league(seed=6)
    _seed_history(c, sid, rows)
    # Teams whose names normalize equal to the DB names (no score votes needed with a one-match file).
    d, h, a, _, _ = next(r for r in rows if r[1] != 1 and r[2] != 1)
    now = datetime(2026, 11, 24, tzinfo=timezone.utc)

    moved = [(d - timedelta(days=2), h, a, None, None)]  # the source lists the original date, no result yet
    res = of.Importer(c).import_matches(of.parse_file(_doc(moved, NAMES_OF), "2023-24", "en.1"), now=now)
    assert res.seasons["2023-24/en.1"]["already in db"] == 1
    assert c.execute("select count(*) from matches where provider = 'openfootball'").fetchone()[0] == 0

    far = [(d + timedelta(days=90), h, a, None, None)]
    of.Importer(c).import_matches(of.parse_file(_doc(far, NAMES_OF), "2023-24", "en.1"), now=now)
    assert c.execute("select count(*) from matches where provider = 'openfootball'").fetchone()[0] == 1
