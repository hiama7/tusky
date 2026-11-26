# PREDICTX API reference

Base URL: `/api` (development: `http://localhost:5000/api`, or `/api` through the Vite proxy).

All responses are JSON:

```json
{ "success": true,  "message": "Operation completed successfully", "data": {} }
{ "success": false, "message": "Validation failed", "errors": [{ "field": "email", "message": "Enter a valid email address" }] }
```

Status codes: 200 OK · 201 Created · 400 Bad request · 401 Not authenticated / session expired ·
402 Payment not completed · 403 Forbidden or blocked · 404 Not found · 409 Conflict ·
413 Upload too large · 422 Validation error · 429 Too many requests · 500 Server error ·
503 Payments not configured.

Lists accept `?page=` and `?limit=` and return `{ items, pagination: { page, limit, total, pages } }`.

**Auth legend**
- *Public*: no token needed.
- *Optional*: works anonymously; with a user token the response includes your unlock status.
- *User*: requires `Authorization: Bearer <user access token>`.
- *Admin*: requires `Authorization: Bearer <admin access token>` and role ADMIN.

---

## Auth — `/api/auth`

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /register` | Public | `{ fullName, email, phone, password, confirmPassword }` | 201 `{ user }`. Role is always USER. Rate-limited. |
| `POST /login` | Public | `{ email, password }` | `{ accessToken, user }` + sets `px_rt` refresh cookie. 10 attempts / 15 min. |
| `POST /refresh` | Cookie | — | Rotates the cookie and returns `{ accessToken, user }`. |
| `POST /logout` | Cookie | — | Revokes the session. |
| `GET /me` | User | — | `{ user }` |
| `PATCH /me` | User | `{ fullName?, email?, phone? }` | `{ user }` |
| `POST /change-password` | User | `{ currentPassword, newPassword, confirmPassword }` | Signs out other devices; returns a new `{ accessToken }`. |
| `POST /forgot-password` | Public | `{ email }` | Always 200 (doesn't reveal accounts). Emails a 30-minute link. |
| `POST /reset-password` | Public | `{ token, password, confirmPassword }` | One-time use; revokes all sessions. |
| `POST /admin/login` | Public | `{ email, password }` | Admin accounts only; sets `px_art` cookie. |
| `POST /admin/refresh` · `POST /admin/logout` | Cookie | — | Separate admin session. |
| `GET /admin/me` · `POST /admin/change-password` | Admin | as above | |

Example login response:

```json
{ "success": true, "message": "Logged in successfully",
  "data": { "accessToken": "eyJ…", "user": { "id": 2, "name": "Asha Rao", "email": "asha@example.com", "role": "USER", "status": "Active" } } }
```

## Catalogue

| Method & path | Auth | Notes |
|---|---|---|
| `GET /sports` | Public | `{ sports: [{ id: "cricket", name, image, color, outcomeFormat, upcomingMatches }] }` |
| `GET /sports/:slug` | Public | Sport with its tournaments |
| `GET /tournaments?sport=` | Public | Tournaments that have published matches |
| `GET /matches` | Optional | Filters: `sport, tournament, status, from, to, q, featured, upcoming`. Each item includes `unlocked` / `unlockReason` for the caller. |
| `GET /matches/:id` | Optional | `{ match }` — published matches only |
| `GET /matches/results` | Public | Completed matches with results |

Match object:

```json
{ "id": 1, "sport": "cricket", "sportName": "Cricket", "outcomeFormat": "TWO_WAY", "tournament": "T20 World Series",
  "teamA": { "id": 1, "name": "India", "short": "IND", "color": "#1E6BFF" }, "teamB": { … },
  "venue": "…", "conditions": "…", "date": "2026-11-27T14:00:00.000Z", "price": 49, "status": "UPCOMING",
  "published": true, "featured": true, "hasPrediction": true, "isDemo": true, "unlocked": false, "unlockReason": null }
