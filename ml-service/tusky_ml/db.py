"""Postgres access (the schema is owned by Drizzle in packages/db; this module only reads
`matches` and writes `predictions`)."""

from __future__ import annotations

import json

import pandas as pd
import psycopg

from .exhibitions import exhibition_mask
from .features import MATCH_COLUMNS


def connect(url: str) -> psycopg.Connection:
    return psycopg.connect(url, connect_timeout=5)


def sport_id(conn: psycopg.Connection, sport: str) -> int:
    row = conn.execute("select id from sports where code = %s", (sport,)).fetchone()
    if not row:
        raise RuntimeError(f"unknown sport '{sport}' (run `npm run db:migrate`, which seeds sports)")
    return int(row[0])


def load_matches(conn: psycopg.Connection, sport: str) -> pd.DataFrame:
    """Every non-cancelled competitive match of a sport (preseason and exhibition games are
    dropped, see exhibitions.py). Scores are null until the result is known."""
    rows = conn.execute(
        """
        select m.id, m.start_time, m.competition_id, m.home_team_id, m.away_team_id,
               m.home_score, m.away_score, m.status::text, c.external_id
        from matches m
        join sports s on s.id = m.sport_id
        left join competitions c on c.id = m.competition_id
        where s.code = %s and m.status <> 'cancelled'
        order by m.start_time, m.id
        """,
        (sport,),
    ).fetchall()
    df = pd.DataFrame(rows, columns=[*MATCH_COLUMNS, "league_id"])
    if df.empty:
        return df[MATCH_COLUMNS]
    keep = ~exhibition_mask(sport, df, df["league_id"])
    return df.loc[keep, MATCH_COLUMNS].reset_index(drop=True)


def team_names(conn: psycopg.Connection, team_ids: list[int]) -> dict[int, str]:
    if not team_ids:
        return {}
    rows = conn.execute("select id, name from teams where id = any(%s)", (list(team_ids),)).fetchall()
    return {int(r[0]): r[1] for r in rows}


def _num(v) -> float | None:
    return None if v is None or (isinstance(v, float) and v != v) else float(v)


def upsert_predictions(conn: psycopg.Connection, sport: str, version: str | None, preds: pd.DataFrame) -> int:
    """Upsert prediction rows. `version` applies to every row unless `preds` has a
    per-row `version` column (cricket: one model per format)."""
    if preds.empty:
        return 0
    sid = sport_id(conn, sport)
    per_row = "version" in preds.columns
    params = [
        (
            int(r.match_id),
            sid,
            r.version if per_row else version,
            float(r.p_home),
            float(r.p_draw),
            float(r.p_away),
            _num(r.exp_home),
            _num(r.exp_away),
            json.dumps(r.details),
            json.dumps(r.features),
        )
        for r in preds.itertuples(index=False)
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into predictions
              (match_id, sport_id, model_version, p_home, p_draw, p_away,
               exp_home_score, exp_away_score, details, features)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
            on conflict (match_id, model_version) do update set
              p_home = excluded.p_home, p_draw = excluded.p_draw, p_away = excluded.p_away,
              exp_home_score = excluded.exp_home_score, exp_away_score = excluded.exp_away_score,
              details = excluded.details, features = excluded.features, updated_at = now()
            """,
            params,
        )
    conn.commit()
    return len(params)
