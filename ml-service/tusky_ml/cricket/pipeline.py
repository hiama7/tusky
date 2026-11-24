"""Cricket train / predict entry points (artifacts under artifacts/cricket/<format>/)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from .features import build_features
from .model import CricketModel, train

FORMATS = ("T20", "ODI", "Test")
SNAPSHOT = ["elo_diff", "form10_diff", "rr_bat_diff", "rr_bowl_diff", "h2h", "h2h_n", "venue_first_inns",
            "venue_chase_rate", "toss_a", "bat_first_a", "avail_diff", "n_a", "n_b"]


def paths(artifacts_dir: Path, fmt: str) -> tuple[Path, Path]:
    d = artifacts_dir / "cricket" / fmt
    return d / "model.joblib", d / "report.json"


def save(model: CricketModel, artifacts_dir: Path) -> Path:
    mp, rp = paths(artifacts_dir, model.fmt)
    mp.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, mp)
    rp.write_text(json.dumps(model.report, indent=2, default=str), encoding="utf-8")
    return mp


def load(artifacts_dir: Path, fmt: str) -> CricketModel | None:
    mp, _ = paths(artifacts_dir, fmt)
    return joblib.load(mp) if mp.exists() else None


def train_all(feats: pd.DataFrame, formats=FORMATS, min_matches: int = 300) -> dict[str, CricketModel | str]:
    """Train every format that has enough data. Values are models, or the reason a format was skipped."""
    out: dict[str, CricketModel | str] = {}
    for fmt in formats:
        try:
            out[fmt] = train(feats, fmt, min_matches=min_matches)
        except ValueError as e:
            out[fmt] = str(e)
    return out


def _fi_frame(rows: pd.DataFrame, prefix: str) -> pd.DataFrame:
    """Rows with one batting-order scenario's columns (fi1_/fi2_) under the model's fi_ names."""
    base = rows.drop(columns=[c for c in rows.columns if c.startswith("fi_")])
    return base.rename(columns={c: c.replace(prefix, "fi_", 1) for c in base.columns if c.startswith(prefix)})


def predict(
    models: dict[str, CricketModel],
    feats: pd.DataFrame,
    days_ahead: int = 14,
    match_ids: list[int] | None = None,
    now: datetime | None = None,
) -> pd.DataFrame:
    """Score scheduled matches (or the given ids). The post-toss model is used once the toss
    is known, otherwise the pre-toss model; the first-innings projection covers the actual
    batting order if known, else both scenarios."""
    if match_ids:
        target = feats[feats["match_id"].isin(match_ids)]
    else:
        now_ts = pd.Timestamp(now or datetime.now(timezone.utc))
        target = feats[(feats["status"] == "scheduled") & (feats["start_time"] > now_ts - timedelta(hours=12))
                       & (feats["start_time"] <= now_ts + timedelta(days=days_ahead))]
    out = []
    for fmt, group in target.groupby("format"):
        model = models.get(fmt)
        if model is None:
            continue
        tossed = group["toss_a"] != 0
        probs = np.zeros((len(group), 3))
        if (~tossed).any():
            probs[(~tossed).to_numpy()] = model.pre.predict(group[~tossed])
        if tossed.any():
            probs[tossed.to_numpy()] = model.post.predict(group[tossed])
        fi = {}
        if model.first_innings is not None:
            for key, prefix in (("team1_bats_first", "fi1_"), ("team2_bats_first", "fi2_")):
                q = model.first_innings.predict(_fi_frame(group, prefix))
                fi[key] = q
        for i, (_, r) in enumerate(group.iterrows()):
            details = {
                "format": fmt,
                "stage": "post_toss" if tossed.iloc[i] else "pre_toss",
                "model_version": model.version,
            }
            if fi:
                proj = {k: {"p10": round(float(v[i, 0])), "p50": round(float(v[i, 1])), "p90": round(float(v[i, 2]))} for k, v in fi.items()}
                if r["bat_first_a"] == 1:
                    proj = {"team1_bats_first": proj["team1_bats_first"]}
                elif r["bat_first_a"] == -1:
                    proj = {"team2_bats_first": proj["team2_bats_first"]}
                details["first_innings"] = proj
            out.append(
                {
                    "match_id": int(r["match_id"]),
                    "start_time": r["start_time"],
                    "home_team_id": int(r["team1"]),
                    "away_team_id": int(r["team2"]),
                    "p_home": float(probs[i, 0]),
                    "p_draw": float(probs[i, 1]),
                    "p_away": float(probs[i, 2]),
                    "exp_home": None,
                    "exp_away": None,
                    "details": details,
                    "features": {c: (round(float(r[c]), 4) if pd.notna(r[c]) else None) for c in SNAPSHOT},
                    "version": model.version,
                }
            )
    return pd.DataFrame(out)


def build(data) -> pd.DataFrame:
    return build_features(data)
