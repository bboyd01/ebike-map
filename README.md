# ebike-map

A fast, installable web app for planning and navigating **e-bike** routes in the
Chicago area (city only, or city + collar suburbs), like Google Maps' bike mode but tuned for e-bikes:

- **Accurate ETAs at e-bike speeds.** A physics-based model uses your bike class
  (assist cutoff), cruising speed, motor power, and weight, plus realistic stop-sign and
  signal delays.
- **Your street-type ranking.** Drag-order shared lanes, painted lanes, protected lanes,
  trails, greenways, and quiet streets, and set how strongly the router should stick to that order.
- **Temperature.** A "cautious ↔ assertive" slider that adds a time buffer for stops.
  Where lights and stop signs are mapped, the buffer is based on how many the route passes.
  Elsewhere it's a flat 0–50% of travel time.
- **Average speed with every ETA**, e.g. `24 min · arrive 5:42 PM · avg 14.2 mph`.
- **Choose your map on first launch:** Chicago city only, or Chicagoland (city + collar suburbs).
- **Turn-by-turn navigation** with voice prompts and automatic rerouting.

> Status: **spec phase.** See [`docs/SPEC.md`](docs/SPEC.md) for the full specification.

## Stack

| Layer | Choice |
|---|---|
| Routing | [BRouter](https://github.com/abrensch/brouter), self-hosted, one custom `ebike.brf` profile tuned per request |
| Map | MapLibre GL JS + [Protomaps](https://protomaps.com) PMTiles (one static file per map area, no tile server) |
| App | Vite + TypeScript + Preact, PWA via `vite-plugin-pwa` |
| Geocoding | Photon (komoot) |
| Hosting | Docker Compose on Coolify: `brouter` + `web` (Caddy), weekly data-refresh task |

No database and no custom API server. The ETA model and navigation run on the device.
Target footprint is ≤ 700 MB RAM and ≤ 1.5 GB disk.

## Planned layout

```
apps/web/   PWA (UI, ETA model, navigation engine)
routing/    BRouter profile + Dockerfile
data/       Weekly data refresh, stop/signal "controls" builder, trail rules
deploy/     docker-compose.yml, Caddyfile
docs/       SPEC.md
```

## Roadmap

0. Spike: BRouter on the VPS, verify the profile overrides and response contents
1. MVP: map-area picker, search, routing with alternatives, ranking, temperature offset, ETA model with average speed
2. Turn-by-turn navigation and voice
3. ETA calibration from recorded rides; Chicago Data Portal bike-lane data
4. Polish: saved places, bike-infrastructure overlay, shareable links

## Known limitation

iOS doesn't give PWAs background GPS, so keep the screen on while navigating. The app
requests a wake lock to do this.
