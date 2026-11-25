# TUSKY — Stage 1 Frontend

Premium sports-analytics & prediction platform UI, built with **React 19 + Tailwind CSS v4 + Chart.js** (Vite).

> **Stage 1 is a frontend demo.** Authentication, payments, the free trial and admin edits are simulated with
> `localStorage` (all keys start with `tusky_demo_`). Nothing is secure and no money moves. Stage 2 connects
> the same screens to Core PHP + MySQL, a real payment gateway, sports/news APIs and the tusky prediction engine.

## Run it (VS Code)

Requires Node.js 18+.

```powershell
cd frontend/PREDICTX
npm install
npm run dev
```

Open the URL Vite prints (default http://localhost:5173).

### Run with Live Server instead

```powershell
npm run build
```

Then in VS Code right-click `frontend/PREDICTX/dist/index.html` → **Open with Live Server**.
The app uses hash routes (`#/user/dashboard`) and relative asset paths, so the built folder works on any static server.

## Demo accounts

| Area  | Email             | Password    |
|-------|-------------------|-------------|
| User  | demo@tusky.app    | Demo@1234   |
| Admin | admin@tusky.app   | Admin@1234  |

You can also register new users — they are stored only in your browser.
**Reset demo data** (User → Settings, or Admin → Settings) wipes all `tusky_demo_*` keys and restores the samples.

## Pages

| Brief file                      | Route                         |
|---------------------------------|-------------------------------|
| index.html                      | `#/` (About: `#/about`)       |
| login.html / register.html      | `#/login`, `#/register`       |
| pricing.html / sports.html / news.html | `#/pricing`, `#/sports`, `#/news` |
| user/dashboard.html             | `#/user/dashboard`            |
| user/matches.html               | `#/user/matches`              |
| user/predictions.html           | `#/user/predictions`          |
| user/match-details.html         | `#/user/match/:id` (one page per match) |
| user/purchases.html             | `#/user/purchases`            |
| user/subscription.html          | `#/user/subscription`         |
| user/free-trial.html            | `#/user/free-trial`           |
| user/wallet.html                | `#/user/wallet` (+ `#/user/transactions`) |
| user/profile.html               | `#/user/profile` (+ `#/user/settings`) |
| admin/login.html                | `#/admin/login`               |
| admin/dashboard.html … analytics.html | `#/admin/dashboard`, `users`, `matches`, `predictions`, `news`, `subscriptions`, `transactions`, `analytics`, `settings` |

## Project structure

```
src/
  data/demo/     Sample data only (matches, predictions, news, users, plans, analytics…)
  services/      The data layer — every page talks to these, never to localStorage directly
  context/       Auth (demo sessions) and toast notifications
  hooks/         useAsync — loading states + auto-refresh when demo data changes
  components/    ui/ (buttons, modal, table…), layout/, match/, charts/, sections/
  pages/         public/, user/, admin/
  styles/        style.css (tokens + reusable classes), dashboard.css, admin.css, responsive.css
public/assets/   images/sports, logos, icons (original SVG artwork)
```

## Key behaviours

- **Per-match unlocks** — `purchases[userId][matchId]`; `unlockReason()` in `services/purchases.js` is the single
  check. Buying one prediction never unlocks another. An active subscription is a separate "unlock all" flag.
- **Free trial** — one per user; picking a match unlocks only that match, status becomes `used` and survives refresh.
- **Demo payment modal** — UPI / Card / Net Banking / Wallet options, processing state, confirmation, then the
  purchase, transaction, notification and activity entry are recorded.
- **Admin** — CRUD + publish for matches, predictions and news (with image upload), user block/unblock, subscription and
  transaction views, and six Chart.js revenue charts with Today / 7 / 30 / 90-day filters. Sample figures are labelled;
  demo purchases made in the browser are added on top.

## Stage 2 integration map

Each service function documents its intended endpoint. Replace the `simulate(...)` body with `http(...)` from
`services/api.js` and set `USE_PHP_API = true`.

| Service (src/services)          | PHP endpoint (suggested)                              |
|---------------------------------|-------------------------------------------------------|
| `auth.register / login / logout`| `POST /api/auth/register.php`, `login.php`, `logout.php`; `GET /api/auth/me.php` |
| `auth.adminLogin`               | `POST /api/admin/login.php` (separate admins table)   |
| `matches.getMatches / getMatch` | `GET /api/matches.php`                                |
| `matches.getPrediction`         | `GET /api/predictions.php?match_id=` — **server returns numbers only if unlocked** |
| `purchases.purchaseMatch`       | `POST /api/payments/create-order.php` → gateway → `POST /api/payments/verify.php` |
| `purchases.subscribe / cancel`  | `POST /api/subscriptions.php`                         |
| `purchases.topUpWallet`         | `POST /api/wallet.php`                                |
| `trial.activateTrial`           | `POST /api/trial/activate.php` (UNIQUE user_id in `free_trials`) |
| `news.*`                        | `GET /api/news.php`, `POST/PUT/DELETE /api/admin/news.php`, uploads via `/api/admin/upload.php` |
| `admin.*`                       | `/api/admin/users.php`, `transactions.php`, `subscriptions.php`, `analytics.php` |
| `notifications.*`               | `/api/notifications.php`, `/api/activity.php`         |

Suggested MySQL tables mirror `services/db.js`: `users`, `admins`, `matches`, `predictions`, `news`, `purchases`,
`transactions`, `subscriptions`, `free_trials`, `wallets`, `notifications`, `activity_log`.

All client-side validation in `utils/validation.js` must be repeated in PHP.
