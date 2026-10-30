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
- **Express trails.** The 606, the Lakefront Trail and other long regional trails are strongly
  preferred when the route can stay on them for a few blocks, at your own trail speed.
- **Fewer turns.** Routes favor long straightaways and bike lanes on through streets, and every
  trip also shows a **Simplest** route that ignores bike lanes.
- **Average speed with every ETA**, e.g. `24 min · arrive 5:42 PM · avg 14.2 mph`.
- **Choose your map on first launch:** Chicago city only, or Chicagoland (city + collar suburbs).
- **Turn-by-turn navigation** with voice prompts and automatic rerouting.

> Status: **Phase 1 (MVP).** Map, search, routes colored by street type, alternatives with
> ETA and average speed, and the full settings screen. Turn-by-turn navigation (Phase 2)
> is next. See [`docs/SPEC.md`](docs/SPEC.md).

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

Run the app against a deployed stack (routing and map data come from it):

```bash
cd apps/web && EBIKE_API=https://your-ebike-domain npx vite
```

Or against a bare local BRouter, with a public Protomaps build as the basemap:

```bash
cd apps/web && EBIKE_BROUTER=http://localhost:17777 VITE_PMTILES_URL=https://build.protomaps.com/20261029.pmtiles npx vite
```

## Deploying on Coolify

1. New resource → Docker Compose → this repo. Keep the defaults: base directory `/`, compose file `/docker-compose.yml`.
2. Assign your domain to the `web` service (port 80). `brouter`, `data` and `auth` need no domain.
3. Deploy. On first start, `data` downloads the map data (expect 10–20 minutes) and
   BRouter downloads its 79 MB segment file. Routes work once both finish.
4. Set the login password. Open the app: it shows "Set a password" and asks for a setup
   code. Find the code in the `auth` service's logs in Coolify (a line like
   `[auth] No password set. Open the app and enter setup code: ABCD-EF23`), enter it, and
   choose a password. The app stays locked to everyone until then.

Change the password later in Settings → App → Password (this signs out your other devices).
Forgot it? Delete `password-hash` from the `auth` volume (or the whole volume) and restart
the `auth` service; a new setup code appears in its log.

Optional: to pin the password in Coolify instead, run `node auth/hash-password.mjs` (any
machine with Node 22) and set the printed `AUTH_PASSWORD_HASH=…` as an environment
variable. It overrides the in-app password and turns off setup and in-app changes.

## Phase 0 spike

Once BRouter is running, check the spec's assumptions with real Chicago trips:

```bash
docker run --rm --network <compose-network> -v "$PWD/routing:/s" node:22-alpine node /s/spike.mjs http://brouter:17777/brouter
```

`<compose-network>` is shown by `docker network ls` (Coolify names it after the resource).
The script prints PASS/FAIL for each check and exits non-zero if any check fails.
