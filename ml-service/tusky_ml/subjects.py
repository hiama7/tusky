"""Glue between the promotion engine (promote.py) and the real sports pipelines."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from . import db, metrics, pipeline, tune
from .features import CONFIGS, build_features, trainable
from .promote import Subject

TARGETS = ("football", "basketball", "cricket-T20", "cricket-ODI", "cricket-Test")


def key_for(target: str) -> str:
    return target.replace("cricket-", "cricket/") if target.startswith("cricket-") else target


def _empty_dates() -> pd.Series:
    return pd.Series([], dtype="datetime64[ns, UTC]")


def team_subject(conn, artifacts_dir: Path, sport: str, min_matches: int, matches: pd.DataFrame | None = None) -> Subject:
    """`matches` overrides the database load (used by tests)."""
    matches = db.load_matches(conn, sport) if matches is None else matches
    champion = pipeline.load(artifacts_dir, sport)
    three_way = sport == "football"
    cache: dict[int, pd.DataFrame] = {}

    def rows_for(cfg) -> pd.DataFrame:
        if id(cfg) not in cache:
            cache[id(cfg)] = trainable(build_features(matches, cfg), cfg).reset_index(drop=True)
        return cache[id(cfg)]

    def probs(frame: pd.DataFrame) -> np.ndarray:
        p = frame[["p_home", "p_draw", "p_away"]].to_numpy()
        if three_way:
            return p
        two = p[:, [0, 2]]
        return two / two.sum(axis=1, keepdims=True)

    def train(m: pd.DataFrame):
        tune.apply_saved(artifacts_dir, sport)
        return pipeline.train(sport, m, min_matches=min_matches)

    if champion is None:
        return Subject(sport, 3 if three_way else 2, _empty_dates(), np.array([], dtype=int), pd.NaT, None, None, None,
                       lambda: train(matches), lambda model, d: pipeline.save(model, d))

    rows0 = rows_for(getattr(champion, "cfg", None) or CONFIGS[sport])
    y = metrics.outcome_index(rows0["home_score"].to_numpy(), rows0["away_score"].to_numpy())
    if not three_way:
        y = np.where(y == 0, 0, 1)

    def challenger_probs(model, window: np.ndarray) -> np.ndarray:
        ids = rows0.iloc[window]["match_id"].to_numpy()
        rows_c = rows_for(getattr(model, "cfg", None) or CONFIGS[sport]).set_index("match_id").loc[ids].reset_index()
        return probs(model.predictor.predict(rows_c))

    try:
        reference = float(champion.report["validation"][champion.kind]["log_loss"])
    except (KeyError, TypeError):
        reference = None
    return Subject(
        sport, 3 if three_way else 2, rows0["start_time"], y, pd.Timestamp(champion.report["data_through"]),
        lambda w: probs(champion.predictor.predict(rows0.iloc[w])),
        lambda cutoff: train(matches[matches["start_time"] < cutoff]),
        challenger_probs,
        lambda: train(matches),
        lambda model, d: pipeline.save(model, d),
        reference,
    )


def cricket_subject(feats: pd.DataFrame, artifacts_dir: Path, fmt: str, min_matches: int) -> Subject:
    from .cricket import model as cmodel
    from .cricket import pipeline as cp

    champion = cp.load(artifacts_dir, fmt)
    three_way = fmt == "Test"
    key = f"cricket/{fmt}"
    rows = cmodel.win_rows(feats, fmt).reset_index(drop=True)
    y = cmodel._labels_idx(rows) if three_way else np.where(rows["label"].to_numpy() == 1.0, 0, 1)

    def probs(model, window: np.ndarray) -> np.ndarray:
        p = model.post.predict(rows.iloc[window])
        if three_way:
            return p
        two = p[:, [0, 2]]
        return two / two.sum(axis=1, keepdims=True)

    def train(f: pd.DataFrame):
        return cmodel.train(f, fmt, min_matches=min_matches)

    save = lambda model, d: cp.save(model, d)  # noqa: E731
    if champion is None:
        return Subject(key, 3 if three_way else 2, _empty_dates(), np.array([], dtype=int), pd.NaT, None, None, None, lambda: train(feats), save)

    try:
        post = champion.report["post"]
        reference = float(post["candidates"][post["selected"]]["log_loss"])
    except (KeyError, TypeError):
        reference = None
    return Subject(
        key, 3 if three_way else 2, rows["start_time"], y, pd.Timestamp(champion.report["data_through"]),
        lambda w: probs(champion, w),
        lambda cutoff: train(feats[feats["start_time"] < cutoff]),
        lambda model, w: probs(model, w),
        lambda: train(feats),
        save,
        reference,
    )
