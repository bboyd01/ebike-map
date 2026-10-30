#!/bin/sh
# Weekly data refresh (docs/SPEC.md §11). Idempotent; safe to re-run.
#   1. BRouter segments  -> /segments4/W90_N40.rd5
#   2. Basemaps          -> /srv/data/{metro,city}.v<N>.pmtiles
#   3. Stoplights        -> /srv/data/{metro,city}.controls.v<N>.bin (optional; map works without)
#   4. Manifest          -> /srv/data/manifest.json
# Progress goes to /srv/data/status.json, which the app shows during the first build.
set -eu
. /app/areas.env
DATA=${DATA_DIR:-/srv/data}
SEG=${SEGMENTS_DIR:-/segments4}
TILE=${SEGMENT_TILE:-W90_N40}
WORK=$(mktemp -d)
V=$(date -u +%Y%m%d)
log() { echo "[refresh $(date -u +%H:%M:%S)] $*"; }

STATUS="$DATA/status.json"
STEPS=5
CUR_STEP=0
CUR_LABEL="Starting"
status() { # state step label [bytes total]
  printf '{"state":"%s","step":%s,"steps":%s,"label":"%s","bytes":%s,"total":%s,"updated":%s}\n' \
    "$1" "$2" "$STEPS" "$3" "${4:-0}" "${5:-0}" "$(date -u +%s)" > "$STATUS.part" && mv "$STATUS.part" "$STATUS"
}
step() { CUR_STEP=$1; CUR_LABEL=$2; log "$2"; status running "$1" "$2"; }
# Download with byte progress in status.json.
fetch() {
  total=$(curl -fsSIL "$1" | tr -d '\r' | awk 'tolower($1)=="content-length:" { n = $2 } END { print n + 0 }')
  curl -fsSL -o "$2" "$1" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    status running "$CUR_STEP" "$CUR_LABEL" "$(stat -c %s "$2" 2>/dev/null || echo 0)" "$total"
    sleep 2
  done
  wait "$pid"
}
trap 'rc=$?; rm -rf "$WORK"; [ "$rc" -eq 0 ] || status failed "$CUR_STEP" "$CUR_LABEL"' EXIT

step 1 "Downloading routing data"
fetch "https://brouter.de/brouter/segments4/$TILE.rd5" "$SEG/$TILE.rd5.part"
mv "$SEG/$TILE.rd5.part" "$SEG/$TILE.rd5"   # atomic swap; BRouter opens segment files per request

step 2 "Extracting the Chicagoland basemap"
SRC=""
for back in 0 1 2 3 4 5 6; do
  d=$(date -u -d "@$(( $(date -u +%s) - back * 86400 ))" +%Y%m%d)
  if curl -fsI "https://build.protomaps.com/$d.pmtiles" >/dev/null 2>&1; then SRC="https://build.protomaps.com/$d.pmtiles"; break; fi
done
[ -n "$SRC" ] || { echo "no Protomaps build found in the last 7 days" >&2; exit 1; }
log "basemap: extracting metro from $SRC"
pmtiles extract "$SRC" "$WORK/metro.pmtiles" --bbox="$AREA_METRO" --maxzoom=15
step 3 "Extracting the city basemap"
pmtiles extract "$WORK/metro.pmtiles" "$WORK/city.pmtiles" --bbox="$AREA_CITY"

# Newest file on disk matching a glob ("" if none).
newest() { ls -1 $DATA/$1 2>/dev/null | sort -r | head -n 1 | xargs -r basename; }

# Manifest points at the newest basemaps and stoplight files on disk. Written as soon as
# the basemaps exist, and again after the stoplight build, so a failed stoplight build
# never keeps the map from appearing.
write_manifest() {
  entry() { # area bbox
    pm=$(newest "$1.v*.pmtiles"); ctl=$(newest "$1.controls.v*.bin")
    printf '"%s": { "bbox": [%s], "pmtiles": "%s"%s }' "$1" "$2" "$pm" "${ctl:+, \"controls\": \"$ctl\"}"
  }
  { printf '{\n  "version": %s,\n  "areas": {\n    ' "$V"; entry city "$AREA_CITY"; printf ',\n    '; entry metro "$AREA_METRO"; printf '\n  }\n}\n'; } > "$DATA/manifest.json.part"
  mv "$DATA/manifest.json.part" "$DATA/manifest.json"
}

log "publishing basemaps $V"
for area in metro city; do mv "$WORK/$area.pmtiles" "$DATA/$area.v$V.pmtiles"; done
write_manifest

# Stoplights: streaming osmium filters keep memory to tens of MB (a full-state
# `osmium extract` was OOM-killed under the 512 MB limit). Clipping to each area
# happens in build-controls.mjs.
build_controls() {
  step 4 "Downloading OpenStreetMap data for stoplights"
  fetch "https://download.geofabrik.de/north-america/us/illinois-latest.osm.pbf" "$WORK/il.osm.pbf" || return 1
  step 5 "Building the stoplight file"
  osmium tags-filter -R "$WORK/il.osm.pbf" n/highway=traffic_signals n/crossing=traffic_signals \
    -o "$WORK/signals.opl" -f opl --overwrite || return 1
  osmium tags-filter "$WORK/il.osm.pbf" \
    w/highway=primary,primary_link,secondary,secondary_link,tertiary,tertiary_link \
    -o "$WORK/arterials.pbf" --overwrite || return 1
  rm -f "$WORK/il.osm.pbf"
  osmium add-locations-to-ways "$WORK/arterials.pbf" -o "$WORK/arterials.opl" -f opl --overwrite || return 1
  node /app/build-controls.mjs --areas "city=$AREA_CITY;metro=$AREA_METRO" --version "$V" \
    --signals "$WORK/signals.opl" --arterials "$WORK/arterials.opl" --outdir "$WORK" || return 1
  for area in metro city; do mv "$WORK/$area.controls.v$V.bin" "$DATA/$area.controls.v$V.bin" || return 1; done
}
CONTROLS_OK=1
if ! build_controls; then
  CONTROLS_OK=0
  log "stoplight build failed; the map works, ETAs use the flat stop buffer (or the previous stoplight file)"
fi
write_manifest

# Keep the current and previous version so clients mid-session don't break.
for pattern in 'metro.v*.pmtiles' 'city.v*.pmtiles' 'metro.controls.v*.bin' 'city.controls.v*.bin'; do
  ls -1 $DATA/$pattern 2>/dev/null | sort -r | tail -n +3 | xargs -r rm -f
done
if [ "$CONTROLS_OK" = 1 ]; then
  status done "$STEPS" "Done"
  log "done"
else
  status failed "$CUR_STEP" "$CUR_LABEL"
  exit 1
fi
