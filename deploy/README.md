# Launching TUSKY

**Do not launch for payment until** a lawyer has answered the questions in
`docs/reports/phase2-legal-2026-11.md`, Razorpay has approved the business in writing, and the
data sources marked "not allowed" there are paid for or switched off.

These files have been checked for syntax only. **The images have not been built or run**; do a
trial on a test server first.

## Shape

One Linux server running Docker: Caddy (frontend and HTTPS), the API, MariaDB, Postgres, and a
jobs container for the daily run and backups.

## Rough yearly cost

Prices found on 28 November 2026 on third-party comparison pages; check each provider's page.

| Item | Rough cost |
|---|---|
| Server, 2 vCPU and 4 GB in India | about USD 20 to 28 a month at large clouds; budget hosts advertise from about ₹440 to ₹1,000 a month ([comparison](https://www.serversearcher.com/servers/answers/cheapest-4gb-ram-vps-in-india/)) |
| `.in` domain | about ₹600 to ₹1,200 a year plus GST |
| Password-reset email | free tiers cover early use, for example about 300 a day or 3,000 a month ([comparison](https://freetier.co/articles/free-email-sending-tiers-2026)) |
| Razorpay | widely reported as about 2% per domestic payment plus GST on the fee |
| News, if kept | GNews paid plan from about EUR 50 a month |
| Uptime check, error alerts | free tiers are enough at the start |

Without news, expect very roughly ₹1,000 to ₹2,500 a month. Model training on the server may need
more memory than 4 GB; train on your own computer and copy the files if so.

## First deployment

1. Buy the domain; create the server; point an `A` record at it; open ports 80 and 443 only
   (and SSH, with keys not passwords).
2. Install Docker, clone the repository.
3. `cp deploy/env.production.example deploy/.env.production` and fill it in. Use new secrets,
   not the ones from your computer, and new API keys.
4. `docker compose -f deploy/compose.yml --env-file deploy/.env.production up -d --build`
5. Create the administrator, then switch on two-factor sign-in:
   `docker compose -f deploy/compose.yml exec api npm run create-admin -- --email you@domain --name "You"`
6. Seed the catalogue and plans (`npm run db:seed` in the api container, without demo data), then
   `npm run copy:fix` if the database came from an older copy.
7. Copy the ML data and models: restore your `tusky.sql.gz` into the `postgres` service, and copy
   `ml-service/artifacts/` into the `ml-artifacts` volume.
8. Run once by hand and read the output:
   `docker compose -f deploy/compose.yml exec jobs node ops/jobs.mjs`
9. Add an outside uptime check on `https://your-domain/api/health`.
10. Copy `deploy/backups/` off the server regularly.

Updating: `git pull`, then the command in step 4. Database migrations apply on start; take a
backup first.

## Check email

```
docker compose -f deploy/compose.yml exec api npm run email:check -- --to you@yourdomain.com
```

Then use "Forgot password" on the live site and follow the link. Set up SPF and DKIM at your mail
provider, or the message will land in spam.

## Check payments and refunds in test mode

Use `rzp_test_` keys. Add a webhook in Razorpay pointing to
`https://your-domain/api/payments/webhook` with events payment.captured, order.paid,
payment.failed, refund.processed and refund.failed.

1. `npm run payments:check` creates a ₹1 test order.
2. Buy a single prediction with Razorpay's published test card; it should unlock.
3. Close the checkout half-way; the transaction should show as failed.
4. Buy a plan, and top up the wallet and pay from it.
5. As admin, refund one purchase fully; access should be withdrawn and revenue adjusted.
6. In Razorpay's dashboard confirm the same payments and refunds, and that webhooks succeeded.

The automated tests cover these paths with a stand-in for Razorpay. **They have never been run
against Razorpay itself.**

## Search and analytics

- Pages now have normal addresses, titles and descriptions; set `SITE_URL` so the sitemap is built,
  then submit it in Google Search Console.
- The app draws pages in the browser. Google can index that; some other services and social
  previews will only see the home page's tags. There is no preview image yet.
- Admin → Revenue Analytics shows anonymous page views. It cannot count unique visitors.

## Pricing review

Today: ₹49 a match, ₹199 a week, ₹599 a month, ₹4,999 a year, with only football listed.

- A week equals about 4 single matches and a month about 12.
- "Every listed sport" currently means football. Selling an all-sports plan then is likely to
  draw complaints: consider offering only single matches and one football plan at first.
- The football model picks the right result about 52% of the time against 44% for always picking
  the home side. Sell the probabilities and the open track record, not "winners".
- Consider charging nothing until the track record has at least 100 finished matches. It costs
  little and gives you something true to show.
