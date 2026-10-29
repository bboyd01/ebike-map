# ebike-map — Product & Technical Specification

Status: **Draft v0.1** · Scope: v1 (Chicago + collar suburbs) · Last updated: 2026-10-29

---

## 1. Summary

A fast, installable web app (PWA) for planning and riding routes on an e-bike, in
the style of Google Maps' bike mode but built around how e-bikes actually move:

- **Accurate ETAs at e-bike speeds.** These come from a physics-based speed model plus
  intersection delays, not a flat "bike speed".
- **Granular street-type preferences.** The rider drag-orders infrastructure types
  (shared lane, painted lane, protected lane, trail, greenway, quiet street, …), and
  the router follows that order.
- **A "temperature" setting.** It controls how by-the-book the rider is at stop signs and
  turns. It changes the route choice and the ETA together, so the two stay consistent.
- **Turn-by-turn navigation** with voice, rerouting, and a heading-up map.

### 1.1 Goals

| ID | Goal | Measure |
|----|------|---------|
| G1 | Accurate ETAs for e-bikes | Median absolute error ≤ 10%, p90 ≤ 20% on a rider's recorded trips after calibration (≤ 15% median before calibration) |
| G2 | Routes that honor the rider's infrastructure ranking | ≥ 80% of route distance on the rider's top-3 ranked classes when such a route exists within the configured detour tolerance |
| G3 | Very fast loading | First load ≤ 1.5 s on 4G; repeat load ≤ 0.5 s |
| G4 | Small server footprint | ≤ 700 MB RAM and ≤ 1.5 GB disk total, on one VPS under Coolify |

### 1.2 Non-goals (v1)

Car or transit modes · user accounts or cloud sync · coverage outside the Chicago bbox
· native iOS/Android apps · traffic-aware routing · social features.

### 1.3 Coverage

Bounding box (city + collar suburbs, slightly padded):
`west -88.45, south 41.45, east -87.50, north 42.35`.
This covers Cook, DuPage, and parts of Lake, Kane, and Will counties. It can be widened
later without changing the architecture.

---

## 2. Tech stack

The stack is chosen to stay lean: **no database, no custom API server, two containers.**

