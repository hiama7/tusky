# PREDICTX API (TUSKY backend)

REST API for the TUSKY sports-prediction platform: authentication, sports & matches,
server-gated predictions, per-match purchases, a one-time free trial, subscriptions,
Razorpay payments, a wallet, news, dashboards and revenue analytics.

**Stack:** Node.js 20+ · Express 5 (ES modules) · MySQL 8 (or MariaDB 10.6+) · Prisma 7 ·
JWT + bcrypt · Zod · Helmet · express-rate-limit · Multer · Razorpay · Nodemailer.

The React frontend lives in `frontend/PREDICTX` and talks to this API through `/api`.

---

## 1. Project layout

```
backend/PREDICTX/
  prisma/
    schema.prisma        database schema (24 tables)
    migrations/          SQL migrations (commit these)
    seed.js, seed-data.js  sports, plans, first admin, optional SAMPLE content
  src/
    config/              env validation, Prisma client, Razorpay client
    middleware/          auth, admin, validation, rate limits, uploads, errors, CSRF origin check
    routes/              one router per area (auth, matches, predictions, payments, …, admin)
    controllers/         HTTP handlers
    services/            business logic: auth, predictions/access, trial, payments, subscriptions,
                         analytics, notifications, email, sports-data integrations, serializers
    validators/          Zod request schemas
    utils/               responses, tokens, money, logger
    app.js               Express app (exported for tests)
  server.js              entry point
  scripts/create-admin.js  protected CLI to create/promote an admin
  tests/                 Vitest + Supertest suite (47 tests)
  docs/API.md            endpoint reference
```

## 2. Install

```powershell
cd backend/PREDICTX
npm install
Copy-Item .env.example .env
```

Fill in `.env` (see section 4). Generate the two JWT secrets with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 3. MySQL setup

Pick one.

**A. Docker (MySQL 8.4)** — a `predictx-mysql` service is in the repo's `docker-compose.yml`:

```powershell
docker compose up -d predictx-mysql
```

It listens on port **3307** with database `predictx`, user `predictx` / password `predictx`
(override with `PREDICTX_MYSQL_PASSWORD`). Create the test database once:

```powershell
docker exec predictx-mysql mysql -uroot -ppredictx_root -e "CREATE DATABASE predictx_test; GRANT ALL ON predictx_test.* TO 'predictx'@'%';"
```

**B. XAMPP (MariaDB 10.11) or a local MySQL** — start MySQL from the XAMPP control panel, then
in phpMyAdmin → SQL (or the `mysql` client) run, with your own password:

```sql
CREATE DATABASE predictx CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE predictx_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'predictx'@'localhost' IDENTIFIED BY 'choose-a-password';
CREATE USER 'predictx'@'127.0.0.1' IDENTIFIED BY 'choose-a-password';
GRANT ALL PRIVILEGES ON `predictx%`.* TO 'predictx'@'localhost', 'predictx'@'127.0.0.1';
-- Prisma's `migrate dev` needs to create a temporary "shadow" database:
GRANT CREATE, DROP ON *.* TO 'predictx'@'localhost', 'predictx'@'127.0.0.1';
```

and set `DATABASE_URL=mysql://predictx:choose-a-password@127.0.0.1:3306/predictx`.

## 4. Environment variables

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` / `production` / `test` |
| `PORT` | API port (default 5000) |
| `APP_URL` | URL of the React app (password-reset links) |
| `CORS_ORIGINS` | Comma-separated allowed browser origins |
| `DATABASE_URL` / `TEST_DATABASE_URL` | MySQL connection strings (test DB name must end in `_test`) |
| `JWT_ACCESS_SECRET` / `JWT_ADMIN_ACCESS_SECRET` | ≥32-char secrets; user and admin tokens use different ones |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL_DAYS` | Default 15 min / 7 days |
| `BCRYPT_ROUNDS` | Password hashing cost (12 recommended in production) |
| `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | First admin, used by the seed and `create-admin` |
| `SEED_DEMO_DATA` | `true` seeds clearly-labelled sample matches/predictions/news |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Payment gateway |
| `SMTP_*`, `MAIL_FROM` | Email; without `SMTP_HOST` (dev) emails are written to the server log |
| `UPLOAD_MAX_MB` | Image upload limit (default 2) |
| `SPORTS_DATA_PROVIDER`, `NEWS_PROVIDER` (+ keys) | Future external data providers (`manual` / `none` today) |
| `REPORT_TZ_OFFSET_MINUTES` | Revenue reports group by this local day (330 = IST) |

`.env` is git-ignored. Never commit it, and never put secrets in the React app.

## 5. Database: migrations and seed

```powershell
npx prisma migrate dev        # development: applies migrations (creates the DB schema)
npm run db:deploy             # production / CI: applies committed migrations only
npm run db:seed               # sports, plans, first admin, optional sample content
```

`npm run db:reset` drops and recreates the development database — it deletes all data.

The seed is idempotent: run it again safely. Sample content is stored with `isDemo = true`
and shown in the UI with a "Sample" label.

### Creating admins

Admins are never created through the website. Either set `ADMIN_EMAIL` / `ADMIN_PASSWORD`
before `npm run db:seed`, or use the CLI (the password is typed hidden, or read from
`ADMIN_PASSWORD`; it is never a command-line argument):

```powershell
npm run create-admin -- --email you@yourdomain.com --name "Your Name"
```

Running it for an existing account promotes it to admin, resets its password and signs out its sessions.

## 6. Run

```powershell
npm run dev      # restarts on changes in src/
npm start        # production-style, no file watching
```

Health check: `GET http://localhost:5000/api/health`.

