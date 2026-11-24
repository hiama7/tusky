"""Cricket features and models on a small synthetic world (tests never need real data)."""

import os

import numpy as np
import pandas as pd
import pytest

from tusky_ml import db
from tusky_ml.cricket import features as cf
from tusky_ml.cricket import model as cm
from tusky_ml.cricket import pipeline as cp
from tusky_ml.cricket.data import CricketData


def synth(n_matches=900, n_teams=10, seed=0, upcoming=4, toss_known_for_last=False):
    """T20 world: team strength drives innings totals; 11 players per team with fixed ids."""
    rng = np.random.default_rng(seed)
    strength = rng.normal(0, 12, n_teams)
    t0 = pd.Timestamp("2020-01-01", tz="UTC")
    m_rows, i_rows, bat, bowl, lineups = [], [], [], [], []
    for k in range(n_matches + upcoming):
        a, b = rng.choice(n_teams, 2, replace=False)
        mid = k + 1
        when = t0 + pd.Timedelta(days=2 * k)
        played = k < n_matches
        toss = int(rng.choice([a, b]))
        decision = "bat" if rng.random() < 0.5 else "field"
        first = toss if decision == "bat" else (b if toss == a else a)
        second = b if first == a else a
        row = dict(match_id=mid, start_time=when, format="T20", status="completed" if played else "scheduled",
                   team1=int(a) + 1, team2=int(b) + 1, gender="m", team_type="club", venue_id=1 + k % 3,
                   city="X", toss_winner=None, toss_decision=None, winner=None, result_type=None)
        for team in (a, b):
            for j in range(11):
                lineups.append((mid, int(team) + 1, int(team) * 100 + j))
        if played or (toss_known_for_last and k == n_matches + upcoming - 1):
            row.update(toss_winner=toss + 1, toss_decision=decision)
        if played:
            r1 = max(60, int(160 + strength[first] - strength[second] + rng.normal(0, 22)))
            r2 = max(60, int(160 + strength[second] - strength[first] + rng.normal(0, 22)))
            winner = first if r1 > r2 else second
            row.update(winner=int(winner) + 1, result_type="normal")
            i_rows += [
                (mid, 1, int(first) + 1, int(second) + 1, r1, 6, 120, None, None, 50, 70, r1 - 120),
                (mid, 2, int(second) + 1, int(first) + 1, min(r2, r1 + 1) if winner == second else r2, 7, 114, r1 + 1, 20, 48, 66, 0),
            ]
            for team, runs in ((first, r1), (second, r2)):
                for j in range(7):
                    bat.append((mid, int(team) * 100 + j, runs // 7, 15, j < 6))
                opp = second if team == first else first
                for j in range(6, 11):
                    bowl.append((mid, int(opp) * 100 + j, 24, runs // 5, 1))
        m_rows.append(row)
    return CricketData(
        matches=pd.DataFrame(m_rows),
        innings=pd.DataFrame(i_rows, columns=["match_id", "innings_no", "bat_team", "bowl_team", "runs", "wickets", "legal_balls",
                                             "target_runs", "target_overs", "pp_runs", "mid_runs", "death_runs"]),
        batting=pd.DataFrame(bat, columns=["match_id", "player_id", "runs", "balls", "out"]),
        bowling=pd.DataFrame(bowl, columns=["match_id", "player_id", "balls", "runs", "wickets"]),
        lineups=pd.DataFrame(lineups, columns=["match_id", "team_id", "player_id"]),
    )


def test_features_only_use_the_past():
    d = synth(n_matches=200, upcoming=0)
    a = cf.build_features(d)
    # Flip the winner of match 150 and its innings: features up to and including it must not change.
    d2 = synth(n_matches=200, upcoming=0)
    d2.matches.loc[d2.matches.match_id == 150, "winner"] = d2.matches.loc[d2.matches.match_id == 150, "team2"].iloc[0]
    d2.innings.loc[d2.innings.match_id == 150, "runs"] = 300
    b = cf.build_features(d2)
    cols = ["elo_diff", "form10_diff", "rr_bat_diff", "h2h", "venue_first_inns", "pre_xi_bat_avg_diff"]
    upto = a.index[a.match_id == 150][0]
    pd.testing.assert_frame_equal(a.loc[:upto, cols], b.loc[:upto, cols])
    assert not np.allclose(a.loc[upto + 1 :, cols].to_numpy(), b.loc[upto + 1 :, cols].to_numpy())


def test_win_model_is_symmetric():
    feats = cf.build_features(synth(n_matches=500))
    rows = cm.win_rows(feats, "T20")
    model = cm.WinModel("T20", "post", "ensemble").fit(rows.iloc[:400])
    test = rows.iloc[400:].copy()
    p = model.predict(test)
    swapped = test.copy()
    x = cm.stage_matrix(test, "post")
    sx = cm.swap(x)
    for c in x.columns:
        swapped[c] = sx[c]
    for c in [c for c in test.columns if c.startswith("post_xi_")]:
        swapped[c] = -test[c]
    q = model.predict(swapped)
    np.testing.assert_allclose(p[:, 0], q[:, 2], atol=1e-9)
    np.testing.assert_allclose(p.sum(axis=1), 1.0)


def test_train_beats_coin_flip_and_reports():
    feats = cf.build_features(synth(n_matches=900, seed=3))
    model = cm.train(feats, "T20", min_matches=300)
    r = model.report
    assert r["post"]["candidates"][r["post"]["selected"]]["log_loss"] < r["baseline"]["log_loss"]
    assert r["first_innings"]["mae_median"] < r["first_innings"]["mae_venue_average"]
    assert 0.6 <= r["first_innings"]["coverage_10_90"] <= 0.98
    assert set(r["pre"]) >= {"candidates", "selected", "calibration_team1"}


def test_predict_pre_and_post_toss():
    d = synth(n_matches=700, upcoming=3, toss_known_for_last=True)
    feats = cf.build_features(d)
    models = {"T20": cm.train(feats, "T20", min_matches=200)}
    ids = d.matches.loc[d.matches.status == "scheduled", "match_id"].tolist()
    preds = cp.predict(models, feats, match_ids=ids).set_index("match_id")
    assert len(preds) == 3
    np.testing.assert_allclose(preds[["p_home", "p_draw", "p_away"]].sum(axis=1), 1.0)
    pre, post = preds.loc[ids[0], "details"], preds.loc[ids[-1], "details"]
    assert pre["stage"] == "pre_toss" and set(pre["first_innings"]) == {"team1_bats_first", "team2_bats_first"}
    assert post["stage"] == "post_toss" and len(post["first_innings"]) == 1
    fi = next(iter(post["first_innings"].values()))
    assert fi["p10"] < fi["p50"] < fi["p90"]
    assert preds["exp_home"].isna().all()


TEST_URL = os.getenv("TUSKY_TEST_DATABASE_URL", "postgres://tusky:tusky@localhost:5433/tusky_test")


def test_store_cricket_predictions(tmp_path):
    try:
        conn = db.connect(TEST_URL)
        conn.execute("select 1 from predictions limit 1")
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"tusky_test DB not available ({e})")
    with conn:
        sid = conn.execute("select id from sports where code = 'cricket'").fetchone()[0]
        t = [conn.execute(
            "insert into teams (sport_id, provider, external_id, name) values (%s, 'pytest-cricket', %s, %s) returning id",
            (sid, f"m:t{i}", f"T{i}"),
        ).fetchone()[0] for i in range(2)]
        mid = conn.execute(
            """insert into matches (sport_id, provider, external_id, home_team_id, away_team_id, start_time, status, format)
               values (%s, 'pytest-cricket', 'x1', %s, %s, now() + interval '1 day', 'scheduled', 'T20') returning id""",
            (sid, t[0], t[1]),
        ).fetchone()[0]
        preds = pd.DataFrame([{"match_id": mid, "p_home": 0.6, "p_draw": 0.0, "p_away": 0.4, "exp_home": None,
                               "exp_away": None, "details": {"stage": "pre_toss"}, "features": {}, "version": "cricket-t20-test"}])
        try:
            assert db.upsert_predictions(conn, "cricket", None, preds) == 1
            row = conn.execute("select model_version, exp_home_score, details->>'stage' from predictions where match_id = %s", (mid,)).fetchone()
            assert row == ("cricket-t20-test", None, "pre_toss")
        finally:
            conn.execute("delete from matches where provider = 'pytest-cricket'")
            conn.execute("delete from teams where provider = 'pytest-cricket'")
            conn.commit()
