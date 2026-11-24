# Tusky: platform architecture

Design for the full sports-prediction platform: cricket, football and basketball, with tennis planned later. It extends what already runs (see [AGENT_CONTEXT.md](../AGENT_CONTEXT.md)) rather than replacing it. Each module below is built and validated in turn. The ML is validated before the dashboard is built.

Status markers: **[done]** exists and is tested · **[next]** next to build · **[planned]** designed, not started.

---

## 1. Principles

1. **Real data only for training and evaluation.** Synthetic leagues exist only for unit tests and the `bench` harness, where the true answer is known. They are never written to the real database.
2. **No leakage.** Every feature is computed from information available *before* kick-off, by replaying matches in time order. Validation always trains on the past and tests on the future (rolling origin), never a random split.
3. **Probabilities, not picks.** Every model outputs a full distribution (scorelines, margins, innings totals). Outcome probabilities are derived from it, so they sum to 1 and every market is consistent.
4. **A change must earn its place.** New features, models or calibrators are adopted only if they beat the current champion on the same out-of-sample backtest. For example, temperature calibration was tried and rejected because it made held-out log-loss worse.
5. **Honest claims.** Reports show the backtest metrics next to a base-rate baseline, and nothing else. Realistic targets: about 50–55% three-way accuracy in football and about 55–65% in T20 cricket. The dashboard never shows an accuracy figure that the evaluation table doesn't support.
6. **Legal data.** Only official APIs and openly licensed datasets are used, with no scraping of sites whose terms forbid it. Licences are listed in §3.

## 2. System overview

```
                 ┌──────────────────────────── ingestion (TypeScript, existing) ───────────────────────────┐
 API-Sports ────►│ scheduler (node-cron)          scrapper-service (pg-boss)                               │
 (football,      │  fixtures 6h · results daily    match.enrich → squads → player.history (LangGraph+LLM)  │
  basketball)    │  status promotion 1m            match.live-poll (stub)                                  │
 CricketData ───►│  + cricket fixtures/live [next]                                                         │
 Open-Meteo ────►│  + weather.fetch per match [planned]                                                    │
                 └───────────────────────────────────────┬─────────────────────────────────────────────────┘
 Cricsheet (bulk ball-by-ball) ──► ml-service ingest ────┤
                                                         ▼
                                   ┌──────────── PostgreSQL 17 (schema owned by Drizzle) ───────────┐
                                   │ core: sports, competitions, teams, players, venues, matches     │
                                   │ cricket: innings, deliveries · player_match_stats · weather     │
                                   │ ml: predictions, prediction_evaluations, model_registry, drift  │
                                   └───────▲──────────────────────────────▲──────────────────────────┘
                                           │ read history / write preds   │ read
                  ┌────────────────────────┴───────────┐     ┌────────────┴───────────────┐    ┌──────────────┐
                  │ ml-service (Python)                 │     │ backend/ FastAPI (Python)   │◄──►│ Redis        │
                  │ features → train (backtest, zoo,    │     │ REST + WebSocket/SSE        │    │ cache, live  │
                  │ tuning) → registry → predict →      │◄────┤ imports tusky_ml for live   │    │ pub/sub,     │
                  │ explain → evaluate → drift/retrain  │     │ win-prob and explanations   │    │ rate limits  │
                  │ live engines (cricket first)        │────►│                             │    └──────────────┘
                  └─────────────────────────────────────┘     └────────────┬───────────────┘
                                                                           ▼
                                                    frontend/ React + Tailwind + Recharts dashboard
```

How the languages split. **TypeScript** handles API ingestion and the job queue, because it already exists, is tested and owns the quota guards. **Python** handles everything that touches models or bulk data: Cricsheet import, features, training, prediction, explanations, live engines and the API. **Drizzle** stays the single owner of the database schema; Python only reads and writes tables through SQL.

## 3. Data sources

