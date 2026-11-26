# TUSKY — Frontend

Sports-analytics & prediction platform UI: **React 19 + Tailwind CSS v4 + Chart.js** (Vite).
All data comes from the PREDICTX API in `backend/PREDICTX` (Express + Prisma + MySQL).

## Run

Start the API first (see `backend/PREDICTX/README.md`), then:

```powershell
cd frontend/PREDICTX
npm install
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` and `/uploads` to `http://localhost:5000`;
set `VITE_API_PROXY` to point elsewhere.

Production build:

```powershell
npm run build
```

Serve `dist/` from the same domain as the API, with `/api` and `/uploads` proxied to it, so the
login cookie stays first-party. The app uses hash routes (`#/user/dashboard`), so no rewrite rules are needed.

## Accounts

- **Users** register at `#/register`.
- **Admins** are created on the server (`npm run db:seed` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`,
  or `npm run create-admin`). They sign in at `#/admin/login`.

## How it talks to the API

- `src/services/api.js` is the single HTTP client:
  - **Tokens**: access tokens are kept in memory only.
  - **Expired sessions**: on a 401 it refreshes once using the httpOnly cookie, then retries.
  - **Live lists**: after any change, open lists re-fetch (`hooks/useAsync`).
- User and admin sessions are separate, with different cookies and tokens. They are restored on reload by `context/AuthContext.jsx`.
- `src/services/*` map one-to-one to API areas: `auth`, `matches` (sports, matches, gated
  predictions), `purchases` (payments, wallet, subscriptions, dashboard), `trial`, `news`, `notifications`, `admin`.
- **Locked predictions are filtered by the server.** For a locked match the browser only receives the
  price and lock status; the blur on the page hides placeholder text, not real data.
- **Payments** use Razorpay Checkout (`services/purchases.js → payOnline`):
  1. The server creates the order using the price from MySQL.
  2. The browser opens Razorpay Checkout.
  3. The server verifies the payment before anything unlocks.
- `localStorage` holds only harmless display preferences (`tusky_pref_*`).

## Pages

| Area | Routes |
|---|---|
| Public | `#/`, `#/about`, `#/sports`, `#/news`, `#/pricing`, `#/login`, `#/register`, `#/reset-password` |
| User | `#/user/dashboard`, `sports`, `matches`, `predictions`, `match/:id`, `news`, `purchases`, `subscription`, `free-trial`, `wallet`, `transactions`, `profile`, `settings` |
| Admin | `#/admin/login`, `dashboard`, `users`, `matches`, `predictions`, `news`, `subscriptions`, `transactions`, `analytics`, `settings` |

Content seeded for development is marked **Sample** in the UI.
