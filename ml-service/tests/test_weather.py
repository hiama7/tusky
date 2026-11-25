import os
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd
import pytest

from tusky_ml import db, weather

TEST_URL = os.getenv("TUSKY_TEST_DATABASE_URL", "postgres://tusky:tusky@localhost:5433/tusky_test")


def test_pick_place_takes_the_most_populous_real_town_and_rejects_hamlets():
    doc = {"results": [
        {"name": "Mumbai", "latitude": 19.07, "longitude": 72.88, "country": "India", "country_code": "IN", "admin1": "Maharashtra", "population": 12_000_000, "timezone": "Asia/Kolkata"},
        {"name": "Mumbai Hamlet", "latitude": 1.0, "longitude": 2.0, "country": "Elsewhere", "country_code": "XX", "population": 900},
    ]}
    best = weather.pick_place(doc)
    assert best["lat"] == 19.07 and "India" in best["match"]
    assert weather.pick_place({"results": [{"name": "Tiny", "latitude": 1, "longitude": 2, "population": 800}]}) is None
    assert weather.pick_place({"results": [{"name": "NoPop", "latitude": 1, "longitude": 2}]}) is None
    assert weather.pick_place({}) is None and weather.pick_place({"results": []}) is None


def test_a_city_name_shared_by_towns_of_several_countries_is_left_unresolved_not_guessed():
    hamilton = {"results": [
        {"name": "Hamilton", "latitude": 43.25, "longitude": -79.87, "country": "Canada", "country_code": "CA", "population": 569_000},
        {"name": "Hamilton", "latitude": -37.78, "longitude": 175.28, "country": "New Zealand", "country_code": "NZ", "population": 178_000},
    ]}
    assert weather.pick_place(hamilton) is None  # the ground could be in either; the biggest guess put it in Canada
    # several towns of the SAME country with one name are not ambiguous about the country
    springfield = {"results": [
        {"name": "Springfield", "latitude": 39.8, "longitude": -89.6, "country": "United States", "country_code": "US", "population": 114_000},
        {"name": "Springfield", "latitude": 37.2, "longitude": -93.3, "country": "United States", "country_code": "US", "population": 169_000},
    ]}
    assert weather.pick_place(springfield)["lat"] == 37.2
    # a big town plus a same-named hamlet elsewhere is fine
    hamlet = {"results": [
        {"name": "Cairns", "latitude": -16.9, "longitude": 145.8, "country": "Australia", "country_code": "AU", "population": 153_000},
        {"name": "Cairns", "latitude": 55.0, "longitude": -3.0, "country": "United Kingdom", "country_code": "GB", "population": 400},
    ]}
    assert weather.pick_place(hamlet)["lat"] == -16.9


def test_parse_archive_maps_names_dates_and_unknown_values():
    doc = {"daily": {"time": ["2024-05-01", "2024-05-02"], "temperature_2m_mean": [30.5, None], "relative_humidity_2m_mean": [60, 70],
                     "dew_point_2m_mean": [20.0, 21.0], "wind_speed_10m_max": [15.0, 18.0], "cloud_cover_mean": [40, None]}}
    out = weather.parse_archive(doc)
    assert list(out.columns) == ["wx_temp", "wx_humidity", "wx_dew_point", "wx_wind", "wx_cloud"]
    assert out.loc[date(2024, 5, 1), "wx_temp"] == 30.5 and np.isnan(out.loc[date(2024, 5, 2), "wx_temp"])
    assert weather.parse_archive({}).empty


def test_frame_for_marks_missing_weather_instead_of_pretending_it_is_average():
    rec = pd.DataFrame({"wx_temp": [31.0, np.nan], "wx_humidity": [55.0, 60.0], "wx_dew_point": [18.0, 12.0], "wx_wind": [10.0, 9.0], "wx_cloud": [20.0, 30.0]},
                       index=pd.Index([1, 2], name="match_id"))
    out = weather.frame_for(np.array([1, 2, 3]), rec).set_index("match_id")
    assert out.loc[1, "wx_missing"] == 0.0 and out.loc[1, "wx_temp"] == 31.0
    assert out.loc[2, "wx_missing"] == 1.0 and out.loc[2, "wx_temp"] == weather.NEUTRAL["wx_temp"]  # a gap in one variable is a gap
    assert out.loc[3, "wx_missing"] == 1.0 and out.loc[3, "wx_wind"] == weather.NEUTRAL["wx_wind"]  # no record at all
    assert list(weather.frame_for(np.array([5]), pd.DataFrame()).columns) == ["match_id", *weather.FEATURES]


def test_precipitation_is_never_requested_or_stored():
    assert "precipitation" not in weather.ARCHIVE and all("precip" not in c for c in weather.FEATURES)


def test_requests_back_off_on_rate_limits_and_give_up_eventually():
    waits, calls = [], []

    def flaky(url):
        calls.append(1)
        if len(calls) < 3:
            raise weather.RateLimited(url)
        return {"ok": True}

    assert weather._get("http://x", flaky, waits.append) == {"ok": True}
    assert waits[:2] == [5.0, 10.0]

    def always(url):
        raise weather.RateLimited(url)

    with pytest.raises(RuntimeError, match="failed after"):
        weather._get("http://x", always, lambda s: None)


