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

> Status: **Phase 0 (spike).** The routing profile, deployment, data pipeline, and ETA
> core are written. The spike ran on real Chicago data (13 of 14 checks pass; first-route
> latency still needs measuring on the VPS). See [`docs/SPEC.md`](docs/SPEC.md) §15.

## Stack

| Layer | Choice |
|---|---|
| Routing | [BRouter](https://github.com/abrensch/brouter), self-hosted, one custom `ebike.brf` profile tuned per request |
| Map | MapLibre GL JS + [Protomaps](https://protomaps.com) PMTiles (one static file per map area, no tile server) |
| App | Vite + TypeScript + Preact, PWA via `vite-plugin-pwa` |
| Geocoding | Photon (komoot) |
| Hosting | Docker Compose on Coolify: `brouter`, `web` (Caddy), `data` (weekly refresh) |

No database and no custom API server. The ETA model and navigation run on the device.
Target footprint is ≤ 700 MB RAM and ≤ 1.5 GB disk.

## Planned layout

```
apps/web/   PWA (UI, ETA model, navigation engine)
routing/    BRouter profile + Dockerfile
data/       Weekly data refresh, stop/signal "controls" builder
deploy/     Caddyfile, web image (docker-compose.yml is at the repo root)
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

## Development

```bash
cd apps/web && npm ci && npm test
```

## Deploying on Coolify

1. New resource → Docker Compose → this repo. Keep the defaults: base directory `/`, compose file `/docker-compose.yml`.
2. Assign your domain to the `web` service (port 80). `brouter` and `data` need no domain.
3. Deploy. On first start, `data` downloads the map data (expect 10–20 minutes) and
   BRouter downloads its 79 MB segment file. Routes work once both finish.

## Phase 0 spike

Once BRouter is running, check the spec's assumptions with real Chicago trips:

```bash
docker run --rm --network <compose-network> -v "$PWD/routing:/s" node:22-alpine node /s/spike.mjs http://brouter:17777/brouter
```

`<compose-network>` is shown by `docker network ls` (Coolify names it after the resource).
The script prints PASS/FAIL for each check and exits non-zero if any check fails.
