#!/bin/sh
# Starts BRouter. Downloads the segment tile on first boot if the volume is empty;
# the weekly refresh (data/refresh.sh) replaces it afterwards.
set -eu
tile="/segments4/${SEGMENT_TILE}.rd5"
if [ ! -s "$tile" ]; then
  echo "segments: downloading ${SEGMENT_TILE}.rd5"
  curl -fsSL -o "$tile.part" "https://brouter.de/brouter/segments4/${SEGMENT_TILE}.rd5"
  mv "$tile.part" "$tile"
fi
cd /opt/brouter
# RouteServer <segmentdir> <profiledir> <customprofiledir> <port> <maxthreads> [bindaddress]
exec java $JAVA_OPTS -cp brouter.jar btools.server.RouteServer \
  /segments4 profiles2 customprofiles 17777 "$MAX_THREADS" 0.0.0.0
