"""Cricsheet importer: pure parsing tests plus a Postgres round trip on tusky_test."""

import copy
import json
import os
import zipfile

import pytest

from tusky_ml import db
from tusky_ml.ingest import cricsheet as cs

TEST_URL = os.getenv("TUSKY_TEST_DATABASE_URL", "postgres://tusky:tusky@localhost:5433/tusky_test")


def _ball(batter, bowler, non_striker, runs=0, extras=None, wicket=None, non_boundary=False):
    ex_total = sum((extras or {}).values())
    d = {
        "batter": batter,
        "bowler": bowler,
        "non_striker": non_striker,
        "runs": {"batter": runs, "extras": ex_total, "total": runs + ex_total},
    }
    if non_boundary:
        d["runs"]["non_boundary"] = True
    if extras:
        d["extras"] = extras
    if wicket:
        d["wickets"] = [wicket]
    return d


def make_match(winner="Kings XI Punjab", outcome=None, date="2019-04-01"):
    """A 2-over-a-side T20 in Cricsheet 1.3 shape (trimmed; real files have 20 overs)."""
    return {
        "meta": {"data_version": "1.3.0", "created": "2019-04-02", "revision": 1},
        "info": {
            "balls_per_over": 6,
            "city": "Mohali",
            "dates": [date],
            "event": {"name": "Indian Premier League", "match_number": 13},
            "gender": "male",
            "match_type": "T20",
            "outcome": outcome or {"winner": winner, "by": {"runs": 5}},
            "overs": 20,
            "players": {
                "Kings XI Punjab": ["KL Rahul", "CH Gayle"],
                "Delhi Capitals": ["S Dhawan", "PP Shaw", "K Rabada"],
            },
            "registry": {
                "people": {
                    "KL Rahul": "b61a1cf3",
                    "CH Gayle": "db584dad",
                    "S Dhawan": "0a476045",
                    "PP Shaw": "4c6b2f6b",
                    "K Rabada": "2a2e6343",
                    "M Shami": "f2d1b8f2",
                },
                "venues": {"Punjab Cricket Association IS Bindra Stadium": "6a1d4b3c"},
            },
            "season": "2019",
            "team_type": "club",
            "teams": ["Kings XI Punjab", "Delhi Capitals"],
            "toss": {"decision": "field", "winner": "Delhi Capitals"},
            "venue": "Punjab Cricket Association IS Bindra Stadium",
        },
        "innings": [
            {
                "team": "Kings XI Punjab",
                "overs": [
                    {
                        "over": 0,
                        "deliveries": [
                            _ball("KL Rahul", "K Rabada", "CH Gayle", 4),
                            _ball("KL Rahul", "K Rabada", "CH Gayle", 0, extras={"wides": 1}),
                            _ball("KL Rahul", "K Rabada", "CH Gayle", 1),
                            _ball("CH Gayle", "K Rabada", "KL Rahul", 6),
                            _ball("CH Gayle", "K Rabada", "KL Rahul", 0, wicket={"kind": "caught", "player_out": "CH Gayle", "fielders": [{"name": "PP Shaw"}]}),
                            _ball("KL Rahul", "K Rabada", "CH Gayle", 0),
                            _ball("KL Rahul", "K Rabada", "CH Gayle", 2),
                        ],
                    },
                    {
                        "over": 1,
                        "deliveries": [
                            _ball("KL Rahul", "K Rabada", "CH Gayle", 1, extras={"noballs": 1}),
                            _ball("KL Rahul", "K Rabada", "CH Gayle", 0, wicket={"kind": "retired hurt", "player_out": "KL Rahul"}),
                        ],
                    },
                ],
                "penalty_runs": {"pre": 5},
            },
            {
                "team": "Delhi Capitals",
                "target": {"overs": 20, "runs": 26},
                "overs": [
                    {
                        "over": 0,
                        "deliveries": [
                            _ball("S Dhawan", "M Shami", "PP Shaw", 4, non_boundary=True),
                            _ball("S Dhawan", "M Shami", "PP Shaw", 0, extras={"legbyes": 1}),
                            _ball("PP Shaw", "M Shami", "S Dhawan", 0, wicket={"kind": "bowled", "player_out": "PP Shaw"}),
                        ],
                    }
                ],
            },
        ],
    }


