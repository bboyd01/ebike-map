#!/bin/sh
# Weekly data refresh (docs/SPEC.md §11). Idempotent; safe to re-run.
#   1. BRouter segments  -> /segments4/W90_N40.rd5
#   2. Basemaps          -> /srv/data/{metro,city}.v<N>.pmtiles
#   3. Controls          -> /srv/data/{metro,city}.controls.v<N>.bin
#   4. Manifest          -> /srv/data/manifest.json
set -eu
. /app/areas.env
DATA=${DATA_DIR:-/srv/data}
SEG=${SEGMENTS_DIR:-/segments4}
TILE=${SEGMENT_TILE:-W90_N40}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
V=$(date -u +%Y%m%d)
log() { echo "[refresh $(date -u +%H:%M:%S)] $*"; }

log "segments: $TILE.rd5"
curl -fsSL -o "$SEG/$TILE.rd5.part" "https://brouter.de/brouter/segments4/$TILE.rd5"
mv "$SEG/$TILE.rd5.part" "$SEG/$TILE.rd5"   # atomic swap; BRouter opens segment files per request

log "basemap: finding latest Protomaps daily build"
SRC=""
for back in 0 1 2 3 4 5 6; do
  d=$(date -u -d "@$(( $(date -u +%s) - back * 86400 ))" +%Y%m%d)
  if curl -fsI "https://build.protomaps.com/$d.pmtiles" >/dev/null 2>&1; then SRC="https://build.protomaps.com/$d.pmtiles"; break; fi
done
[ -n "$SRC" ] || { echo "no Protomaps build found in the last 7 days" >&2; exit 1; }
log "basemap: extracting metro from $SRC"
pmtiles extract "$SRC" "$WORK/metro.pmtiles" --bbox="$AREA_METRO" --maxzoom=15
log "basemap: extracting city from metro"
pmtiles extract "$WORK/metro.pmtiles" "$WORK/city.pmtiles" --bbox="$AREA_CITY"

log "controls: downloading Illinois extract"
curl -fsSL -o "$WORK/il.osm.pbf" "https://download.geofabrik.de/north-america/us/illinois-latest.osm.pbf"
for area in metro city; do
  bbox=$(eval echo "\$AREA_$(echo $area | tr a-z A-Z)")
  log "controls: $area"
  osmium extract -s simple -b "$bbox" "$WORK/il.osm.pbf" -o "$WORK/$area.osm.pbf" --overwrite
  osmium tags-filter "$WORK/$area.osm.pbf" \
    n/highway=traffic_signals,stop,give_way n/crossing=traffic_signals \
    -o "$WORK/$area.controls.opl" -f opl --overwrite
  osmium tags-filter "$WORK/$area.osm.pbf" \
    w/highway=primary,primary_link,secondary,secondary_link,tertiary,tertiary_link \
    -o "$WORK/$area.arterials.pbf" --overwrite
  osmium add-locations-to-ways "$WORK/$area.arterials.pbf" -o "$WORK/$area.arterials.opl" -f opl --overwrite
  node /app/build-controls.mjs --bbox "$bbox" --version "$V" \
    --controls "$WORK/$area.controls.opl" --arterials "$WORK/$area.arterials.opl" \
    --out "$WORK/$area.controls.v$V.bin"
done

log "publishing version $V"
for area in metro city; do
  mv "$WORK/$area.pmtiles" "$DATA/$area.v$V.pmtiles"
  mv "$WORK/$area.controls.v$V.bin" "$DATA/$area.controls.v$V.bin"
done
cat > "$DATA/manifest.json.part" <<JSON
{
  "version": $V,
  "areas": {
    "city":  { "bbox": [$AREA_CITY],  "pmtiles": "city.v$V.pmtiles",  "controls": "city.controls.v$V.bin" },
    "metro": { "bbox": [$AREA_METRO], "pmtiles": "metro.v$V.pmtiles", "controls": "metro.controls.v$V.bin" }
  }
}
JSON
mv "$DATA/manifest.json.part" "$DATA/manifest.json"

# Keep the current and previous version so clients mid-session don't break.
for pattern in 'metro.v*.pmtiles' 'city.v*.pmtiles' 'metro.controls.v*.bin' 'city.controls.v*.bin'; do
  ls -1 $DATA/$pattern 2>/dev/null | sort -r | tail -n +3 | xargs -r rm -f
done
log "done"
