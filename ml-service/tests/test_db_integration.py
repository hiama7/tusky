"""Round trip through Postgres using the `tusky_test` database that `npm test` creates
and migrates. Skipped when it is not reachable. Never touches the dev database."""

import os

import pytest

from tusky_ml import db, pipeline
from tusky_ml.synthetic import league

TEST_URL = os.getenv("TUSKY_TEST_DATABASE_URL", "postgres://tusky:tusky@localhost:5433/tusky_test")
PROVIDER = "pytest-ml"


def _cleanup(c):
    c.rollback()
    c.execute("delete from matches where provider = %s", (PROVIDER,))
    c.execute("delete from teams where provider = %s", (PROVIDER,))
    c.execute("delete from competitions where provider = %s", (PROVIDER,))
    c.commit()


@pytest.fixture()
def conn():
    try:
        c = db.connect(TEST_URL)
        c.execute("select 1 from predictions limit 1")
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"tusky_test DB not available ({e}); run `npm test` once to create it")
    _cleanup(c)
    yield c
    _cleanup(c)
    c.close()


def _seed(c, sport: str) -> list[int]:
    """Insert a synthetic league; returns the DB ids of its upcoming matches."""
    sid = db.sport_id(c, sport)
    matches, _ = league(sport, n_teams=12, seasons=2, seed=5)
    comp = c.execute(
        "insert into competitions (sport_id, provider, external_id, name) values (%s, %s, '1', 'Synthetic') returning id",
        (sid, PROVIDER),
    ).fetchone()[0]
    team_ids = {}
    for t in sorted(set(matches.home_team_id)):
        team_ids[t] = c.execute(
            "insert into teams (sport_id, provider, external_id, name) values (%s, %s, %s, %s) returning id",
            (sid, PROVIDER, str(t), f"Synthetic {t}"),
        ).fetchone()[0]
    upcoming = []
    for r in matches.itertuples(index=False):
        played = r.status == "completed"
        new_id = c.execute(
            """insert into matches (sport_id, competition_id, provider, external_id, home_team_id, away_team_id,
                                    start_time, status, home_score, away_score)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id""",
            (
                sid,
                comp,
                PROVIDER,
                str(r.match_id),
                team_ids[r.home_team_id],
                team_ids[r.away_team_id],
                r.start_time.to_pydatetime(),
                r.status,
                int(r.home_score) if played else None,
                int(r.away_score) if played else None,
            ),
        ).fetchone()[0]
        if not played:
            upcoming.append(new_id)
    c.commit()
    return upcoming


@pytest.mark.parametrize("sport", ["football", "basketball"])
def test_train_predict_store(conn, sport):
    upcoming = _seed(conn, sport)
    ours = {r[0] for r in conn.execute("select id from matches where provider = %s", (PROVIDER,)).fetchall()}
    matches = db.load_matches(conn, sport)
    matches = matches[matches.match_id.isin(ours)]
    assert matches["home_score"].notna().sum() > 0

    model = pipeline.train(sport, matches, min_matches=100)
    preds = pipeline.predict(model, matches, match_ids=upcoming)
    assert db.upsert_predictions(conn, sport, model.version, preds) == len(upcoming)
    # Re-running the same model version updates rows instead of duplicating them.
    db.upsert_predictions(conn, sport, model.version, preds)

    rows = conn.execute(
        "select match_id, p_home + p_draw + p_away, details from predictions where model_version = %s and match_id = any(%s)",
        (model.version, upcoming),
    ).fetchall()
    assert sorted(r[0] for r in rows) == sorted(upcoming)
    assert all(abs(r[1] - 1) < 1e-9 for r in rows)
    assert isinstance(rows[0][2], dict)
