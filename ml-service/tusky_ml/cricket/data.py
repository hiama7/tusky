"""Load cricket history from Postgres into plain DataFrames for the feature replay."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
import psycopg

# Dismissals credited to the bowler (run outs, retirements etc. are not).
BOWLER_WICKETS = ("bowled", "caught", "caught and bowled", "lbw", "stumped", "hit wicket")
NOT_OUT_KINDS = ("retired hurt", "retired not out")
MODEL_FORMATS = ("T20", "ODI", "Test")


@dataclass
class CricketData:
    matches: pd.DataFrame
    """One row per match: ids, time, format, gender, teams, venue, toss, winner, result."""
    innings: pd.DataFrame
    """One row per (non-super-over) innings with totals and phase splits."""
    batting: pd.DataFrame
    """Per (match, player): runs, balls faced, dismissed."""
    bowling: pd.DataFrame
    """Per (match, player): legal balls, runs conceded, wickets."""
    lineups: pd.DataFrame
    """Per (match, team, player), in the source's listed order."""


def load(conn: psycopg.Connection, formats: tuple[str, ...] = MODEL_FORMATS) -> CricketData:
    fmts = list(formats)
    matches = pd.DataFrame(
        conn.execute(
            """
            select m.id as match_id, m.start_time, m.format, m.status::text as status,
                   m.home_team_id as team1, m.away_team_id as team2,
                   left(t1.external_id, 1) as gender,
                   coalesce(m.raw->>'team_type', 'unknown') as team_type,
                   m.venue_id, coalesce(m.city, v.city) as city,
                   m.toss_winner_team_id as toss_winner, m.toss_decision,
                   m.winner_team_id as winner, m.result_type,
                   m.raw->'event'->>'name' as event_name, m.raw->'event'->>'stage' as event_stage
            from matches m
            join sports s on s.id = m.sport_id and s.code = 'cricket'
            join teams t1 on t1.id = m.home_team_id
            left join venues v on v.id = m.venue_id
            where m.format = any(%s) and m.status <> 'cancelled'
            order by m.start_time, m.id
            """,
            (fmts,),
        ).fetchall(),
        columns=["match_id", "start_time", "format", "status", "team1", "team2", "gender", "team_type",
                 "venue_id", "city", "toss_winner", "toss_decision", "winner", "result_type", "event_name", "event_stage"],
    )
    ids = matches["match_id"].astype(int).tolist()
    innings = pd.DataFrame(
        conn.execute(
            """
            select match_id, innings_no, batting_team_id, bowling_team_id, runs, wickets, legal_balls,
                   target_runs, target_overs, pp_runs, mid_runs, death_runs
            from cricket_innings where match_id = any(%s) and not is_super_over
            order by match_id, innings_no
            """,
            (ids,),
        ).fetchall(),
        columns=["match_id", "innings_no", "bat_team", "bowl_team", "runs", "wickets", "legal_balls",
                 "target_runs", "target_overs", "pp_runs", "mid_runs", "death_runs"],
    )
    batting = pd.DataFrame(
        conn.execute(
            """
            with d as (
              select d.* from deliveries d
              join cricket_innings i on i.match_id = d.match_id and i.innings_no = d.innings_no and not i.is_super_over
              where d.match_id = any(%s)
            ), faced as (
              select match_id, batter_id as player_id, sum(runs_batter) as runs,
                     count(*) filter (where extras_kind is null or extras_kind not like '%%wides%%') as balls
              from d group by 1, 2
            ), outs as (
              select match_id, player_out_id as player_id, count(*) as outs
              from d where player_out_id is not null and wicket_kind <> all(%s) group by 1, 2
            )
            select f.match_id, f.player_id, f.runs, f.balls, coalesce(o.outs, 0) > 0 as out
            from faced f left join outs o using (match_id, player_id)
            """,
            (ids, list(NOT_OUT_KINDS)),
        ).fetchall(),
        columns=["match_id", "player_id", "runs", "balls", "out"],
    )
    bowling = pd.DataFrame(
        conn.execute(
            """
            select d.match_id, d.bowler_id as player_id,
                   count(*) filter (where d.is_legal) as balls,
                   sum(d.runs_batter + case when d.extras_kind like '%%wides%%' or d.extras_kind like '%%noballs%%'
                                            then d.runs_extras else 0 end) as runs,
                   count(*) filter (where d.wicket_kind = any(%s)) as wickets
            from deliveries d
            join cricket_innings i on i.match_id = d.match_id and i.innings_no = d.innings_no and not i.is_super_over
            where d.match_id = any(%s)
            group by 1, 2
            """,
            (list(BOWLER_WICKETS), ids),
        ).fetchall(),
        columns=["match_id", "player_id", "balls", "runs", "wickets"],
    )
    lineups = pd.DataFrame(
        conn.execute(
            "select match_id, team_id, player_id from match_lineups where match_id = any(%s) order by match_id, id",
            (ids,),
        ).fetchall(),
        columns=["match_id", "team_id", "player_id"],
    )
    matches["start_time"] = pd.to_datetime(matches["start_time"], utc=True)
    return CricketData(matches=matches, innings=innings, batting=batting, bowling=bowling, lineups=lineups)
