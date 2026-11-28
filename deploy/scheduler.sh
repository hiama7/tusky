#!/bin/sh
# Backup at 05:30 and the daily run at 06:00 (the container's TZ). A failure is
# logged and alerted by the scripts themselves; the loop carries on.
last_backup=""
last_jobs=""
echo "scheduler started; times are in TZ=${TZ:-UTC}"
while true; do
  today=$(date +%F)
  now=$(date +%H%M)
  if [ "$now" -ge 0530 ] && [ "$last_backup" != "$today" ]; then
    last_backup="$today"
    node ops/backup.mjs || true
  fi
  if [ "$now" -ge 0600 ] && [ "$last_jobs" != "$today" ]; then
    last_jobs="$today"
    node ops/jobs.mjs || true
  fi
  sleep 60
done