```

## Predictions (server-gated)

| Method & path | Auth | Notes |
|---|---|---|
| `GET /matches/:id/prediction` (also `GET /predictions/:id`) | Optional | `:id` is the match id. See below. |
| `GET /predictions` | Optional | Published predictions with lock state; `preview` is included **only** when unlocked. |
| `POST /predictions/:id/purchase` | User | Creates a Razorpay order for that match (same as `POST /payments/orders`). |

Locked (no entitlement), with no probabilities, outcome, confidence or analysis:

```json
{ "locked": true, "matchId": 1, "price": 49, "available": true }
```

Unlocked (purchase → free trial → subscription covering the sport, checked in that order):

```json
{ "locked": false, "unlockReason": "purchase",
  "prediction": { "probA": 65, "probB": 35, "probDraw": null, "predictedOutcome": "TEAM_A", "confidence": "High",
    "summary": "…", "teamA": { "form": ["W","W"], "strengths": [], "weaknesses": [] }, "teamB": { … },
    "players": [], "h2h": { "played": 31, "aWins": 19, "bWins": 11, "draws": 1 }, "insights": [],
    "pitch": "…", "weather": null, "source": "MANUAL", "version": 1, "publishedAt": "…" } }
```

## Free trial — `/api/trial`

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `GET /status` | User | — | `{ status: "available" | "used", matchId, activatedAt, match }` |
| `POST /activate` | User | `{ matchId }` | 201. 409 if already used (enforced by a UNIQUE constraint and a row lock). 400 for matches without a published prediction or already completed/cancelled. |

## Payments — `/api/payments`

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /orders` | User | `{ type: "PREDICTION", matchId }` · `{ type: "SUBSCRIPTION", planId }` · `{ type: "WALLET_TOPUP", amount }` | Price comes from the database. Top-ups are whole ₹10–₹10,000. Returns `{ order: { orderId, amount, amountPaise, currency, keyId, description, prefill, reference } }`. 409 if already owned, 503 without Razorpay keys. |
| `POST /verify` | User | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` | Verifies the signature and confirms with Razorpay, then grants access. Idempotent (`alreadyProcessed: true` on repeats). 400 bad signature or amount; 402 payment failed or not captured. |
| `POST /failure` | User | `{ orderId, reason? }` | Marks an abandoned or failed checkout. |
| `POST /wallet` | User | `{ type: "PREDICTION", matchId }` or `{ type: "SUBSCRIPTION", planId }` | Pays from the wallet. 402 if the balance is too low. |
| `POST /webhook` | Razorpay signature | raw Razorpay event | Verifies `X-Razorpay-Signature` over the raw body and de-duplicates on `X-Razorpay-Event-Id`. Handles `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, `refund.failed`. |

## Subscriptions — `/api/subscriptions`

| Method & path | Auth | Notes |
|---|---|---|
| `GET /plans` | Public | Active plans: `{ id, code, name, price, days, period, features, allSports, sports }` |
| `GET /me` | User | `{ current, queued, history }` |
| `POST /purchase` | User | `{ planId }` → Razorpay order. Buying while active queues a renewal after the current period. |
| `POST /cancel` | User | Cancels active and queued periods immediately. |

## User data — `/api/users/me`, `/api/notifications`

| Method & path | Auth | Notes |
|---|---|---|
| `GET /users/me/dashboard` | User | Profile, stats, trial, current subscription, recent purchases/transactions, notifications, activity |
| `GET /users/me/purchases` | User | Unlocked matches (purchases + free trial) |
| `GET /users/me/transactions?type=prediction|subscription|wallet` | User | Own transactions only |
| `GET /users/me/wallet` | User | `{ balance, totalAdded, totalSpent, entries }` |
| `GET /users/me/activity` | User | Activity timeline |
| `PUT /users/me/favourites` | User | `{ sports: ["cricket","football"] }` |
| `GET /notifications` | User | `{ items, unread }` |
| `POST /notifications/read-all` · `POST /notifications/:id/read` | User | |

## News — `/api/news`

| Method & path | Auth | Notes |
|---|---|---|
| `GET /news` | Public | Filters: `category, q, featured, trending, page, limit`. Only published articles whose publish time has passed. |
| `GET /news/categories` | Public | Category counts |
| `GET /news/:idOrSlug` | Public | Full article (`body`); increments views |

## Admin — `/api/admin` (all Admin)