| Data | Source | Cost / licence | Used for |
|---|---|---|---|
| Football and basketball fixtures, results, squads, player season stats, injuries | API-Sports | Free: 100 req/day per sport. Paid plans for more | **[done]** fixtures/results/squads; injuries **[planned]** |
| Cricket history, ball by ball (T20I, ODI, Test, IPL, BBL, PSL, CPL…) | [Cricsheet](https://cricsheet.org) | Free, open data (ODC-BY: attribution required) | training: results, innings, phases, venues, toss, player ratings, live-engine states |
| Cricket fixtures, live scores, squads, toss | CricketData.org (cricapi) | Free tier is about 100 hits/day, paid above that | upcoming matches, toss, playing XI, live polling |
| Weather (forecast and historical) | Open-Meteo forecast and archive (ERA5) | Free and keyless for **non-commercial** use; commercial needs their paid plan | match-time temperature, humidity, dew point, wind, rain, cloud. The archive gives training rows the weather that actually occurred |
| Player qualitative history | Tavily + LLM agent (existing) | per-call | **[done]** `player_insights`, used as auxiliary features later |
| Tennis | deferred | Sackmann data is CC BY-NC-SA (non-commercial) | adapter slot only |

Gaps and how they're filled:
- **Pitch reports**: no free, legal, structured source exists. A **pitch profile** is derived from ball-by-ball history per venue and format: average first-innings score, chasing win rate, share of wickets to spin vs pace, run rate by phase and recent trend. This is quantitative and leak-free, rather than relying on a pundit's text.
- **Ground dimensions and coaching/tactics**: no reliable data. They are not modelled, and the product says so rather than inventing them.
- **Rankings**: computed internally (Elo plus attack/defence ratings per sport and format), so there is no dependency on official ranking feeds.
- **Identity matching** between Cricsheet and CricketData (teams, players, venues): Cricsheet's people register carries cross-reference IDs. Anything not matched goes to a `*_aliases` table with a manual override CLI.

## 4. Repository layout

```
tusky/
├─ packages/
│  ├─ shared/              env, logger, pg-boss queues, zod schemas                    [done]
│  ├─ db/                  Drizzle schema + migrations (single schema owner)           [done, extended per module]
│  └─ providers/           SportAdapter + API-Sports football/basketball               [done]
│                          + cricketData/ adapter (fixtures, toss, XI, live)           [next]
│                          + openMeteo/ weather client                                 [planned]
├─ scheduler/              cron: fixtures, results, status, weather refresh            [done / extended]
├─ scrapper-service/       pg-boss workers: enrich, player history, live poll          [done / live planned]
├─ ml-service/             Python package tusky_ml                                     [done for fb/bb]
│  ├─ tusky_ml/
│  │  ├─ ingest/           cricsheet.py (bulk import → innings, deliveries, venues)    [next]
│  │  ├─ features/         core.py (ratings, Elo, form) · cricket.py · weather.py · players.py
│  │  ├─ models/           score models (fb/bb) · outcome zoo · cricket · live/
│  │  ├─ explain.py        SHAP / linear contributions → factor groups                 [planned]
│  │  ├─ evaluate.py       settle predictions, metrics over time, drift                [planned]
│  │  ├─ registry.py       model_registry rows + artifact store, champion/challenger   [planned]
│  │  ├─ pipeline.py       train (rolling backtest) / predict                          [done]
│  │  ├─ benchmark.py      oracle benchmark on synthetic leagues                       [done]
│  │  └─ cli.py
│  └─ tests/
├─ backend/                FastAPI app (Python), imports tusky_ml                      [planned]
│  ├─ app/{main.py, routers/, schemas/, deps.py, live.py}
│  └─ tests/
├─ frontend/               React + Vite + Tailwind + Recharts                          [planned]
├─ docs/                   ARCHITECTURE.md (this file), API.md, RUNBOOK.md
├─ docker-compose.yml      postgres [done] + redis, scheduler, scraper, ml, api, web   [planned]
└─ .github/workflows/      ci.yml: typecheck, vitest, pytest, image builds            [planned]
```

## 5. Database design

Existing tables are unchanged apart from additive columns. Everything is migrated through Drizzle (`npm run db:generate && npm run db:migrate`).

### 5.1 Core (exists, plus additions)

| Table | Key columns | Notes |
|---|---|---|
| `sports` | code | add a `cricket` seed **[next]** |
| `competitions` | sport, provider, external_id, name, season | + `format` text (`T20`, `ODI`, `Test`, `T20 league`) |
| `teams` | sport, provider, external_id, name | + `team_aliases(team_id, provider, external_id, name)` for cross-source identity |
| `players` | …, history_status | + `player_aliases`, + `batting_hand`, `bowling_style` (cricket) |
| `venues` **[new]** | sport, provider, external_id, name, city, country, lat, lon, timezone | `matches.venue_id` FK. Latitude and longitude drive the weather lookup |
| `matches` | …, home/away_score **[done]** | + `format`, `venue_id`, `toss_winner_team_id`, `toss_decision` (bat/field), `winner_team_id`, `result_type` (normal, tie, no_result, dls, super_over, walkover), `neutral_venue` bool |

For cricket, "home" and "away" mean team 1 and team 2. `home_score`/`away_score` hold total runs, and wickets/overs live in `cricket_innings`.

### 5.2 Cricket **[next]**

```
cricket_innings(id, match_id → matches, innings_no, batting_team_id, bowling_team_id,
                runs, wickets, legal_balls, extras, target, is_super_over,
                pp_runs, pp_wkts, mid_runs, mid_wkts, death_runs, death_wkts)      unique(match_id, innings_no)
deliveries(id bigserial, match_id, innings_no, over, ball, batter_id, bowler_id, non_striker_id,
           runs_batter, runs_extras, extras_kind, is_legal, wicket_kind, player_out_id,
           bowler_type (pace|spin|unknown))                                          index(match_id, innings_no, over, ball)
match_lineups(match_id, team_id, player_id, batting_position, is_captain, is_keeper, source)
```
At roughly 6–8 million rows for all of Cricsheet, `deliveries` is fine on a single Postgres instance with the index shown. It can be partitioned by year later if needed.

### 5.3 Players, availability and weather **[planned]**

```
player_match_stats(match_id, player_id, team_id, role, stats jsonb)   -- per-match box score; cricket rows derived from deliveries
player_availability(player_id, match_id null, status (out|doubtful|available), reason, source, reported_at)
weather_observations(match_id, source, kind (forecast|archive), valid_at, fetched_at,
                     temp_c, humidity, dew_point_c, wind_kph, precip_prob, precip_mm, cloud_pct)
                                                        unique(match_id, kind, source)
```
Training uses `archive` rows, and prediction uses the newest `forecast` row. The model therefore sees forecast-quality inputs live and actual weather in history; this known gap is tracked in drift reports.

### 5.4 ML bookkeeping

```
predictions            [done]   match_id, model_version, p_home/p_draw/p_away, exp scores, details, features
                       + kind (pre_toss | pre_match | live), + explanation jsonb, + confidence (low|medium|high)
                       + locked_at  (set at kick-off: the frozen pre-match prediction used for evaluation)
prediction_snapshots   [planned] match_id, model_version, at, state jsonb, p_*        -- live win-probability timeline
prediction_evaluations [planned] prediction_id, match_id, outcome, log_loss, brier, rps, correct, evaluated_at
model_registry         [planned] version PK, sport, format, kind, family, status (candidate|champion|retired),
                                 trained_at, data_through, backtest jsonb, artifact_uri, params jsonb
drift_reports          [planned] sport, format, window_start, window_end, live_log_loss, backtest_log_loss,
                                 feature_psi jsonb, status (ok|warn|alert)
```

## 6. ML workflow

### 6.1 Pipeline (identical for every sport)

```
history (DB) ─► replay in time order ─► pre-match feature rows ─► rolling-origin backtest per candidate
            └──────────────────────────────────────────────────► (4 expanding folds, newest half of data)
   ─► pick by proper scoring rule (RPS football; log-loss two-way) ─► challenger vs champion on the SAME folds
   ─► promote if better ─► refit on all data ─► registry + artifact
upcoming matches ─► same feature code ─► champion ─► probabilities + markets + explanation + confidence
after full time  ─► settle locked prediction ─► prediction_evaluations ─► drift report ─► retrain trigger
```

Training and prediction share the feature code but are separate entry points (`train` and `predict`). Saved models are loaded for prediction and never retrained per request.

### 6.2 Features

| Group | Football | Basketball | Cricket |
|---|---|---|---|
| Team strength | attack/defence ratings **[done]**, Elo **[done]** | same **[done]** | Elo and batting/bowling ratings **per format** |
| Recent form | EWMA overall and at the venue **[done]**. Windows of 5/10/20 games added as explicit features | same | last 5/10/20 results, run-rate differential, NRR |
| Head to head | last N meetings: win share, goal difference (shrunk toward 0 when N is small) | same | same, per format |
| Venue / pitch | competition scoring level **[done]**, home advantage | same | pitch profile: venue average first-innings score, chasing win %, spin vs pace wicket share, phase run rates |
| Toss | – | – | toss winner and decision, crossed with the venue's chasing win %. Two predictions are made: pre-toss, and post-toss once the toss is known |
| Players / availability | strength of the announced XI vs the usual XI (minutes-weighted ratings), injuries | same, with rotation/back-to-back flags | batting-order strength, bowling-attack strength (pace vs spin), with ratings from ball-by-ball impact per phase |
| Weather | rain, wind, temperature (mostly small effects) | – (indoor) | dew (evening humidity and dew point) favouring chasers, cloud cover helping swing, rain risk feeding DLS / no-result probability |
| Schedule | rest days **[done]**, travel later | rest and back-to-backs **[done]** | days since last match, tournament stage |

Missing data: each optional group gets an explicit `*_missing` indicator plus a neutral fill such as the league mean. Models never see a silently imputed value without its flag. Teams with fewer than 3 prior games are excluded from training but still predicted, with low confidence.

### 6.3 Model families (all compared on the same backtest)

- **Score models** **[done for football/basketball]**: Poisson GLM and gradient-boosted Poisson, giving a Dixon-Coles scoreline grid (football). A points regression gives normal margin/total distributions (basketball). An equal-weight ensemble is also a candidate. Current benchmark: about 65% (football) and 77% (basketball) of the skill gap between base rates and the true-strength oracle is captured.
- **Outcome classifier zoo** **[planned]**: logistic regression, random forest, XGBoost, LightGBM, CatBoost and an MLP (PyTorch), predicting home/draw/away (or win/loss) directly. Hyperparameters are tuned with Optuna **inside** each training fold, with a small trial budget to limit backtest overfitting. If a classifier beats the score model on RPS/log-loss, its home/draw/away is published, and the score grid is re-weighted to match it so that scoreline markets stay consistent.
- **Cricket pre-match** **[next after ingestion]**: a classifier zoo on the §6.2 features for the win probability (ties and no-results handled explicitly). A quantile regressor (LightGBM quantile loss) gives the first-innings score with a 10–90% interval. A second-innings chase probability comes from the live engine run at the start of the chase.
- **Calibration**: isotonic, Platt and temperature calibrators are evaluated **nested** (fitted on earlier folds, scored on later ones) and adopted per sport/format only when held-out log-loss improves. Calibration curves are stored in every report.

### 6.4 Live engines **[planned, cricket first]**

- **Cricket**: a state model trained on every ball in Cricsheet. Its features are innings, runs, wickets, legal balls left, target, required and current run rate, phase, venue par score, remaining batting strength and the pre-match probability as a prior. It is a gradient-boosted classifier with **monotonic constraints** (more wickets lost can't raise the batting side's chance), validated with time-ordered, match-grouped splits. The first-innings projection uses the same states with a quantile regressor.
- **Football**: the remaining-time Poisson model scales each side's rate by the minutes left and adjusts for red cards and the current score. This is principled and needs no new training data.
- **Basketball**: the remaining margin is normal, with a variance proportional to the possessions left.
- Flow: the live-poll worker writes `match_events` and the current state. The live engine computes the probability and publishes it to Redis channel `live:<match_id>`. FastAPI streams it over SSE/WebSocket, and `prediction_snapshots` keeps the timeline.

### 6.5 Explanations and confidence **[planned]**

- **SHAP** (TreeExplainer for tree models, exact linear contributions for GLM/logistic) computes per-feature contributions in log-odds. These are summed into **factor groups** (recent form, head to head, venue/pitch, toss, player availability, weather, home advantage) and shown as signed, ranked factors. The wording says the factor is *associated with* a higher or lower chance; it is never presented as a cause.
- **Confidence** (low/medium/high) combines three things: how far the favourite's probability is from a coin flip, data sufficiency (prior games, missing feature groups, whether the line-up is confirmed), and the model's backtest reliability in that probability band. The reasons are listed with the label.

### 6.6 Evaluation, drift and retraining **[planned]**

- At kick-off the newest pre-match prediction is **locked**. After the result arrives (the daily results sync), it is settled into `prediction_evaluations` with log-loss, Brier, RPS, correctness and ROC-AUC per window. Precision, recall and F1 are reported for the favourite-wins framing, but they are secondary to the proper scoring rules.
- Drift is checked weekly. It compares the rolling 30/90-day live log-loss with the champion's backtest, using PSI on key features. A warning or alert writes a `drift_reports` row.
- Retraining is triggered when at least N new settled matches exist (default 50 per sport/format), when a drift alert fires, or weekly. The challenger must match or beat the champion on the identical backtest folds before promotion, and every promotion is recorded in `model_registry`.

## 7. API (FastAPI) **[planned]**

| Method and path | Returns |
|---|---|
| `GET /health` | DB, Redis, model availability |
| `GET /matches?sport&status&date_from&date_to&competition` | list, with the newest prediction summary |
| `GET /matches/{id}` | match, venue, weather, lineups, prediction (probabilities, markets, confidence, factors) |
| `GET /matches/{id}/predictions` | every model version's prediction plus the locked one |
| `GET /matches/{id}/live` (SSE) and `WS /ws/live/{id}` | live win-probability stream |
| `GET /teams/{id}` · `/teams/{id}/form` · `/teams/{a}/h2h/{b}` | ratings over time, home/away record, head to head |
| `GET /players/{id}` · `/players/compare?ids=` | per-match stats, form, availability, insights (manual beats LLM) |
| `GET /venues/{id}` | pitch profile, results history, weather climatology |
| `GET /predictions/history?sport&from&to` | settled predictions vs results, accuracy and calibration over time |
| `GET /models` · `/models/{version}` | registry, backtest metrics, calibration curves, champion history |

Plus OpenAPI docs at `/docs`. API keys and Redis token-bucket rate limiting (the "later" item from phase 1) live in middleware.

## 8. Frontend **[planned, after the ML is validated]**

React (Vite), Tailwind and Recharts, reading only from the API:
- **Dashboard**: today's, upcoming, live and completed matches, with probability bars.
- **Match page**: team comparison, probability visual, predicted favourite with confidence, factor list, markets, and the live win-probability chart.
- **Team analytics**: rating trend, form, home/away, head to head.
- **Player analytics**: form charts, comparisons, availability.
- **Venue and weather**: pitch profile, forecast.
- **Prediction history**: predicted vs actual, rolling log-loss and accuracy, calibration curve, model timeline.

## 9. Deployment **[planned]**

- `docker-compose.yml` services: `postgres` (exists), `redis`, `scheduler`, `scraper`, `ml` (`tusky_ml run` loop), `api` (uvicorn), `web` (nginx serving the build). Model artifacts live on a named volume, or S3-compatible storage in the cloud.
- GitHub Actions `ci.yml`: `npm run typecheck`, `npm test`, `pytest` (with a Postgres service container) and image builds. Deploy-on-tag to a container host comes later.
- Secrets come only from the environment. `.env.example` documents every key.

## 10. Build order

| # | Module | Done when |
|---|---|---|
| 0 | Football/basketball ingestion and score models **[done]** | backfill, train, predict, store; 41 TS + 15 Python tests green |
| 1 | **Cricket ingestion [done 2026-11-24; CricketData adapter unverified]**: schema (venues, innings, deliveries, lineups, match additions), Cricsheet importer, CricketData adapter for fixtures/toss/XI | full Cricsheet import is idempotent; row counts reconcile with the source; fixtures appear in `matches` |
| 2 | **[done 2026-11-24]** Cricket features and pre-match model: pitch profile, toss, format ratings, player ratings, zoo plus first-innings quantiles | backtest per format beats baseline; report saved |
| 3 | **[next]** Weather (Open-Meteo forecast and archive) and venues for all sports | features added; kept only if the backtest improves |
| 4 | Model zoo, Optuna, model registry and champion/challenger for all sports | registry rows; promotion rule enforced in tests |
| 5 | Explanations and confidence | factor groups on every prediction |
| 6 | FastAPI backend and Redis | endpoints in §7 with tests; OpenAPI docs |
| 7 | Evaluation loop, drift and auto-retrain | settled history; drift report; retrain trigger |
| 8 | Live engines (cricket, then football/basketball) | live stream; backtested on historical ball states |
| 9 | React dashboard | sections in §8 |
| 10 | Docker, CI and deployment docs | `docker compose up` runs everything; CI green |
| later | Tennis (needs a commercially licensed source), player performance predictions, Monte Carlo tournament simulation | |

Each module ships with its own README section: what it does, why it's needed, how to install, run and test it. Each one also gets an update to AGENT_CONTEXT.md.