> If the repo is inside a OneDrive-synced folder, sync activity can trigger watch-mode
> restarts. Use `npm start` if the dev server restarts unexpectedly.

## 7. Connect the React frontend

```powershell
cd frontend/PREDICTX
npm install
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` and `/uploads` to `http://localhost:5000`
(override with `VITE_API_PROXY`). Because the app and API share one origin, the refresh-token
cookie stays first-party and `SameSite=Strict`.

In production, serve the built `frontend/PREDICTX/dist` and proxy `/api` + `/uploads` to this
API from the same domain (see section 11).

## 8. Razorpay test mode

1. Create a Razorpay account and switch the dashboard to **Test Mode**.
2. Settings → API Keys → generate a key pair. Put `rzp_test_…` in `RAZORPAY_KEY_ID` and the
   secret in `RAZORPAY_KEY_SECRET`.
3. Settings → Webhooks → add `https://<your-public-url>/api/payments/webhook` with events
   `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, `refund.failed`,
   and a secret → `RAZORPAY_WEBHOOK_SECRET`. For local testing, expose port 5000 with a tunnel
   (e.g. ngrok or cloudflared).
4. Restart the API. `GET /api/health` should report `"payments": "razorpay"`.
5. Pay in the app with Razorpay's test cards/UPI IDs listed in their documentation.

Without keys the API runs normally, but creating a payment returns **503 "Online payments are
not configured"**; the free trial and wallet payments still work.

How a payment is trusted:

1. `POST /api/payments/orders` — the server reads the price from MySQL and creates a Razorpay order.
2. The browser opens Razorpay Checkout.
3. `POST /api/payments/verify` — the server checks the HMAC signature **and** fetches the payment
   from Razorpay to confirm status, order id, amount and currency.
4. Only then does it grant access, inside a database transaction that locks the transaction row,
   so the browser callback and the webhook can both arrive any number of times and access is
   granted exactly once.

## 9. Tests

```powershell
npm test
```

47 tests run against `TEST_DATABASE_URL` (schema is migrated automatically; existing data
is left alone). Covered:

- **Auth**: validation, role injection, duplicate email, refresh rotation and reuse
  detection, CSRF origin check, logout, blocked users, forged tokens, admin/user separation,
  profile, password change, forgot/reset password.
- **Access control**: locked responses contain no prediction data (lists and detail),
  unpublished content hidden, SQL-injection-style input, malformed JSON.
- **Free trial**: unlocks one match only, can't be reused, 5 concurrent activations → exactly one.
- **Payments**: server price ignores client price, forged signature, underpaid/failed payments,
  idempotent verify, cross-user order access, webhook signature, duplicate webhooks, wallet
  top-up and pay, concurrent wallet double-spend, subscription sport coverage and renewals,
  refunds revoking access and net revenue.
- **Admin**: catalogue, match create/publish/archive, probability validation (2- and 3-way),
  prediction versions, news uploads (real image vs disguised script), scheduled news,
  block/unblock, analytics ranges, audit log.
- **Rate limiting**: login returns 429 after 10 attempts.

Only Razorpay's HTTP calls are mocked; signatures are verified with real HMACs.

## 10. Security summary

- bcrypt password hashes; password hashes never leave the server.
- 15-minute access JWTs kept in memory by the app. User and admin tokens are signed with
  different secrets and audiences.
- Rotating refresh tokens in `httpOnly`, `SameSite=Strict` cookies, stored as SHA-256 hashes.
  Replaying an old token revokes the whole session family.
- Role and account status are re-read from MySQL on every request, so blocking or demoting
  takes effect immediately.
- Zod validation on every input; unknown fields (e.g. `role`, `price`) are dropped.
- Prisma parameterised queries; Helmet; CORS allow-list; origin check on cookie endpoints.
- Rate limits on login, registration, password reset, payments and the whole API.
- Uploads: 2 MB limit, type detected from file bytes (JPEG/PNG/WebP only), random names.
- Admin actions are written to `admin_logs`.
- Production errors never include stack traces.

## 11. Deployment checklist

1. MySQL 8 with a dedicated user; set `DATABASE_URL`.
2. Set `NODE_ENV=production`, strong JWT secrets, `BCRYPT_ROUNDS=12`, real SMTP,
   `APP_URL` / `CORS_ORIGINS` to your HTTPS domain, and live Razorpay keys + webhook secret.
   Set `SEED_DEMO_DATA=false`.
3. `npm ci && npx prisma generate && npm run db:deploy && npm run db:seed`, then create
   admins with `npm run create-admin`.
4. Run `npm start` under a process manager (systemd, PM2 or a container).
5. Put a reverse proxy (nginx/Caddy) in front with HTTPS. Serve `frontend/PREDICTX/dist` and
   proxy `/api` and `/uploads` to the API on the same domain. The app trusts one proxy hop
   (`trust proxy = 1`) so secure cookies and rate limits use the real client IP.
6. Back up the database and the `uploads/` folder. Run more than one instance only with a
   shared rate-limit store (e.g. Redis) and shared upload storage.

## 12. Future integrations

`src/services/sportsDataService.js` defines provider interfaces for fixtures/results and news.
Register an adapter and set `SPORTS_DATA_PROVIDER` / `NEWS_PROVIDER`. Imported news is always
saved as a **draft** for admin approval.

Predictions record their `source` (`MANUAL` or `MODEL` plus `modelVersion`). Every publish
stores an immutable snapshot in `prediction_versions`. Verified match results live in
`match_results`, separate from predictions, and
`GET /api/admin/analytics/overview` reports accuracy using only predictions published before
kick-off.

## ML predictions

The TUSKY ML service (`ml-service/`) stores its predictions in the TUSKY Postgres. The backend copies them into PREDICTX; the frontend needs nothing else, because they arrive as ordinary matches and predictions behind the same paywall.

```powershell
docker compose up -d postgres          # TUSKY database (from the repository root)
npm run ml:predict                     # (repository root) refresh the model's predictions
npm run db:deploy                      # (backend/PREDICTX) once, adds matches.externalId
npm run ml:sync                        # import as drafts
npm run ml:sync -- --publish --days 3  # or publish the next three days
```

- Set `ML_DATABASE_URL` in `.env` (see `.env.example`). The ML database is only read.
- Admins can also import drafts with **Sync ML model** on the Predictions page, then publish them one by one.
- `ML_SYNC_INTERVAL_MINUTES` runs the sync automatically; it imports drafts unless `ML_SYNC_PUBLISH=true`.
- Only upcoming matches are imported or changed, so a stored prediction is always a pre-match one. Results of imported matches are recorded when the ML service has them.
- A sync never overwrites a `MANUAL` prediction or result, never republishes a prediction an admin unpublished, and leaves a match's price and flags alone. It can replace edits to a prediction whose source is still `MODEL`.
- A published prediction changes only on a `--publish` sync, as a new version.
- The confidence label says how decisive the probabilities are (three outcomes: High from 60%, Medium from 45%; two outcomes: 70% and 58%). It is not an accuracy figure.
- The model uses past results only. Player analysis, strengths, pitch and weather are left empty.
- Before charging for these predictions, replace or license the development-only data behind them (see `docs/reports/final-report-2026-11.md`, section 8).

## Two-factor sign-in for administrators

Optional, per administrator: **Admin → Settings → Two-factor sign-in**. It adds a code from an
authenticator app (TOTP) to the password and gives eight one-use recovery codes. Turning it on
signs out that account's other admin sessions.

- `ADMIN_2FA_KEY` encrypts the stored secrets. If empty, the key is derived from
  `JWT_ADMIN_ACCESS_SECRET`, so changing that secret then breaks existing enrolments.
- Lost both the phone and the recovery codes: on the server run
  `npm run admin:2fa-reset -- --email admin@yourdomain.com`.
- It protects the admin area only. A user-area password reset does not remove it.