| Layer | Choice | Rationale |
|---|---|---|
| Routing engine | **[BRouter](https://github.com/abrensch/brouter)** (Java, self-hosted Docker) | Purpose-built for bikes. Its profile scripting language costs ways and nodes on raw OSM tags (`cycleway=track` vs `lane` vs `shared_lane`, `highway=stop`, `traffic_signals`, surface, …). Profile variables can be overridden per request (`profile:<var>=<value>`), so one profile serves every user setting. Returns turn instructions ("voicehints"), elevation, per-segment tags, and alternative routes. One 5°×5° segment file (`W90_N40.rd5`) covers all of Chicagoland. Low memory use. |
| Basemap tiles | **[Protomaps](https://protomaps.com) PMTiles** extract of the bbox | One static file served with HTTP range requests, so no tile server process. Vector tiles. Roughly 100–200 MB for this bbox. |
| Map renderer | **MapLibre GL JS** + `pmtiles` protocol plugin | Vector rendering, smooth rotation and pitch for a heading-up navigation camera. |
| UI framework | **Vite + TypeScript + Preact** (+ `@preact/signals`) | About 4 KB runtime, fast builds, a familiar component model. |
| PWA | `vite-plugin-pwa` (Workbox) | Precached app shell, installable, works offline for UI and settings. |
| Geocoding | **Photon** (`photon.komoot.io`) with bbox + location bias | Free and supports autocomplete. Self-hosting needs Elasticsearch-scale resources, which this VPS doesn't have. Nominatim is a fallback for one-off lookups only, because its usage policy forbids autocomplete. |
| Voice | Web Speech API (`speechSynthesis`) | Built in, free, works offline. |
| Edge / static | **Caddy** container | Serves the app, PMTiles, and data files. Reverse-proxies `/route` to BRouter (BRouter itself is never exposed) and rate-limits. Sits behind Coolify's Traefik. |
| Data refresh | Weekly Coolify scheduled task (shell script) | Downloads the prebuilt `W90_N40.rd5` from brouter.de, re-extracts the PMTiles, and rebuilds `controls.bin` (§6.3). |
| Client storage | `localStorage` (settings), IndexedDB (saved places, ride recordings, calibration) | No accounts. Export/import as JSON. |

### 2.1 Why BRouter over the alternatives

| Engine | Per-request custom weighting | Bike-tag granularity | Fits a small VPS | Verdict |
|---|---|---|---|---|
| **BRouter** | Yes: profile variables via URL | Raw OSM tags, node costs, turn costs | Yes (~300–500 MB) | **Chosen** |
| GraphHopper | Yes (custom models), but needs a non-CH/LM profile, which is slower and uses more RAM | Encoded values only; no node tags such as stop signs | Marginal | Runner-up |
| Valhalla | Partial (`use_roads`, `cycling_speed`, `bicycle_type`) | Coarse; can't rank `track` vs `lane` vs `shared_lane` independently | Yes | Not granular enough |
| OSRM | No (weights baked in at build time) | Lua profile, fixed at build | Yes | No per-user tuning |
| Hosted APIs (Google, Mapbox) | No | No | n/a | Can't express the ranking or the temperature setting |

### 2.2 Footprint budget

| Component | RAM | Disk |
|---|---|---|
| BRouter (`-Xmx384m`) | ≤ 450 MB | ~300 MB (`W90_N40.rd5`) |
| Caddy | ≤ 40 MB | app ≈ 2 MB, PMTiles ≈ 100–200 MB, controls ≈ 0.5 MB |
| Data-refresh job (transient, weekly) | ≤ 300 MB while running | ~400 MB scratch (Illinois `.osm.pbf`), deleted afterwards |

---

## 3. Architecture

```
 Phone (PWA)                                VPS (Coolify / Traefik)
 ┌──────────────────────────┐   HTTPS   ┌──────────────────────────────────────┐
 │ Preact UI + MapLibre     │──────────▶│ Caddy ("web")                        │
 │  • settings → profile    │           │  /            → static app (immutable)│
 │    params                │           │  /tiles/*.pmtiles → range requests   │
 │  • ETA model (client)    │           │  /data/controls.v<N>.bin             │
 │  • navigation engine     │           │  /route       → brouter:17777 (int.) │
 │  • IndexedDB rides       │           └──────────────┬───────────────────────┘
 └──────────┬───────────────┘                          │ internal network
            │ geocode (direct)                ┌────────▼────────┐
            ▼                                 │ BRouter         │
     photon.komoot.io                         │ ebike.brf       │
                                              │ W90_N40.rd5     │
                                              └─────────────────┘
```

**Request flow (route):**

1. The client converts settings into BRouter profile params (§5.4, §6.2).
2. It sends `GET /route?lonlats=…&profile=ebike&alternativeidx=0..2&format=geojson&timode=<n>&profile:cf_trail=…`.
   The three alternatives are fetched in parallel.
3. BRouter returns GeoJSON: geometry with elevation, a `messages` table (per-segment
   distance, way and node tags, costs), and `voicehints`.
4. The client's **ETA model** (§7) computes time per segment, then adds intersection
   delays from `controls.bin` and turn penalties. **BRouter's own time estimate is ignored.**
5. The client ranks the alternatives (§5.5) and shows them on a comparison sheet.

---

## 4. Functional requirements

### 4.1 Map & search
- **FR-1** Full-screen vector map of the coverage bbox. The map starts at the last viewport, or at the user's location if permission is granted.
- **FR-2** Search box with autocomplete (Photon, 250 ms debounce, bbox-restricted, biased to the map center). Keeps a recent-searches list (last 20, stored locally).
- **FR-3** Long-press on the map sets an origin or destination. "My location" is the default origin.
- **FR-4** Up to 3 intermediate waypoints, drag-reorderable.

### 4.2 Routing
- **FR-5** Compute up to 3 alternative routes, each showing ETA, distance, % of distance by infrastructure class (stacked bar), stop and signal count, and climb.
- **FR-6** The route line is colored by infrastructure class, so the rider can see where it uses shared lanes, protected lanes, and so on.
- **FR-7** Settings changes recompute the route immediately, using the same endpoints.
- **FR-8** "Depart at" is out of scope for v1. ETAs assume the current time with no traffic.

### 4.3 Navigation
- **FR-9** Turn-by-turn mode: heading-up camera, next-maneuver banner (arrow, street name, distance), remaining time, distance, and arrival clock time.
- **FR-10** Voice prompts (toggleable) at an advance distance, a near distance, and at the maneuver (§8.2).
- **FR-11** Automatic rerouting when off-route (§8.3).
- **FR-12** Keeps the screen awake during navigation (Screen Wake Lock API).
- **FR-13** Optional ride recording (GPS trace with timestamps), used for ETA calibration (§7.6).

### 4.4 Settings
- **FR-14** All settings in §9, persisted locally, with export/import as JSON.
- **FR-15** Presets: "Commute" (default), "Chill" (strong infrastructure preference, low temperature), "Fast" (weak preference, higher temperature). The user can save custom presets.

---

## 5. Street-type preference ranking

### 5.1 Infrastructure classes

Each way in the route is assigned exactly **one** class. The rules are evaluated top-down in
`ebike.brf`, and the first match wins:

| Class | Key | OSM match (simplified) |
|---|---|---|
| Off-street trail | `trail` | `highway=cycleway` not alongside a road; `highway=path\|footway` + `bicycle=designated` |
| Protected lane | `protected` | `cycleway[:left\|:right\|:both]=track\|separate`; `highway=cycleway` + `cycleway=sidepath`/adjacent to a road |
| Painted / buffered lane | `lane` | `cycleway[:*]=lane` (incl. `cycleway:*:buffer=*`) |
| Shared lane (sharrow) | `shared` | `cycleway[:*]=shared_lane` |
| Neighborhood greenway | `greenway` | Residential street that is part of an `lcn`/`rcn` bicycle route relation, or `bicycle_road=yes` |
| Quiet street | `quiet` | `highway=residential\|living_street\|unclassified`, or `service` that is not a driveway or parking aisle |
| Arterial, no infra | `arterial` | `highway=tertiary\|secondary\|primary` with no bike infrastructure |
| Other | `other` | Anything else routable (`track`, pedestrian, …), always ranked after `arterial` |

Phase 3 conflates the City of Chicago Data Portal "Bike Routes" dataset to fill gaps
where OSM tagging is missing or stale (§12).

### 5.2 User ranking

The rider drag-orders the first seven classes. `arterial` defaults to 7th and can't be
moved above 5th. `other` is always last. Default order (from the product brief):

1. `shared` · 2. `lane` · 3. `protected` · 4. `trail` · 5. `greenway` · 6. `quiet` · 7. `arterial`

### 5.3 Rank to cost factor

BRouter costs a way as `distance × costfactor`. For the class at 1-based rank `r`:

```
cf(r) = (1 + s) ^ (r − 1)
```

`s` is the **"pickiness"** slider (0.05 – 0.60, default 0.20). With s = 0.20 the factors are
1.00, 1.20, 1.44, 1.73, 2.07, 2.49, 2.99. In words: with the default setting the router
will ride about 1.2 km on the rank-1 class to avoid 1 km on the rank-2 class.
`arterial` also gets a multiplier for speed and lanes (`maxspeed ≥ 35 mph` or
`lanes ≥ 4` → ×1.5).

A **max detour** guard (default +25% over the shortest bikeable route) is enforced
client-side. If every alternative exceeds it, the client shows the least-detour
alternative with a notice.

### 5.4 Toggles (profile variables)

| Variable | Default | Effect |
|---|---|---|
| `avoid_unpaved` | on | Gravel, dirt, or grass ×3 cost (on top of ETA slowdown) |
| `avoid_rough` | on | `smoothness=bad` or worse, and cobblestone/sett ×2 |
| `avoid_dismount` | on | Steps, `bicycle=dismount` ×8 |
| `avoid_unsignalized_arterial_crossings` | on | Node cost when a minor road crosses an arterial without signals |
| `class3_mode` | auto (from bike class) | Class 3: paths with `trail-rules.json` restrictions get ×20 cost (effectively avoided) |

`trail-rules.json` is a small, hand-maintained list of paths with e-bike class or speed
rules (e.g. Chicago Park District and Forest Preserve paths). **The rules must be verified
against current ordinances before shipping; see open question Q3.**

### 5.5 Ranking the alternatives

Each alternative gets the score `score = ETA_s × (1 + λ × (pref_cost / dist − 1))`,
where `pref_cost` is Σ(segment distance × cf(class)) and λ = 0.5. The lowest score is
shown first, but all alternatives stay visible. The comparison sheet labels each
alternative's tradeoff ("2 min faster", "+18% protected").

---

## 6. Temperature

### 6.1 Definition

`T ∈ [0.0, 1.0]`, default **0.2**. 0 is fully by the book; 1 is assertive. Illinois has no
"Idaho stop" law, so the default sits near law-abiding. The UI shows this as a slider
labeled *"By the book ↔ Assertive"*.

Temperature only changes how *stop signs* and *turns* are modeled. **Traffic signals are
never discounted**: red-light behavior is not modeled as optional.

### 6.2 Effects (interpolated linearly in T)

| Parameter | T = 0 | T = 1 | Used by |
|---|---|---|---|
| `v_stop_min`: min speed through a stop sign | 0 m/s (full stop) | 4 m/s (~9 mph roll) | ETA |
| `dwell_stop`: time stationary at a stop | 2.0 s | 0 s | ETA |
| All-way stop extra dwell (yielding to others) | +1.5 s | +0.5 s | ETA |
| Turn speed scale (fraction of geometric max) | 0.75 | 1.0 | ETA |
| `node_cost_stop` (BRouter, meters-equivalent) | 120 | 30 | Routing |
| `node_cost_signal` | 250 | 250 | Routing |

**Stop delay** follows from kinematics rather than a fixed constant. For cruise speed `v`,
deceleration `a_d` (1.5 m/s²) and acceleration `a_a` (derived from motor power, §7.4):

```
delay_stop = (v − v_min)² / (2·v) · (1/a_d + 1/a_a) + dwell
```

At 18 mph (8 m/s) and a_a = 1.2 m/s²: **T=0 ≈ 8.0 s** (6.0 s of decel/accel loss + 2 s dwell), **T=1 ≈ 1.5 s**.

**Signal delay** (independent of T):
`delay_signal = p_red × (red_len / 2 + delay_stop(T=0) − dwell)`.
The defaults depend on approach:

| Approach | p_red | red_len |
|---|---|---|
| Crossing a higher-class road (minor approach) | 0.60 | 55 s |
| Along the major road | 0.35 | 35 s |
| Equal classes | 0.50 | 45 s |

### 6.3 Controls file (`controls.bin`)

Built weekly from the Geofabrik Illinois extract, clipped to the bbox (`osmium extract`),
by a small Node script in `data/`. It contains:

- **Tagged controls:** nodes with `highway=traffic_signals`, `highway=stop` (including
  `stop=all`), `highway=give_way`, and `crossing=traffic_signals`.
- **Inferred stops:** junction nodes where ≥ 2 ways with `highway ∈ {residential,
  living_street, unclassified}` meet, no tagged control within 25 m, and not a dead end.
  These carry a probability `p_stop` (default 0.7, calibrated in Phase 3). This matters
  in Chicago, where the residential grid is stop-controlled at most intersections but
  OSM stop-sign tagging is patchy.
- **Per node:** lat/lon (int32 microdegrees, delta-encoded), type (u8), highest crossing
  road class (u8), all-way flag.

Expected size: about 60k nodes, ~500 KB raw and ~200 KB compressed. The file is
lazy-loaded after first paint and cached by the service worker. Matching a control to the
route: the node lies within 8 m of the route polyline, and a road-class change happens
at that node or the route turns there.

**Known limitation (v1):** BRouter only sees *tagged* stop signs, so inferred stops affect
the ETA and the alternative ranking (§5.5) but not BRouter's path search. Phase 3 fixes this
by building a custom `.rd5` with the inferred `highway=stop` tags injected (§12).

---

## 7. ETA model

The model is a pure TypeScript module (`apps/web/src/eta/`) with no DOM dependencies, so
it can be unit-tested directly. The route is split into segments wherever the class,
surface, or grade bucket changes.

### 7.1 Rider/bike parameters (from settings)

| Symbol | Meaning | Default |
|---|---|---|
| `class` | E-bike class → assist cutoff `v_cut` | Class 2 → 20 mph (8.94 m/s); Class 1 → 20 mph; Class 3 → 28 mph; Custom |
| `v_cruise` | Average cruising speed on flat, clear road | 18 mph |
| `m` | Rider + bike + cargo mass | 100 kg |
| `P_motor` | Motor nominal power | 500 W (Class 1/2 legal max 750 W) |
| `P_rider` | Rider's sustained unassisted power | 120 W |
| `CdA` / `Crr` | Aero drag area / rolling resistance | Upright commuter: 0.55 m² / 0.006 |
| `v_descent_max` | Comfort cap on descents | 25 mph |
| `throttle` | Has a throttle (affects launch acceleration) | yes for Class 2 |

### 7.2 Speed from power balance

The power needed at speed `v` on grade `θ`:

```
P(v, θ) = v · ( m·g·(Crr·cos θ + sin θ) + ½·ρ·CdA·v² )      ρ = 1.2 kg/m³
```

1. **Calibrate** `P_cruise = P(v_cruise, 0)`. This captures how hard *this* rider
   uses assist on the flat (about 220 W at defaults).
2. **Available power** on a segment: `P_avail = min(P_cruise × k_hill(θ), P_rider + η·P_motor)`.
   `k_hill` ramps from 1.0 on the flat to 1.35 at grades ≥ 6% (riders push more on
   climbs), and η = 0.8 is drivetrain and motor efficiency.
3. Solve `P(v, θ) = P_avail` for `v` (Newton's method, 5 iterations).
4. **Assist cutoff:** if `v > v_cut`, the motor drops out, so
   `v = max(v_cut, solve(P(v, θ) = P_rider))`.
5. **Descents:** `v = min(solve(P(v,θ) = 0.5·P_cruise), v_descent_max)`.
6. **Flat-road ceiling:** `v ≤ v_cruise × 1.05` when |θ| < 1%, since riders hold cruise
   speed rather than max out.

Chicago is mostly flat, so grade matters mainly on bridges, viaducts, underpasses, and
the river crossings. BRouter's SRTM-based elevation is smoothed over a 50 m window to remove
noise before grades are computed.

### 7.3 Context caps and multipliers

| Context | Effect (defaults, editable) |
|---|---|
| Off-street trail | Cap 15 mph (shared with pedestrians). The Lakefront Trail and 606 have their own cap entries in `trail-rules.json` |
| Shared lane / arterial, no infra | Cap `min(v_cruise, 18 mph)` |
| Quiet street / greenway | No cap (stop delays dominate) |
| Surface: unpaved / gravel | × 0.75 speed |
| Surface: sett / cobblestone / brick | × 0.80 |
| Surface: `smoothness=bad` | × 0.85 |
| Dismount / steps | 1.2 m/s walking speed |

### 7.4 Intersections and turns

- **Stops and signals:** §6.2 formulas, using controls matched along the route (§6.3).
  Inferred stops add `p_stop × delay_stop`.
- **Launch acceleration:** `a_a = clamp(η·P_motor / (m · v_avg_launch), 0.6, 1.8)` m/s²
  with `v_avg_launch = v/2`. A throttle adds +0.2 (an instant launch).
- **Turns:** from each voicehint's angle `α`, take the geometric max speed
  `v_turn = sqrt(μ·g·R(α))` with R from a lookup table (90° city corner ≈ 6 m, 135° ≈ 4 m,
  μ = 0.5), scaled by the temperature turn factor. The time loss uses the same decel/accel
  formula as a stop, with `v_min = v_turn` and zero dwell.
- **Left turns at signals** from a lane or shared-lane street: + 0.5 × red_len × p_red
  (two-stage turn or waiting for a gap).

### 7.5 Output

Per route: total ETA; breakdown into moving time, stop time, signal time, and turn loss;
per-segment predicted speed (stored for live re-estimation during navigation).

### 7.6 Personal calibration (Phase 3)

1. Recorded rides (FR-13) are map-matched to the route that was navigated.
2. For each class, compute `ratio = actual_moving_time / predicted_moving_time`, using
   only segments without a stop or signal. Intersection delays are calibrated separately
   from the dwell time observed near matched controls.
3. Maintain an EWMA per class (α = 0.2, minimum 2 km of data before applying), clamped to
   [0.7, 1.4]. Apply it as a post-multiplier on that class's moving time.
4. Settings show "ETA learned from N rides", with a reset button.

### 7.7 Validation

- Unit tests: the power solver against hand-computed cases; stop-delay kinematics; the
  cutoff behavior, where Class 3 on the flat must not exceed `v_cruise`.
- Golden routes: 10 fixed Chicago O/D pairs (e.g. Logan Square → Loop via Milwaukee Ave,
  Hyde Park → Loop via the Lakefront Trail, Evanston → Lincoln Park). The ETA is snapshot-tested
  per settings preset.
- Field accuracy: a script compares recorded rides against the predictions and reports the
  median and p90 absolute % error (target G1).

---

## 8. Navigation engine

### 8.1 Positioning
- `navigator.geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 1000 })`.
- Snap to the route polyline (projection onto the nearest segment, searched in a window
  ahead of the last progress index). Ignore fixes with accuracy > 40 m.
- Heading: GPS course when speed > 2 m/s, otherwise the device orientation (where
  permitted). Smoothed with a 3-sample circular mean.

### 8.2 Instructions & voice
- Maneuvers come from BRouter voicehints: turn type, angle, and roundabout exit.
- **Street names:** BRouter segment data doesn't carry `name` tags (to be verified in
  Phase 0). Names are resolved client-side by reading the Protomaps `roads` layer at z15
  around each maneuver point: the client decodes that tile with `pmtiles` +
  `@mapbox/vector-tile` and picks the nearest road line whose bearing matches the exit
  segment. This needs no server work and uses tiles already fetched for the map. The
  fallback is Photon reverse geocoding, at most one call per maneuver.
- Prompt distances scale with speed: advance = `max(150 m, 20 s × v)`, near = `max(40 m, 6 s × v)`,
  plus one at the maneuver. Example: "In 200 feet, turn left onto Milwaukee Avenue, then
  stay on the protected lane."
- Units follow settings (ft/mi or m/km).

### 8.3 Off-route & rerouting
- Off-route when the snapped distance is > 30 m for > 5 s (or > 60 m immediately) with
  accuracy ≤ 25 m.
- Reroute from the current position. A heading hint is sent as a short virtual
  first leg so the new route doesn't start with a U-turn. There's a 10 s cooldown
  between reroutes.
- Remaining ETA = Σ predicted time for the remaining segments × a pace factor. The pace
  factor blends observed and predicted moving time over the last 5 minutes, weighted
  up to 50% observed.

### 8.4 Platform limitations
- iOS PWAs don't get background geolocation, so navigation requires the screen to stay
  on. Wake Lock is requested and the UI shows a hint about it. This is documented in the README.
- Voice on iOS needs a user gesture to unlock `speechSynthesis`. The "Start" button does this.

---

## 9. Settings (defaults)

| Group | Setting | Default |
|---|---|---|
| Bike | E-bike class | Class 2 (20 mph cutoff, throttle) |
| Bike | Cruising speed | 18 mph |
| Bike | Motor power | 500 W |
| Bike | Rider + bike weight | 220 lb / 100 kg |
| Bike | Riding position | Upright commuter |
| Route | Infrastructure ranking | §5.2 default order |
| Route | Pickiness `s` | 0.20 |
| Route | Max detour | +25% |
| Route | Avoid unpaved / rough / dismount / unsignalized arterial crossings | on / on / on / on |
| Behavior | Temperature | 0.2 |
| Behavior | Trail speed cap | 15 mph |
| Behavior | Descent cap | 25 mph |
| Nav | Voice | on |
| Nav | Units | Imperial |
| Nav | Record rides for calibration | off (opt-in) |

---

## 10. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | JS shell ≤ 60 KB gzip, excluding MapLibre (~220 KB gzip, loaded in parallel and cached). No other runtime dependencies over 10 KB without justification. |
| NFR-2 | First load ≤ 1.5 s (Moto G-class device, 4G); repeat load ≤ 0.5 s; time-to-interactive map ≤ 2 s. |
| NFR-3 | Route request p95 ≤ 400 ms server-side for trips ≤ 30 km; full client pipeline (3 alternatives + ETA) ≤ 800 ms. |
| NFR-4 | Static assets use content-hashed names and `Cache-Control: public, max-age=31536000, immutable`. Data files are versioned (`controls.v<N>.bin`, `chicago.v<N>.pmtiles`) and `index.html` is `no-cache`. |
| NFR-5 | Privacy: no analytics and no third-party calls except Photon geocoding. Ride recordings never leave the device unless the user exports them. |
| NFR-6 | Accessibility: WCAG AA contrast, large tap targets (≥ 48 px) for in-ride use, and a dark mode that follows the system setting. |
| NFR-7 | Resilience: if BRouter is unreachable, show the last computed route and a clear error. The UI stays usable offline. |

---

## 11. Deployment (Coolify)

`deploy/docker-compose.yml`, deployed as a single Coolify "Docker Compose" resource:

| Service | Image | Notes |
|---|---|---|
| `brouter` | Built from `routing/Dockerfile` (BRouter release jar + `ebike.brf`) | `JAVA_OPTS=-Xmx384m`, volume `segments:/segments4`, internal network only, `mem_limit: 512m` |
| `web` | Caddy + built app (multi-stage: `node` build → `caddy:alpine`) | Volume `data:/srv/data` for PMTiles + controls. Proxies `/route` → `brouter:17777/brouter`. Rate limit 30 req/min/IP on `/route` (caddy-ratelimit). `mem_limit: 64m` |

**Weekly data refresh** (Coolify scheduled task running `data/refresh.sh` in a
throwaway container):

1. `curl` `https://brouter.de/brouter/segments4/W90_N40.rd5` → atomic swap into the
   `segments` volume, then restart `brouter`.
2. `pmtiles extract <latest Protomaps daily build> chicago.v<N>.pmtiles --bbox=…`.
3. Download the Geofabrik `illinois-latest.osm.pbf` → `osmium extract --bbox` →
   `node data/build-controls.mjs` → `controls.v<N>.bin`. Write `data/manifest.json`
   with the new versions, then clean up the scratch files.

---

## 12. Roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 · Spike** (1–2 days) | BRouter + `W90_N40.rd5` on the VPS; minimal `ebike.brf`; curl tests | Confirmed: `profile:` overrides work; voicehints and `messages` include the needed way and node tags; whether segments include street names; RAM ≤ 450 MB; p95 latency ≤ 400 ms; trail rules verified |
| **1 · MVP** | Map, search, A→B with alternatives, infrastructure-colored route, ranking UI, temperature, ETA model + tests, comparison sheet, PWA shell, deploy | Golden routes look sensible; NFR-1/2/3 met |
| **2 · Navigation** | Turn-by-turn, voice, street-name resolution, rerouting, wake lock, ride recording | 5 real rides navigated end-to-end without a failed reroute |
| **3 · Accuracy** | Calibration (§7.6); Chicago Data Portal bike-route conflation; custom `.rd5` build with inferred stops; tuning `p_stop` from rides | G1 met on ≥ 10 recorded rides |
| **4 · Polish** | Saved places, bike-infrastructure overlay layer, shareable route links, presets | n/a |

---

## 13. Repository layout

```
apps/web/            Vite + Preact PWA
  src/eta/           ETA model (pure TS, unit-tested)
  src/nav/           Navigation engine (snapping, prompts, rerouting)
  src/routing/       Settings → BRouter params, response parsing, alternative ranking
  src/map/           MapLibre setup, style, route layers
routing/
  ebike.brf          BRouter profile (all costs as overridable variables)
  Dockerfile
data/
  refresh.sh         Weekly data refresh
  build-controls.mjs controls.bin builder
  trail-rules.json   Path-specific e-bike rules and speed caps
deploy/
  docker-compose.yml
  Caddyfile
docs/
  SPEC.md            This document
```

---

## 14. Open questions & risks

| # | Item | Mitigation |
|---|---|---|
| Q1 | OSM bike-infrastructure tagging completeness, especially in the suburbs | Phase 3 Data Portal conflation; route coloring makes gaps visible |
| Q2 | Accuracy of stop-sign inference on the residential grid | Calibrate `p_stop` from recorded rides; allow per-area overrides |
| Q3 | E-bike class rules on specific paths (Lakefront Trail, 606, Forest Preserves, suburban park districts) | Verify current ordinances in Phase 0 before encoding them in `trail-rules.json`; keep the rules user-overridable |
| Q4 | Photon public API rate limits or availability | Debounce, minimum 3 characters, recent-searches cache, Nominatim fallback for submitted queries |
| Q5 | Update cadence of brouter.de segment downloads | If they go stale, build the `.rd5` locally from the clipped extract with BRouter's map-creator (feasible for this bbox, same as Phase 3) |
| Q6 | GPS noise in the Loop's urban canyons | Accuracy gating, a longer off-route threshold when accuracy > 25 m, and progress constrained to move forward |
