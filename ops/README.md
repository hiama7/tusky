# Running TUSKY

## Daily

```
npm run jobs                  # results -> predict -> sync -> news -> health
npm run jobs -- --only health # one step
npm run backup                # both databases and uploads, into backups/
npm run backup:verify         # restore the newest MySQL dump into a scratch database and count rows
```

The run needs MySQL (XAMPP) and Docker (the ML Postgres, `npm run db:up`). A step that fails is
logged in `ops/logs/`, alerted, and the other steps still run.

Settings in the project-root `.env`:

| Name | Meaning |
|---|---|
| `JOBS_PUBLISH` | `true` publishes new predictions. Otherwise they arrive as drafts and **the public site does not move on until someone publishes** |
| `ALERT_WEBHOOK_URL` | A Slack or Discord incoming webhook. Without it, alerts are only logged |

## Scheduling on this Windows computer

```
powershell -ExecutionPolicy Bypass -File ops\register-tasks.ps1
```

Backup at 05:30 and the daily run at 06:00, for the signed-in user. Add `-Remove` to undo.
On a Linux server use cron with the same two commands.

## What tells you something is wrong

- **Admin → Overview → System health:** matches running out, missing results, held refunds,
  failed or silent daily runs, old or incomplete backups.
- **Webhook alerts:** failed steps, health warnings, unexpected server errors (at most one per
  problem every 15 minutes), the API waiting for its database or stopping.

An alert cannot be sent by a computer that is off. Once hosted, add an outside uptime check on
`/api/health`.

## Backups

- They contain names, emails, phone numbers and password hashes. Keep `backups/` private.
- Nothing prunes them. Delete old folders yourself, and copy recent ones to another machine:
  a backup on the same disk does not survive the disk.
- `.env` files are not backed up. Keep the secrets, especially `ADMIN_2FA_KEY` and the JWT
  secrets, somewhere safe.
- `backup:verify` tests the MySQL dump only. The Postgres dump has no automatic restore test:
  `gunzip -c tusky.sql.gz | docker exec -i tusky-postgres psql -U tusky -d <empty database>`.

To restore MySQL for real, create an empty database and load `predictx.sql.gz` into it, then point
`DATABASE_URL` at it. Do not load a dump over a database that is in use.

## The 502 errors in development

The Vite proxy answers 502 when the API is not listening. Two causes were reproduced:

1. `npm run dev` restarts the API when a file under `src` changes: unreachable for about
   1.6 seconds. This is expected; reload the page.
2. Starting while MySQL was down made the API exit, and it stayed down until a file changed.
   It now waits and retries instead.