def test_connection_resets_and_truncated_bodies_are_retried_but_a_bad_request_is_not():
    import urllib.error

    calls = []

    def reset_then_ok(url):
        calls.append(1)
        if len(calls) == 1:
            raise ConnectionResetError(10054, "forcibly closed by the remote host")  # what crashed the first real run
        if len(calls) == 2:
            raise ValueError("Expecting value")  # a truncated JSON body
        return {"ok": True}

    assert weather._get("http://x", reset_then_ok, lambda s: None) == {"ok": True} and len(calls) == 3

    bad = []

    def rejected(url):
        bad.append(1)
        raise urllib.error.HTTPError(url, 400, "Bad Request", {}, None)

    with pytest.raises(RuntimeError, match="rejected the request"):
        weather._get("http://x", rejected, lambda s: None)
    assert len(bad) == 1  # no retries for a request that can never succeed


def test_match_days_are_grouped_into_windows_of_at_most_14_days():
    d = lambda n: date(2024, 1, 1) + pd.Timedelta(days=n).to_pytimedelta()  # noqa: E731
    out = weather.windows([d(40), d(1), d(3), d(20), d(3)])
    assert [(a, b) for a, b, _ in out] == [(d(1), d(3)), (d(20), d(20)), (d(40), d(40))]
    assert [len(days) for _, _, days in out] == [2, 1, 1]
    assert [(a, b) for a, b, _ in weather.windows([d(0), d(13), d(14)])] == [(d(0), d(13)), (d(14), d(14))]  # a window spans < 14 days
    assert weather.windows([]) == []


# ---- database round trip (skipped when tusky_test is not reachable) --------------------------------------------


@pytest.fixture()
def conn():
    try:
        c = db.connect(TEST_URL)
        c.execute("select 1 from match_weather limit 1")
        sid = c.execute("select id from sports where code = 'cricket'").fetchone()[0]
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"tusky_test DB not ready ({e}); run `npm test` once (with Docker running) to create and migrate it")

    def clean():
        c.rollback()
        c.execute("delete from matches where provider = 'pytest-wx'")
        c.execute("delete from venues where provider = 'pytest-wx'")
        c.execute("delete from teams where provider = 'pytest-wx'")
        c.commit()

    clean()
    yield c, sid
    clean()
    c.close()


def test_geocode_fetch_store_and_features_round_trip(conn, tmp_path):
    c, sid = conn
    v_ok = c.execute("insert into venues (sport_id, provider, external_id, name, city) values (%s, 'pytest-wx', 'v1', 'Wankhede', 'Mumbai') returning id", (sid,)).fetchone()[0]
    v_bad = c.execute("insert into venues (sport_id, provider, external_id, name, city) values (%s, 'pytest-wx', 'v2', 'Ground', 'Nowhereville') returning id", (sid,)).fetchone()[0]
    teams = [c.execute("insert into teams (sport_id, provider, external_id, name) values (%s, 'pytest-wx', %s, %s) returning id", (sid, f"t{i}", f"T{i}")).fetchone()[0] for i in range(2)]
    ids = []
    for venue, day in ((v_ok, 1), (v_ok, 3), (v_bad, 2)):
        ids.append(c.execute(
            """insert into matches (sport_id, provider, external_id, home_team_id, away_team_id, start_time, status, format, venue_id)
               values (%s, 'pytest-wx', %s, %s, %s, %s, 'completed', 'T20', %s) returning id""",
            (sid, f"m{len(ids)}", teams[0], teams[1], datetime(2024, 5, day, tzinfo=timezone.utc), venue)).fetchone()[0])
    c.commit()

    def geo(url):
        if "Mumbai" in url:
            return {"results": [{"name": "Mumbai", "latitude": 19.07, "longitude": 72.88, "country": "India", "admin1": "Maharashtra", "population": 12_000_000, "timezone": "Asia/Kolkata"}]}
        return {"results": [{"name": "Nowhereville", "latitude": 1.0, "longitude": 2.0, "population": 300}]}

    counts = weather.geocode_venues(c, geo, lambda s: None, lambda *_: None)
    assert counts == {"resolved": 1, "unresolved": 1}
    assert c.execute("select geo_source from venues where id = %s", (v_bad,)).fetchone()[0] == "unresolved"
    assert weather.geocode_venues(c, geo, lambda s: None, lambda *_: None) == {"resolved": 0, "unresolved": 0}  # never retried

    archive = {"daily": {"time": ["2024-05-01", "2024-05-02", "2024-05-03"], "temperature_2m_mean": [30.0, 31.0, 32.0],
                         "relative_humidity_2m_mean": [60, 61, 62], "dew_point_2m_mean": [20, 21, 22], "wind_speed_10m_max": [10, 11, 12], "cloud_cover_mean": [10, 20, 30]}}
    requests = []
    res = weather.fetch_and_store(c, tmp_path, lambda url: requests.append(url) or archive, lambda s: None, lambda *_: None)
    assert res["requests"] == 1 and "latitude=19.07" in requests[0]
    # the same run again is served entirely from the cache
    assert weather.fetch_and_store(c, tmp_path, lambda url: pytest.fail("network used"), lambda s: None, lambda *_: None)["requests"] == 0

    f = weather.features_for(c, np.array(ids)).set_index("match_id")
    assert f.loc[ids[0], "wx_temp"] == 30.0 and f.loc[ids[1], "wx_temp"] == 32.0 and f.loc[ids[0], "wx_missing"] == 0.0
    assert f.loc[ids[2], "wx_missing"] == 1.0  # the venue that could not be geocoded