# ---- parsing --------------------------------------------------------------------------------


def test_parse_innings_aggregates():
    m = cs.parse_match(make_match(), "1175356")
    assert m.format == "T20" and m.gender == "male" and m.season == "2019"
    first, second = m.innings
    # 4 + wide 1 + 1 + 6 + 0 + 0 + 2 + (no-ball 1 + 1) + 0 = 16, plus 5 penalty runs
    assert first.runs == 21
    assert first.extras == 2
    # The wide and the no-ball are not legal deliveries.
    assert first.legal_balls == 7
    # Caught counts as a wicket, retired hurt does not.
    assert first.wickets == 1
    assert first.phase["pp_runs"] == 16 and first.phase["mid_runs"] == 0
    assert [d.ball for d in first.deliveries[:3]] == [1, 2, 3]
    assert first.deliveries[1].extras_kind == "wides" and not first.deliveries[1].is_legal
    assert second.target_runs == 26 and second.runs == 5 and second.wickets == 1
    assert second.deliveries[0].non_boundary is True


@pytest.mark.parametrize(
    "outcome, winner, rtype",
    [
        ({"winner": "Delhi Capitals", "by": {"wickets": 4}}, "Delhi Capitals", "normal"),
        ({"winner": "Delhi Capitals", "by": {"runs": 3}, "method": "D/L"}, "Delhi Capitals", "dls"),
        ({"result": "tie", "eliminator": "Kings XI Punjab"}, "Kings XI Punjab", "super_over"),
        ({"result": "tie"}, None, "tie"),
        ({"result": "no result"}, None, "no_result"),
        ({"result": "draw"}, None, "draw"),
        ({"winner": "Delhi Capitals", "method": "Awarded"}, "Delhi Capitals", "awarded"),
    ],
)
def test_parse_results(outcome, winner, rtype):
    m = cs.parse_match(make_match(outcome=outcome), "1")
    assert (m.winner, m.result_type) == (winner, rtype)


def test_team_key_normalizes_and_resolves_renames():
    assert cs.team_key("Kings XI Punjab", "male") == cs.team_key("Punjab Kings", "male") == "m:punjab kings"
    assert cs.team_key("India", "female") == "f:india"
    assert cs.team_key("St. Lucia Kings", "male") == "m:st lucia kings"


def test_iter_files_reads_zip(tmp_path):
    z = tmp_path / "x.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("1175356.json", json.dumps(make_match()))
        f.writestr("README.txt", "not a match")
    assert [fid for fid, _ in cs.iter_files(z)] == ["1175356"]


# ---- database ---------------------------------------------------------------------------------


def _cleanup(c):
    c.rollback()
    sid = c.execute("select id from sports where code = 'cricket'").fetchone()[0]
    c.execute("delete from ingest_files where source = 'cricsheet'")
    c.execute("delete from matches where sport_id = %s", (sid,))
    c.execute("delete from team_aliases where sport_id = %s", (sid,))
    c.execute("delete from players where sport_id = %s", (sid,))
    c.execute("delete from teams where sport_id = %s", (sid,))
    c.execute("delete from venues where sport_id = %s", (sid,))
    c.execute("delete from competitions where sport_id = %s", (sid,))
    c.commit()


@pytest.fixture()
def conn():
    try:
        c = db.connect(TEST_URL)
        c.execute("select 1 from deliveries limit 1")
        if not c.execute("select 1 from sports where code = 'cricket'").fetchone():
            c.execute("insert into sports (code, name) values ('cricket', 'Cricket')")
            c.commit()
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"tusky_test DB not ready ({e}); run `npm test` once to create and migrate it")
    _cleanup(c)
    yield c
    _cleanup(c)
    c.close()


def _count(c, sql, *params):
    return c.execute(sql, params).fetchone()[0]


