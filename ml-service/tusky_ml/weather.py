"""Match-day weather for cricket from Open-Meteo (open-meteo.com): geocoding + the ERA5 archive.

Terms (free API): non-commercial use, no key; a paid plan is needed for commercial products.
Replace or license it before Tusky becomes a product. Requests are throttled and every response
is cached under data/openmeteo/, so runs are resumable and cheap to repeat.

Availability rule ("only use what was known at prediction time"). The archive holds what
actually happened, including post-hoc facts such as rain delays, whereas a live prediction only
has a forecast. So only variables that a day-ahead forecast predicts well are used (temperature,
humidity, dew point, wind, cloud cover) and PRECIPITATION IS DELIBERATELY EXCLUDED. Training on
observed values and serving forecasts still leaves a small skew, so any gain measured here is an
upper bound on the real one.

Geocoding is by the Cricsheet city name; the most populous match is taken if it has at least
MIN_POPULATION people, otherwise the venue is left unresolved and its matches get `wx_missing`.
Wrong coordinates would add noise, never leakage: the coordinates do not depend on any result.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd
import psycopg

log = logging.getLogger("tusky_ml.weather")

GEOCODE = "https://geocoding-api.open-meteo.com/v1/search?name={name}&count=5&language=en&format=json"
ARCHIVE = ("https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&start_date={start}&end_date={end}"
           "&daily=temperature_2m_mean,relative_humidity_2m_mean,dew_point_2m_mean,wind_speed_10m_max,cloud_cover_mean&timezone=auto")
SOURCE = "open-meteo-era5"
MIN_POPULATION = 20_000
MIN_INTERVAL_S = 0.25
RETRIES = 4

FEATURES = ["wx_temp", "wx_humidity", "wx_dew_point", "wx_wind", "wx_cloud", "wx_missing"]
# Neutral values used when a match has no weather (always together with wx_missing = 1).
NEUTRAL = {"wx_temp": 22.0, "wx_humidity": 65.0, "wx_dew_point": 14.0, "wx_wind": 20.0, "wx_cloud": 50.0}
DAILY = {"temperature_2m_mean": "wx_temp", "relative_humidity_2m_mean": "wx_humidity", "dew_point_2m_mean": "wx_dew_point",
         "wind_speed_10m_max": "wx_wind", "cloud_cover_mean": "wx_cloud"}


class RateLimited(RuntimeError):
    pass


def http_get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "tusky-ingest/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        if e.code == 429:
            try:
                reason = json.loads(e.read()).get("reason", "")
            except Exception:  # noqa: BLE001
                reason = ""
            raise RateLimited(f"{url} {reason}".strip()) from e
        raise


def _get(url: str, get: Callable[[str], dict], sleep: Callable[[float], None]) -> dict:
    """GET with backoff. Network trouble of any kind (reset connections, TLS errors, truncated
    bodies, 429 and 5xx) is retried; a 4xx other than 429 means the request itself is wrong and fails at once."""
    last: Exception | None = None
    for i in range(RETRIES):
        try:
            doc = get(url)
            sleep(MIN_INTERVAL_S)
            return doc
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504):
                raise RuntimeError(f"open-meteo rejected the request ({e.code}): {url}") from e
            last = e
            sleep(5.0 * (i + 1))
        except (RateLimited, OSError, ValueError) as e:  # OSError covers resets, timeouts, TLS; ValueError a truncated JSON body
            last = e
            sleep(5.0 * (i + 1))
    raise RuntimeError(f"open-meteo request failed after {RETRIES} tries: {url}: {last}")


# ---- pure helpers ---------------------------------------------------------------------------------------------


def pick_place(doc: dict, min_population: int = MIN_POPULATION) -> dict | None:
    """The most populous geocoding result, if it is a real town (population known and large enough)."""
    results = doc.get("results") or []
    best = max(results, key=lambda r: r.get("population") or 0, default=None)
    if best is None or (best.get("population") or 0) < min_population:
        return None
    # A city name that real towns of several countries share ("Hamilton": Canada, New Zealand, Bermuda ...)
    # cannot be resolved from the name alone, and guessing the biggest one puts the ground on the wrong
    # continent. Leave such venues unresolved; their matches get `wx_missing`.
    same = {(r.get("country_code") or r.get("country") or "") for r in results
            if (r.get("name") or "").casefold() == (best.get("name") or "").casefold() and (r.get("population") or 0) >= min_population}
    if len(same) > 1:
        return None
    return {"lat": float(best["latitude"]), "lon": float(best["longitude"]), "timezone": best.get("timezone"),
            "match": f"{best.get('name')}, {best.get('admin1') or ''}, {best.get('country') or ''}".replace(", ,", ",")}


def parse_archive(doc: dict) -> pd.DataFrame:
    """Daily archive response -> frame indexed by date with the FEATURES columns (NaN where unknown)."""
    daily = doc.get("daily") or {}
    days = daily.get("time") or []
    out = pd.DataFrame({new: pd.to_numeric(pd.Series(daily.get(old) or [None] * len(days)), errors="coerce") for old, new in DAILY.items()})
    out.index = pd.to_datetime(pd.Series(days)).dt.date
    return out


def frame_for(match_ids: np.ndarray, records: pd.DataFrame) -> pd.DataFrame:
    """One row per match id: observed values, or the neutral values with wx_missing = 1."""
    base = records.reindex(match_ids) if len(records) else pd.DataFrame(index=match_ids, columns=list(NEUTRAL), dtype=float)
    missing = base[list(NEUTRAL)].isna().any(axis=1)
    out = base[list(NEUTRAL)].copy().astype(float)
    for c, v in NEUTRAL.items():
        out[c] = out[c].fillna(v)
    out["wx_missing"] = missing.astype(float)
    out.index.name = "match_id"
    return out.reset_index()


# ---- geocoding and fetching (database) --------------------------------------------------------------------


def geocode_venues(conn: psycopg.Connection, get=http_get_json, sleep=time.sleep, log_fn=print, cache_dir: Path | None = None) -> dict[str, int]:
    """Fill lat/lon/timezone for cricket venues that have a city. Unresolved venues are marked so they are not retried.
    With `cache_dir`, every geocoding response is kept so a rule change never needs the network again."""
    rows = conn.execute(
        """select v.id, v.city from venues v join sports s on s.id = v.sport_id and s.code = 'cricket'
           where v.lat is null and v.geo_source is null and v.city is not null order by v.id"""
    ).fetchall()
    counts = {"resolved": 0, "unresolved": 0}
    for vid, city in rows:
        cached = cache_dir / f"geocode-{vid}.json" if cache_dir else None
        if cached is not None and cached.exists():
            doc = json.loads(cached.read_text(encoding="utf-8"))
        else:
            doc = _get(GEOCODE.format(name=urllib.parse.quote(city)), get, sleep)
            if cached is not None:
                cached.parent.mkdir(parents=True, exist_ok=True)
                cached.write_text(json.dumps(doc), encoding="utf-8")
        place = pick_place(doc)
        if place:
            conn.execute("update venues set lat = %s, lon = %s, timezone = %s, geo_source = 'open-meteo', geo_match = %s, updated_at = now() where id = %s",
                         (place["lat"], place["lon"], place["timezone"], place["match"], vid))
            counts["resolved"] += 1
        else:
            conn.execute("update venues set geo_source = 'unresolved', updated_at = now() where id = %s", (vid,))
            counts["unresolved"] += 1
        conn.commit()
    log_fn(f"  geocoded {len(rows)} venues: {counts}")
    return counts


WINDOW_DAYS = 14          # Open-Meteo counts every 14 days of requested data as one API call
ARCHIVE_INTERVAL_S = 1.5  # ~2,400 calls an hour: well under the free hourly allowance
MAX_RATE_WAIT_S = 600.0


def windows(days: list, span: int = WINDOW_DAYS) -> list[tuple]:
    """Group dates into windows of at most `span` days: [(first, last, [dates]), ...]. One request each."""
    out: list[tuple] = []
    for d in sorted(set(days)):
        if out and (d - out[-1][0]).days < span:
            out[-1] = (out[-1][0], d, out[-1][2] + [d])
        else:
            out.append((d, d, [d]))
    return out


def fetch_and_store(conn: psycopg.Connection, cache_dir: Path, get=http_get_json, sleep=time.sleep, log_fn=print) -> dict[str, int]:
    """Weather for every cricket match at a geocoded venue, one request per 14-day window of match days.

    A request for a venue's whole history would cost hundreds of API calls (Open-Meteo charges per
    14 days of data) and trips the free hourly limit; match days are sparse, so windows are cheap.
    Responses are cached per window, rows are committed per window, and a rerun resumes."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    venues = conn.execute(
        """select distinct v.id, v.lat, v.lon from venues v join matches m on m.venue_id = v.id
           join sports s on s.id = m.sport_id and s.code = 'cricket'
           where v.lat is not null and m.format in ('T20', 'ODI', 'Test') order by v.id"""
    ).fetchall()
    stored = fetched = cached = 0
    for vid, lat, lon in venues:
        by_day: dict = {}
        for mid, day in conn.execute(
            "select m.id, m.start_time::date from matches m where m.venue_id = %s and m.format in ('T20', 'ODI', 'Test')", (vid,)
        ).fetchall():
            by_day.setdefault(day, []).append(mid)
        for first, last, days in windows(list(by_day)):
            path = cache_dir / f"venue-{vid}-{first}.json"
            if path.exists():
                doc = json.loads(path.read_text(encoding="utf-8"))
                cached += 1
            else:
                doc = _get(ARCHIVE.format(lat=lat, lon=lon, start=first, end=last), get, lambda s: sleep(min(s, MAX_RATE_WAIT_S)))
                path.write_text(json.dumps(doc), encoding="utf-8")
                fetched += 1
                sleep(ARCHIVE_INTERVAL_S)
            daily = parse_archive(doc)
            for day in days:
                if day not in daily.index or daily.loc[day].isna().all():
                    continue
                r = daily.loc[day]
                values = tuple(None if pd.isna(r[c]) else float(r[c]) for c in ("wx_temp", "wx_humidity", "wx_dew_point", "wx_wind", "wx_cloud"))
                for mid in by_day[day]:
                    conn.execute(
                        """insert into match_weather (match_id, source, kind, date, temp_mean, humidity_mean, dew_point_mean, wind_max, cloud_mean)
                           values (%s, %s, 'archive', %s, %s, %s, %s, %s, %s)
                           on conflict (match_id) do update set temp_mean = excluded.temp_mean, humidity_mean = excluded.humidity_mean,
                             dew_point_mean = excluded.dew_point_mean, wind_max = excluded.wind_max, cloud_mean = excluded.cloud_mean, fetched_at = now()""",
                        (mid, SOURCE, day, *values),
                    )
                    stored += 1
            conn.commit()
        log_fn(f"  venue {vid}: done ({fetched} requests so far, {cached} windows from cache, {stored} matches with weather)")
    log_fn(f"  {fetched} archive requests; {stored} matches have weather")
    return {"requests": fetched, "matches_with_weather": stored}


def features_for(conn: psycopg.Connection, match_ids: np.ndarray) -> pd.DataFrame:
    """Weather features for the given matches, aligned to `match_ids` (missing -> neutral + wx_missing)."""
    rows = conn.execute(
        "select match_id, temp_mean, humidity_mean, dew_point_mean, wind_max, cloud_mean from match_weather where match_id = any(%s)",
        (list(map(int, match_ids)),),
    ).fetchall()
    rec = pd.DataFrame(rows, columns=["match_id", "wx_temp", "wx_humidity", "wx_dew_point", "wx_wind", "wx_cloud"]).set_index("match_id")
    return frame_for(match_ids, rec)
