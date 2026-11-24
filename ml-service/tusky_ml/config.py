"""Settings, loaded from the repo-root `.env` (shared with the TypeScript services)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
load_dotenv(REPO_ROOT / ".env", override=False)

SPORTS = ("football", "basketball")


def _int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


@dataclass(frozen=True)
class Settings:
    database_url: str
    artifacts_dir: Path
    sports: tuple[str, ...]
    predict_days_ahead: int
    retrain_days: int
    predict_interval_minutes: int
    min_train_matches: int


def load_settings() -> Settings:
    sports_raw = os.getenv("ML_SPORTS") or os.getenv("ENABLED_SPORTS") or "football"
    sports = tuple(s.strip() for s in sports_raw.split(",") if s.strip() in SPORTS) or ("football",)
    return Settings(
        database_url=os.getenv("DATABASE_URL", "postgres://tusky:tusky@localhost:5433/tusky"),
        artifacts_dir=Path(os.getenv("ML_ARTIFACTS_DIR") or ML_ROOT / "artifacts"),
        sports=sports,
        predict_days_ahead=_int("ML_PREDICT_DAYS_AHEAD", 14),
        retrain_days=_int("ML_RETRAIN_DAYS", 7),
        predict_interval_minutes=_int("ML_PREDICT_INTERVAL_MINUTES", 60),
        min_train_matches=_int("ML_MIN_TRAIN_MATCHES", 300),
    )
