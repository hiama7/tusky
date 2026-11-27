# Phase 4: model quality, 28 November 2026

## Where football is weak

`npm run ml:weakness`. The live model type (Poisson GLM, saved settings) is fitted on matches
before 1 July 2025 and scored on 2,263 later matches, to 23 November 2026. "Skill" is how much
lower the ranked probability score is than quoting base rates.

| Segment | Matches | Right result | Home won | Skill (95% interval) |
|---|---|---|---|---|
| All | 2,263 | 52.2% | 44.2% | 12.0% (9.8 to 14.0) |
| Early season (a side under 5 games) | 446 | 52.5% | 44.4% | 11.9% (7.6 to 16.3) |
| A side new to the league | 573 | 49.9% | 44.5% | 11.7% (6.9 to 16.0) |
| Premier League | 482 | 47.5% | 42.3% | 8.2% (3.9 to 12.0) |
| Ligue 1 | 398 | 51.0% | 45.5% | 9.1% (4.1 to 14.1) |
| La Liga | 495 | 52.5% | 47.3% | 12.3% (7.6 to 17.0) |
| Bundesliga | 391 | 55.2% | 45.3% | 14.4% (8.7 to 19.7) |
| Serie A | 497 | 55.1% | 41.3% | 15.6% (11.3 to 20.3) |

- **Early season is not a weak spot** on this evidence.
- The Premier League and Ligue 1 are the hardest, though most league intervals overlap.
- **Strong home favourites are underrated:** said 64.5%, happened 70.9% (230 matches); said
  77.2%, happened 82.7% (110).
- **Draws** are well calibrated on average (24.3% said, 24.8% happened) but a draw is never the
  single most likely outcome, so the model never "picks" one.
- The 52.8% on the dashboard is a different measurement (rolling validation over 3,947 matches).

## Calibration fix

Raising every probability to one exponent, chosen from pre-cutoff out-of-fold predictions
(0.96), made the later matches **worse** (log-loss -0.07%, interval wholly below zero). Not
applied. The favourite bias is not removed by a single exponent.

## Line-ups and injuries

- The database holds **no football line-ups** (cricket has them), so nothing can be tested.
- football-data.org sells line-ups (from EUR 29 a month); no injury data was listed.
- Sportmonks lists line-ups and injuries (from EUR 29 a month for 5 leagues, about three
  seasons, older history extra) but its terms say use is "only for personal and non-commercial
  purposes" ([terms](https://www.sportmonks.com/terms-of-service/)).

**Do not buy yet.** Ask Sportmonks in writing whether a paid public website is permitted. If it
is, take one month, import the history, and adopt only if it beats the current model on
unseen matches. No gain is assured.

## Cricket on the site

Models exist for T20, ODI and Test, but no upcoming fixtures reach them. The adapter for
CricketData.org is written and unverified; it needs `CRICKETDATA_API_KEY` (free, 100 requests a
day; paid from USD 5.99). Its [terms](https://cricketdata.org/terms-of-use/) both require
purchase for commercial use and say commercial use is "expressly prohibited". Ask them first.

## Public track record

New page `/track-record`: each finished match against the version published before kick-off.
Nothing finished with a score yet. The two 27 November matches are marked completed by the
source but have no score so far. football-data.org, already connected for tables, could supply
results sooner; that is not built.

## ML dashboard

Admin → Models: live version, validation against base rates, the table above, calibration,
cricket model dates and the published track record. It reads files from `ml-service/artifacts`,
so a server without them shows "not available".

## Live prediction: recommendation is no, for now

No authorised live source is in place; the free feeds found are delayed by minutes; and the
pre-match models have no way to use match state. Revisit once there is a track record and paying
interest.
