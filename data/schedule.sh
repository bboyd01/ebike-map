#!/bin/sh
# Runs refresh.sh once if no data exists yet (retrying hourly on failure), then every
# Monday 09:17 UTC (off-peak for Chicago riders). A failed weekly run keeps the old data.
DATA=${DATA_DIR:-/srv/data}
log() { echo "[schedule $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

while [ ! -s "$DATA/manifest.json" ]; do
  log "no data yet: running initial refresh"
  /bin/sh /app/refresh.sh && break
  log "initial refresh failed; retrying in 1 hour"
  sleep 3600
done

while :; do
  next=$(date -u -d 'next monday 09:17' +%s)
  log "next refresh at $(date -u -d "@$next" +%Y-%m-%dT%H:%M:%SZ)"
  sleep $(( next - $(date -u +%s) ))
  /bin/sh /app/refresh.sh || log "refresh failed; keeping previous data"
done