def test_import_roundtrip_is_idempotent(conn):
    imp = cs.Importer(conn)
    content = cs.read_bytes(make_match())
    assert imp.import_file("1175356", content) == "imported"
    assert imp.import_file("1175356", content) == "skipped"

    m = conn.execute(
        """select m.id, m.format, m.result_type, m.toss_decision, m.home_score, m.away_score,
                  w.name, t.name, v.name, v.external_id, c.name, c.season
           from matches m join teams w on w.id = m.winner_team_id join teams t on t.id = m.toss_winner_team_id
           join venues v on v.id = m.venue_id join competitions c on c.id = m.competition_id
           where m.provider = 'cricsheet' and m.external_id = '1175356'"""
    ).fetchone()
    mid = m[0]
    # The winner was recorded under the old franchise name and resolves to the current one.
    assert m[1:] == ("T20", "normal", "field", 21, 5, "Punjab Kings", "Delhi Capitals",
                     "Punjab Cricket Association IS Bindra Stadium", "6a1d4b3c", "Indian Premier League", "2019")
    assert _count(conn, "select count(*) from cricket_innings where match_id = %s", mid) == 2
    assert _count(conn, "select count(*) from deliveries where match_id = %s", mid) == 12
    assert _count(conn, "select count(*) from match_lineups where match_id = %s", mid) == 5
    # Players are keyed by the Cricsheet register id.
    assert _count(conn, "select count(*) from players where provider = 'cricsheet' and external_id = 'b61a1cf3'") == 1

    # A corrected file replaces the children instead of duplicating them.
    changed = make_match()
    changed["innings"][1]["overs"][0]["deliveries"].append(_ball("S Dhawan", "M Shami", "K Rabada", 6))
    assert imp.import_file("1175356", cs.read_bytes(changed)) == "imported"
    assert _count(conn, "select count(*) from deliveries where match_id = %s", mid) == 13
    assert _count(conn, "select count(*) from matches where provider = 'cricsheet'") == 1


def test_rename_alias_merges_teams_across_seasons(conn):
    imp = cs.Importer(conn)
    old = make_match(date="2019-04-01")
    new = copy.deepcopy(old)
    new["info"]["teams"] = ["Punjab Kings", "Delhi Capitals"]
    new["info"]["players"] = {"Punjab Kings": ["KL Rahul", "CH Gayle"], "Delhi Capitals": ["S Dhawan", "PP Shaw", "K Rabada"]}
    new["innings"][0]["team"] = "Punjab Kings"
    new["info"]["outcome"] = {"winner": "Punjab Kings", "by": {"runs": 1}}
    new["info"]["dates"] = ["2022-04-01"]
    imp.import_file("1", cs.read_bytes(old))
    imp.import_file("2", cs.read_bytes(new))
    homes = conn.execute("select distinct home_team_id from matches where provider = 'cricsheet'").fetchall()
    assert len(homes) == 1
    # The old name is recorded as an alias, and no unused teams (e.g. a women's twin) are created.
    assert _count(conn, "select count(*) from team_aliases where alias = 'm:kings xi punjab' and team_id = %s", homes[0][0]) == 1
    assert _count(conn, "select count(*) from teams t where not exists (select 1 from matches m where m.home_team_id = t.id or m.away_team_id = t.id) and t.provider = 'cricket'") == 0


def test_attaches_to_existing_fixture_from_other_provider(conn):
    sid = conn.execute("select id from sports where code = 'cricket'").fetchone()[0]
    imp = cs.Importer(conn)
    home, away = imp._team("Kings XI Punjab", "male"), imp._team("Delhi Capitals", "male")
    fixture = conn.execute(
        """insert into matches (sport_id, provider, external_id, home_team_id, away_team_id, start_time, status)
           values (%s, 'cricketdata', 'abc-uuid', %s, %s, '2019-04-01T14:00:00Z', 'live') returning id""",
        (sid, away, home),
    ).fetchone()[0]
    conn.commit()
    assert imp.import_file("1175356", cs.read_bytes(make_match())) == "imported"
    assert _count(conn, "select count(*) from matches where sport_id = %s", sid) == 1
    row = conn.execute("select status, result_type from matches where id = %s", (fixture,)).fetchone()
    assert row == ("completed", "normal")
    assert _count(conn, "select count(*) from match_aliases where match_id = %s and provider = 'cricsheet'", fixture) == 1


def test_bad_file_is_recorded_not_fatal(conn):
    imp = cs.Importer(conn)
    assert imp.import_file("broken", b'{"info": {}}') == "failed"
    row = conn.execute("select status, error from ingest_files where file_name = 'broken'").fetchone()
    assert row[0] == "failed" and "KeyError" in row[1]
    assert imp.import_file("1175356", cs.read_bytes(make_match())) == "imported"