| Area | Endpoints |
|---|---|
| Dashboard | `GET /dashboard` — users, subscribers, matches by status, predictions, purchases, transactions, refunds, revenue (gross / refunds / net for today, week, month, year and all time; subscription vs prediction), 30-day series, sales by sport |
| Analytics | `GET /analytics/revenue?range=today|7d|30d|90d|12w|12m|5y` → `{ labels, predictions, subscriptions, gross, refunds, net, failedPayments, newSubscriptions }`; `GET /analytics/overview` → weekly/monthly/yearly series, subscriber growth, prediction accuracy, sales by sport |
| Users | `GET /users?q=&status=Active|Blocked&subscription=Active|Expired|None`; `GET /users/:id` (purchases, subscriptions, trial, transactions, wallet); `PATCH /users/:id/status { status: "ACTIVE"|"BLOCKED" }` — blocking signs the user out everywhere |
| Catalogue | `GET /catalogue`; `POST /sports`, `PUT /sports/:id` `{ name, outcomeFormat, color?, description?, status? }`; `POST /teams`, `PUT /teams/:id`, `DELETE /teams/:id` `{ sportId, name, shortName?, color?, country? }` (multipart `logo` optional); `POST /tournaments`, `PUT /tournaments/:id` `{ sportId, name, season? }` |
| Matches | `GET /matches?status=published|draft|archived&q=`; `POST /matches`, `PUT /matches/:id` (multipart or JSON): `sportId, tournamentId|tournamentName, teamAId|teamAName, teamBId|teamBName, startsAt, venue, conditions?, predictionPrice, status, published?, featured?, image?, removeImage?`; `PATCH /matches/:id { status?, published?, featured?, predictionPrice? }`; `DELETE /matches/:id` (archives when sales exist); `PUT /matches/:id/result { outcome: TEAM_A|TEAM_B|DRAW, scoreSummary?, resultDescription, completedAt?, verified? }` |
| Predictions | `GET /predictions?status=published|draft&q=`; `GET /predictions/:id` (with version history); `POST /predictions` and `PUT /predictions/:id` (see below); `POST /predictions/:id/publish`; `POST /predictions/:id/unpublish`; `DELETE /predictions/:id` (409 once customers have unlocked it) |
| News | `GET /news`; `POST /news`, `PUT /news/:id` (multipart): `title, description, content, category, status: DRAFT|PUBLISHED|UNPUBLISHED, publishedAt? (future = scheduled), featured?, trending?, image?, removeImage?`; `PATCH /news/:id/status { status }`; `DELETE /news/:id` |
| Payments | `GET /transactions?q=&status=Success|Pending|Failed|Refunded&type=`; `POST /transactions/:id/refund { amount?, reason }` (full refund revokes access) |
| Subscriptions | `GET /subscriptions?status=Active|Expired|Cancelled`; `GET /plans`; `POST /plans`, `PUT /plans/:id` `{ code, planName, description?, price, durationDays, features[], allSports, sportIds[], popular, sortOrder, status }` |
| Audit & integrations | `GET /logs`; `GET /integrations`; `POST /integrations/news/import` (saves imports as drafts) |

Prediction body:

```json
{ "matchId": 17, "outcomeFormat": "THREE_WAY",
  "teamAProbability": 50, "teamBProbability": 20, "drawProbability": 30,
  "predictedOutcome": "TEAM_A", "confidenceLevel": "MEDIUM",
  "summary": "At least 20 characters of reasoning…",
  "teamA": { "strengths": ["…"], "weaknesses": ["…"], "form": ["W","D","L"] },
  "teamB": { "strengths": [], "weaknesses": [], "form": [] },
  "players": [{ "name": "…", "team": "A", "stat": "…", "rating": 80 }],
  "headToHead": { "played": 10, "aWins": 5, "bWins": 3, "draws": 2 },
  "keyFactors": ["…"], "pitchAnalysis": null, "weatherAnalysis": null,
  "source": "MANUAL", "modelVersion": null, "publish": true }
```

Probabilities must total exactly 100: A + B for `TWO_WAY` (no draw allowed); A + B + Draw for
`THREE_WAY` (draw required). Each publish increments `version` and stores an immutable snapshot.
