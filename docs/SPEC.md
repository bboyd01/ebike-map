# ebike-map — Product & Technical Specification

Status: **v0.3, Phase 1 built** · Scope: v1 (Chicago city, or city + collar suburbs; chosen on first launch) · Last updated: 2026-10-30

---

## 1. Summary

A fast, installable web app (PWA) for planning and riding routes on an e-bike, in
the style of Google Maps' bike mode but built around how e-bikes actually move:

- **Accurate ETAs at e-bike speeds.** These come from a physics-based speed model plus
  intersection delays, not a flat "bike speed".
- **Granular street-type preferences.** The rider drag-orders infrastructure types
  (shared lane, painted lane, protected lane, trail, greenway, quiet street, …), and
  the router follows that order.
- **A "temperature" setting.** A simple time buffer for stoplights and stop signs added to
  the ETA. It is based on the number of lights and stop signs on the route when those are
  mapped, and on a flat 0–50% of travel time when they aren't.
- **Average speed shown with every ETA**, so the rider can see the speed the arrival time
  assumes.
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

### 1.3 Coverage (map areas)

The rider picks a **map area on first launch** and can change it later in Settings:

| Area | Bounding box (W, S, E, N) | Basemap size (est.) | Notes |
|---|---|---|---|
| **Chicago (city)** (default) | `-87.95, 41.64, -87.52, 42.03` | ~30–60 MB | City limits plus a small pad: O'Hare to the lake, Howard St to 138th St |
| **Chicagoland** | `-88.45, 41.45, -87.50, 42.35` | ~100–200 MB | Adds the collar suburbs: Cook, DuPage, parts of Lake, Kane, and Will |

What the area controls: which basemap file and controls file are loaded, the geocoding
bbox, and where origins and destinations may be placed. The server keeps both areas,
since the city files only add about 50 MB, and switching areas is instant.

The map streams tiles on demand via range requests, so the smaller city area **doesn't
make the first load much faster**. Its benefits are smaller downloads for offline use
(Phase 4), faster weekly refreshes, and search results that stay inside the city.
Routing uses the same BRouter data file for both areas. More areas can be added later
without changing the architecture.

---

## 2. Tech stack

The stack is chosen to stay lean: **no database, no custom API server, two containers.**

| Layer | Choice | Rationale |
|---|---|---|
| Routing engine | **[BRouter](https://github.com/abrensch/brouter)** (Java, self-hosted Docker) | Purpose-built for bikes. Its profile scripting language costs ways and nodes on raw OSM tags (`cycleway=track` vs `lane` vs `shared_lane`, `highway=stop`, `traffic_signals`, surface, …). Profile variables can be overridden per request (`profile:<var>=<value>`), so one profile serves every user setting. Returns turn instructions ("voicehints"), elevation, per-segment tags, and alternative routes. One 5°×5° segment file (`W90_N40.rd5`) covers all of Chicagoland. Low memory use. |
| Basemap tiles | **[Protomaps](https://protomaps.com) PMTiles** extract per map area (§1.3) | One static file per area, served with HTTP range requests, so no tile server process. Vector tiles. Roughly 30–60 MB (city) and 100–200 MB (Chicagoland). |
| Map renderer | **MapLibre GL JS** + `pmtiles` protocol plugin | Vector rendering, smooth rotation and pitch for a heading-up navigation camera. |
| UI framework | **Vite + TypeScript + Preact** (+ `@preact/signals`) | About 4 KB runtime, fast builds, a familiar component model. |
| PWA | `vite-plugin-pwa` (Workbox) | Precached app shell, installable, works offline for UI and settings. |
| Geocoding | **Photon** (`photon.komoot.io`) with bbox + location bias | Free and supports autocomplete. Self-hosting needs Elasticsearch-scale resources, which this VPS doesn't have. Nominatim is a fallback for one-off lookups only, because its usage policy forbids autocomplete. |
| Voice | Web Speech API (`speechSynthesis`) | Built in, free, works offline. |
| Edge / static | **Caddy** container | Serves the app, PMTiles, and data files. Reverse-proxies `/route` to BRouter (BRouter itself is never exposed) and rate-limits. Sits behind Coolify's Traefik. |
| Data refresh | Small `data` container (shell scripts, weekly sleep loop) | Downloads the prebuilt `W90_N40.rd5` from brouter.de, re-extracts the PMTiles for both areas, and rebuilds the controls files (§6.4). |
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
| BRouter (`-Xmx384m`) | ≤ 450 MB | ~80 MB (`W90_N40.rd5`, 79 MB as of Oct 2026) |
| Caddy | ≤ 40 MB | app ≈ 2 MB, PMTiles ≈ 130–260 MB (both areas), controls ≈ 0.7 MB |
| `data` service (idle; weekly refresh) | ~5 MB idle, ≤ 512 MB while refreshing | ~400 MB scratch (Illinois `.osm.pbf`), deleted afterwards |

---

## 3. Architecture

```
 Phone (PWA)                                VPS (Coolify / Traefik)
 ┌──────────────────────────┐   HTTPS   ┌──────────────────────────────────────┐
 │ Preact UI + MapLibre     │──────────▶│ Caddy ("web")                        │
 │  • settings → profile    │           │  /            → static app (immutable)│
 │    params                │           │  /tiles/*.pmtiles → range requests   │
 │  • ETA model (client)    │           │  /data/<area>.controls.v<N>.bin      │
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

1. The client converts settings into BRouter profile params (§5.4).
2. It sends `GET /route?lonlats=…&profile=ebike&alternativeidx=0..2&format=geojson&timode=<n>&profile:cf_trail=…`.
   The three alternatives are fetched in parallel.
3. BRouter returns GeoJSON: geometry with elevation, a `messages` table (per-segment
   distance, way and node tags, costs), and `voicehints`.
4. The client's **ETA model** (§7) computes the moving time per segment and adds turn
   losses. It then adds the temperature offset (§6), counted from the controls file
   where controls are mapped and as a flat percentage elsewhere.
   **BRouter's own time estimate is ignored.**
5. The client ranks the alternatives (§5.5) and shows them on a comparison sheet.

---

## 4. Functional requirements

### 4.1 Map & search
- **FR-0** First-launch screen: choose the map area, either "Chicago (city)" or "Chicagoland" (§1.3), with the size of each shown. The choice can be changed in Settings.
- **FR-1** Full-screen vector map of the selected area. The map starts at the last viewport, or at the user's location if permission is granted.
- **FR-2** Search box with autocomplete (Photon, 250 ms debounce, restricted to the selected area's bbox, biased to the map center). Keeps a recent-searches list (last 20, stored locally).
- **FR-3** Long-press on the map sets an origin or destination. "My location" is the default origin.
- **FR-4** Up to 3 intermediate waypoints, drag-reorderable.

### 4.2 Routing
- **FR-5** Compute up to 3 alternative routes. Each shows ETA, arrival clock time, **average speed** (§7.5), distance, % of distance by infrastructure class (stacked bar), light and stop-sign count (or "estimated +N%" in flat mode, §6.3), and climb.
- **FR-6** The route line is colored by infrastructure class, so the rider can see where it uses shared lanes, protected lanes, and so on.
- **FR-7** Settings changes recompute the route immediately, using the same endpoints.
- **FR-8** "Depart at" is out of scope for v1. ETAs assume the current time with no traffic.

### 4.3 Navigation
- **FR-9** Turn-by-turn mode: heading-up camera, next-maneuver banner (arrow, street name, distance), remaining time, distance, arrival clock time, and average speed (the remaining-route speed the arrival time assumes, plus the actual average so far).
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
| Off-street trail | `trail` | Two-way `highway=cycleway`; `highway=path\|footway` + `bicycle=designated` |
| Protected lane | `protected` | `cycleway[:left\|:right\|:both]=track` (`:both=separate`); **one-way** `highway=cycleway` (Chicago maps its separated lanes as one-way cycleways beside the street; off-street trails are two-way) |
| Painted / buffered lane | `lane` | `cycleway[:*]=lane` (incl. `cycleway:*:buffer=*`) |
| Shared lane (sharrow) | `shared` | `cycleway[:*]=shared_lane` |
| Neighborhood greenway | `greenway` | Residential street that is part of an `lcn`/`rcn` bicycle route relation, or `bicycle_road=yes` |
| Quiet street | `quiet` | `highway=residential\|living_street\|unclassified`, or `service` that is not an alley, driveway or parking aisle (alleys rank as `other`) |
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
| `class3_mode` | auto (from bike class) | *Deferred:* class 3 restrictions on specific paths. BRouter's data doesn't carry way IDs or names, so `trail-rules.json` needs a custom `.rd5` build (Phase 3) |

`trail-rules.json` is a small, hand-maintained list of paths with e-bike class or speed
rules (e.g. Chicago Park District and Forest Preserve paths). **The rules must be verified
against current ordinances before shipping; see open question Q3.**

### 5.6 Bike lanes on through streets

Infrastructure on an arterial (a lane, protected lane or sharrow on a tertiary/secondary/
primary road) costs ×0.8 of the same class on a side street (`arterial_infra_bonus`).
Through streets are straight and signal-timed, and have no stop sign every block.

### 5.7 Express trails

Two-way `highway=cycleway` ways on a regional or national bike route
(`route_bicycle_rcn`/`ncn`), plus rail-trails (`railway=abandoned`), form the `express`
class. This covers the 606 (Bloomingdale Trail), the Lakefront Trail and other long
regional trails. They are not part of the ranking:

- **Routing:** cost per meter is `cf_express` = 1, below every ranked class (which are all
  multiplied by `cf_scale` = 2). There's a one-time `express_entry` cost of 150, applied
  through BRouter's `initialclassifier`, so a one-block hop doesn't pay off but staying
  on the trail for 2–3 blocks or more does.
- **ETA:** the rider's own `expressTrailMph` (default 20 mph, up to 30). No power model,
  trail cap or flat stop buffer, since these trails have essentially no stops.

### 5.8 Simplest route

Every trip also requests a "Simplest" route. It uses the same profile with every class at
cost 1, turns at 500, lights at 40 and stop signs at 20, so it follows the fewest, longest
streets regardless of bike infrastructure. It's always listed last. If it matches another
route, that route is tagged instead. Every card shows its turn count (left, right, sharp,
U-turn and roundabout from BRouter's voicehints; not slight bends or keep-left/right).

### 5.5 Ranking the alternatives

Each alternative gets the score `score = ETA_s × (1 + λ × (pref_cost / dist − 1))`,
where `pref_cost` is Σ(segment distance × cf(class)) and λ = 0.5. The lowest score is
shown first, but all alternatives stay visible. The comparison sheet labels each
alternative's tradeoff ("2 min faster", "+18% protected").

---

## 6. Temperature (stop-delay offset)

### 6.1 Definition

Temperature is a simple **time offset added on top of the moving time**. It doesn't change
how the bike's speed is modeled and doesn't change which route BRouter picks.

`T ∈ [0.0, 1.0]`, default **0.5**. The UI shows it as a slider labeled
*"Cautious (more buffer) ↔ Assertive (no buffer)"*. The offset shrinks linearly as T
rises: `level = 1 − T`.

- **T = 0** (cautious): the maximum offset. In count mode this assumes you catch every
  light at the start of its red and come to a full stop at every stop sign.
- **T = 0.5** (default): roughly an average day.
- **T = 1** (assertive): no offset; the ETA is moving time plus turn losses only.

The offset is computed in one of two modes, depending on whether the stop controls
along the route are known. One route can mix both modes (§6.3).

### 6.2 Mode A: count-based (controls are known)

Used when the route passes through areas where stoplights and stop signs are mapped
(§6.4 coverage):

```
offset = level × ( n_signals × t_signal + n_stop × t_stop + n_allway × t_allway )
```

| Constant | Meaning | Default (editable) |
|---|---|---|
| `t_signal` | Worst-case wait at a stoplight | 50 s |
| `t_stop` | Full stop at a stop sign (decel + stop + accel) | 8 s |
| `t_allway` | All-way stop, including yielding | 10 s |

At the default T = 0.5 this works out to about 25 s per light and 4 s per stop sign, which
is close to the average wait.

Only controls that are actually tagged in OpenStreetMap are counted. **Nothing is
guessed:** an intersection without a mapped light or stop sign adds no time in this mode.

### 6.3 Mode B: flat percentage (controls are not known)

Used when the route passes through areas where controls aren't mapped well, or if the
controls file hasn't loaded yet:

```
offset = level × flat_max × moving_time        flat_max default 0.50 (50%), editable 0–50%
```

At the default T = 0.5 this adds 25% to the moving time.

**Mixed routes:** the route is split by coverage cell. Count-based offsets apply to the
portions in covered cells and the flat percentage applies to the moving time of the rest,
so a route from the city out to a poorly mapped suburb is handled sensibly.

The route card shows which mode was used ("12 lights · 18 stop signs" or "estimated
+25%"), so the rider knows how the buffer was calculated.

### 6.4 Controls file (`controls.bin`) and coverage

Built weekly from the Geofabrik Illinois extract, clipped to the selected area's bbox
(`osmium extract`), by a small Node script in `data/`. One file is built per map area (§1.3).
It contains:

- **Tagged controls:** nodes with `highway=traffic_signals`, `highway=stop` (including
  `stop=all`), `highway=give_way`, and `crossing=traffic_signals`.
- **Per node:** lon/lat (int32 microdegrees) and type (u8: signal, pedestrian-crossing signal,
  stop, all-way stop, give way). The byte layout is documented in `data/controls-format.mjs`.
- **Coverage grid:** 1 km cells, each flagged *covered* if it has at least 1 tagged
  signal per 3 arterial×arterial junctions (nodes shared by differently named arterials).
  Cells with no arterial junctions are covered if they contain at least one tagged stop
  sign. This is a heuristic for whether the controls in that cell are mapped; it decides
  which mode to use, not where controls are. It gets tuned in Phase 0 against parts of the
  city where the mapping can be checked.

Expected size: roughly 15k nodes for Chicagoland and 6k for the city, so tens of KB
compressed. The file is lazy-loaded after first paint and cached by the service worker.
**Matching:** a control counts only when it is a *vertex* of the route geometry (BRouter
returns every way node it passes; ±1 µdeg tolerance for rounding). A stop sign on a side
street next to the route isn't counted. Controls of the same kind within 30 m of each
other along the route count once, since one intersection often has several signal nodes
and riding straight through a two-way stop passes both approaches' stop nodes.
Known limitation: OSM stop nodes rarely carry a direction, so turning from a through
street onto a stop-controlled street can count that street's stop sign once even though
you don't stop there.

### 6.5 Effect on routing

The offset only affects the ETA. BRouter keeps **fixed** node costs for tagged lights
and stop signs (`node_cost_signal` 250, `node_cost_stop` 60, in meters-equivalent), so
routes still mildly avoid stoplights no matter where the slider is. The alternatives
ranking (§5.5) uses the ETA including the offset, so in count mode the routes with fewer
lights rank higher.

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

- **Stops and signals:** not part of the moving time. They're covered by the temperature
  offset (§6), which is added after the moving time is computed.
- **Launch acceleration** (used for turn losses): `a_a = clamp(η·P_motor / (m · v_avg_launch), 0.6, 1.8)` m/s²
  with `v_avg_launch = v/2`. A throttle adds +0.2 (an instant launch).
- **Turns:** from each voicehint's angle `α`, take the geometric max speed
  `v_turn = sqrt(μ·g·R(α))` with R from a lookup table (90° city corner ≈ 6 m, 135° ≈ 4 m,
  μ = 0.5), scaled by 0.85 for comfort. The time loss for slowing from `v` to `v_turn`
  and speeding back up is `(v − v_turn)² / (2·v) · (1/a_d + 1/a_a)`, with `a_d` = 1.5 m/s².
- **Left turns at signals** count as 1.5 lights in count mode, to cover a two-stage turn
  or waiting for a gap.

### 7.5 Output

Per route:

- **Total ETA** = moving time + turn loss + temperature offset, and the arrival clock time.
- **Average speed** = distance ÷ total ETA. It's shown next to every ETA, e.g.
  `24 min · arrive 5:42 PM · avg 14.2 mph`. The route details also show the **moving
  average** (distance ÷ moving time, e.g. `17.1 mph moving`), so the rider can see how much
  of the gap comes from stops.
- **Breakdown:** moving time, turn loss, and offset. The offset shows its mode and inputs
  ("12 lights · 18 stop signs · +6 min", or "estimated +25% · +5 min").
- **Per-segment predicted speed**, stored for live re-estimation during navigation.

### 7.6 Personal calibration (Phase 3)

1. Recorded rides (FR-13) are map-matched to the route that was navigated.
2. For each class, compute `ratio = actual_moving_time / predicted_moving_time`, using
   only segments without a stop or signal.
   The offset is calibrated separately. In count mode, the time lost near matched
   lights and stop signs updates `t_signal` and `t_stop` (shown as the value at T = 0).
   In flat mode, the observed time lost at stops in uncovered areas suggests a value for
   `flat_max`. Both are suggestions the rider accepts in Settings; they never change silently.
3. Maintain an EWMA per class (α = 0.2, minimum 2 km of data before applying), clamped to
   [0.7, 1.4]. Apply it as a post-multiplier on that class's moving time.
4. Settings show "ETA learned from N rides", with a reset button.

### 7.7 Validation

- Unit tests: the power solver against hand-computed cases; both offset modes, including
  mixed coverage and the T = 0 and T = 1 endpoints; average-speed math; the
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
| Route | Avoid unpaved / rough / dismount | on / on / on |
| Behavior | Temperature (offset level = 1 − T) | 0.5 |
| Behavior | Worst-case wait per light / stop sign / all-way stop (`t_signal` / `t_stop` / `t_allway`) | 50 s / 8 s / 10 s |
| Behavior | Flat offset at T = 0 (`flat_max`, used where controls aren't mapped) | 50% (range 0–50%) |
| Behavior | Trail speed cap | 15 mph |
| Behavior | Descent cap | 25 mph |
| Map | Map area | Chosen on first launch (Chicago city suggested) |
| Nav | Voice | on |
| Nav | Units | Imperial |
| Nav | Record rides for calibration | off (opt-in) |

---

## 10. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | JS shell ≤ 60 KB gzip, excluding MapLibre (measured: app 37 KB; MapLibre 286 KB in its own preloaded chunk, plus its 147 KB worker; all cached by the service worker). No other runtime dependencies over 10 KB without justification. |
| NFR-2 | First load ≤ 1.5 s (Moto G-class device, 4G); repeat load ≤ 0.5 s; time-to-interactive map ≤ 2 s. |
| NFR-3 | First route p95 ≤ 1.5 s server-side for trips ≤ 25 km. Alternatives 1–2 load in the background and appear as they arrive (BRouter computes them cumulatively, so they cost 2–3× the first route). |
| NFR-4 | Static assets use content-hashed names and `Cache-Control: public, max-age=31536000, immutable`. Data files are versioned per area (`<area>.controls.v<N>.bin`, `<area>.v<N>.pmtiles`, where area is `city` or `metro`) and `index.html` is `no-cache`. |
| NFR-5 | Privacy: no analytics and no third-party calls except Photon geocoding. Ride recordings never leave the device unless the user exports them. |
| NFR-6 | Accessibility: WCAG AA contrast, large tap targets (≥ 48 px) for in-ride use, and a dark mode that follows the system setting. |
| NFR-7 | Resilience: if BRouter is unreachable, show the last computed route and a clear error. The UI stays usable offline. |

---

## 11. Deployment (Coolify)

`docker-compose.yml` (repo root; Coolify uses the root as the compose project directory), deployed as a single Coolify "Docker Compose" resource:

| Service | Image | Notes |
|---|---|---|
| `brouter` | `routing/Dockerfile`: `brouter.jar` from upstream's `ghcr.io/abrensch/brouter` image (pinned digest of a `master` build; release-tag images stop at v1.7.8, before lookups v11) + vendored `lookups.dat` v11.2 + `ebike.brf`. No compile step | `JAVA_OPTS=-Xmx384m`, volume `segments:/segments4`, internal network only, `mem_limit: 512m` |
| `web` | Stock Caddy + built app (multi-stage: `node` build → `caddy:2-alpine`) | Volume `data:/srv/data` for PMTiles + controls. Proxies only `/route` → `brouter:17777/brouter`. No rate-limit plugin (keeps the build light); BRouter's `MAX_THREADS` bounds load. `mem_limit: 64m` |

| `data` | Built from `data/Dockerfile` (Debian: node + osmium-tool + pmtiles CLI) | `data/schedule.sh` runs `data/refresh.sh` once at first start if `/srv/data` is empty (retrying hourly), then Mondays 09:17 UTC. Volumes `segments` and `data`. `mem_limit: 512m` |

**Weekly data refresh** (`data/refresh.sh`):

1. `curl` `https://brouter.de/brouter/segments4/W90_N40.rd5` → atomic rename into the
   `segments` volume. BRouter opens segment files per request, so no restart should be
   needed (confirmed in Phase 0).
2. `pmtiles extract <latest Protomaps daily build> <area>.v<N>.pmtiles --bbox=…`, once per
   area. The city bbox lies inside the metro bbox, so the city file is extracted from the
   new metro file locally rather than downloaded twice.
3. Download the Geofabrik `illinois-latest.osm.pbf` → `osmium extract --bbox` (per area) →
   `node data/build-controls.mjs` → `<area>.controls.v<N>.bin`. Write `data/manifest.json`
   with the new versions per area, then clean up the scratch files.

---

## 12. Roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 · Spike** (1–2 days) | BRouter + `W90_N40.rd5` on the VPS; minimal `ebike.brf`; curl tests | Confirmed: `profile:` overrides work; voicehints and `messages` include the needed way and node tags; whether segments include street names; RAM ≤ 450 MB; first-route p95 ≤ 1.5 s; trail rules verified. Partly done in the cloud session, see §15 |
| **1 · MVP** | First-launch area picker, map, search, A→B with alternatives, average speed on route cards, infrastructure-colored route, ranking UI, temperature offset (both modes), ETA model + tests, comparison sheet, PWA shell, deploy | Golden routes look sensible; NFR-1/2/3 met |
| **2 · Navigation** | Turn-by-turn, voice, street-name resolution, rerouting, wake lock, ride recording | 5 real rides navigated end-to-end without a failed reroute |
| **3 · Accuracy** | Calibration (§7.6); Chicago Data Portal bike-route conflation; tuning `t_signal`/`t_stop`, `flat_max` and the coverage heuristic from rides | G1 met on ≥ 10 recorded rides |
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
  trail-rules.json   Path-specific e-bike rules (Phase 3, needs custom .rd5)
docker-compose.yml   Coolify resource (repo root)
deploy/
  Caddyfile
  web.Dockerfile
docs/
  SPEC.md            This document
```

---

## 14. Open questions & risks

| # | Item | Mitigation |
|---|---|---|
| Q1 | OSM bike-infrastructure tagging completeness, especially in the suburbs | Phase 3 Data Portal conflation; route coloring makes gaps visible |
| Q2 | Stop signs missing from OSM make count mode under-estimate the offset, since nothing is guessed | The route card shows the counts, so gaps are visible; the rider can lower the slider's assertiveness, or the gaps can be fixed in OSM directly |
| Q2b | The coverage heuristic (§6.4) may mark a cell "covered" when its signals are only partly mapped, which undercounts the offset | Tune against the city in Phase 0; the route card shows the counts, so an undercount is visible |
| Q3 | E-bike class rules on specific paths (Lakefront Trail, 606, Forest Preserves, suburban park districts) | Verify current ordinances in Phase 0 before encoding them in `trail-rules.json`; keep the rules user-overridable |
| Q4 | Photon public API rate limits or availability | Debounce, minimum 3 characters, recent-searches cache, Nominatim fallback for submitted queries |
| Q5 | Update cadence of brouter.de segment downloads | If they go stale, build the `.rd5` locally from the clipped extract with BRouter's map-creator (feasible for this bbox, same as Phase 3) |
| Q6 | GPS noise in the Loop's urban canyons | Accuracy gating, a longer off-route threshold when accuracy > 25 m, and progress constrained to move forward |

---

## 15. Phase 0 findings (2026-10-29, cloud session)

Run against real data: `W90_N40.rd5` from brouter.de (79 MB, built 2026-10-29) with
`routing/spike.mjs` on six Chicago trips. GitHub was unreachable from the session, so the
engine was **BRouter 1.6.3** (the newest build on brouter.de) with the current v11
`lookups.dat`. Production uses the current release (`routing/Dockerfile`), and the spike
must be re-run there.

| Check | Result |
|---|---|
| `profile:<var>=<value>` URL overrides | **Work.** Changing cost factors changes the route and cost |
| `messages` columns (Longitude, Latitude, Elevation, Distance, WayTags, NodeTags) | Present. Longitude/Latitude are degrees × 1e6, as the parser assumes |
| Way tags for classification | Present: `cycleway`, `cycleway:both/left/right`, `route_bicycle_lcn`, `surface`, `service=alley`, … |
| Street names | **Absent** (`name` isn't in the lookup table). Names come from basemap tiles (§8.2) |
| NodeTags | Present: `highway=traffic_signals`, `highway=crossing` + `crossing=traffic_signals`, `highway=stop` (+ `direction`) |
| Voicehints | Present: `[geometryIndex, command, exit, distance, angle]` |
| Geometry density | Every way node (~24 m mean spacing), so vertex matching of controls works |
| RAM | ~210–230 MB resident with `-Xmx384m` |
| First-route latency | p50 313 ms, **p95 1.86 s** (driven by a 24 km trip). Misses the 1.5 s target here; re-measure on the VPS |
| Alternatives 1 / 2 | p95 3.9 s / 5.7 s |

**Profile fixes the data forced:**

- Unknown tag values are hard errors in BRouter, so the profile only uses values in the
  lookup table (no `cycleway=separate`, `access=forestry`, …).
- Chicago alleys (`service=alley`) were treated as quiet streets and attracted 2 km of a
  10 km route. They now rank as `other`.
- Ways without a `highway` tag (abandoned rail spurs) were routable. They are now blocked.
- One-way `highway=cycleway` is now a protected lane, not a trail. This moved the
  Logan Square → Loop route to 52% protected lane along Milwaukee Ave.
- Signalized intersections carry 2–4 `crossing=traffic_signals` nodes, so every light was
  being charged 3–4 times (30 charges on one 10 km trip). These nodes now get their own,
  smaller cost (`node_cost_crossing_signal` = 80). That roughly halved latency and removed
  the zig-zag routing (54 → 44 turn instructions).
- BRouter's built-in HTTP server ends header lines with a bare `\n`. Caddy accepts that;
  Node's `fetch` doesn't (the spike script uses the lenient parser).

**Checked against the BRouter 1.7.10 source** (cloned; not built or run here): its
`lookups.dat` is identical to the v11 table tested above, `profile:xxx` request parameters
are supported, `alternativeidx` is optional, and HTTP headers end in `\r\n` (the bare `\n`
issue is specific to 1.6.3). `routing/Dockerfile` now copies the jar from upstream's published image instead of compiling (the Gradle and Caddy plugin compiles were too heavy for the VPS build).

**Open after Phase 0:** latency on the VPS with the current release; trail rules (Q3); the
coverage heuristic (needs the Geofabrik extract, which was unreachable).

---

## 16. Phase 1 notes (2026-10-30)

Built: first-launch area picker; full-screen map (MapLibre + Protomaps PMTiles, light/dark
flavors); Photon search with recent places; "My location"; long-press / right-click to
drop a start or destination; up to 3 alternatives fetched progressively; selected route
colored by infrastructure class, others gray; route cards with ETA, arrival time, average
speed, moving average, class bar and stop-buffer breakdown; settings for bike,
drag-to-rank street preferences, pickiness, detour, avoid toggles, temperature (with
advanced constants), units and map area; installable PWA with an offline app shell.

- **Re-estimate without refetching.** Only route-shaping settings (endpoints, ranking,
  pickiness, avoid toggles) call BRouter again. Speed, weight, temperature, caps and units
  re-run the ETA model on the routes already fetched, so the cards update instantly.
- **MapLibre v6 worker.** MapLibre resolves its worker next to its own module file, which
  doesn't exist after bundling. The worker ships as a separate asset and is registered with
  `setWorkerUrl` (`src/map/MapView.tsx`).
- **Chromium compositing bug.** When the route list overflowed the bottom sheet, Chromium
  left a blank rectangle over the map above it (reproduced headless, in both themes and with
  and without GPU emulation). Only giving the sheet `opacity: 0.999` cleared it; `contain`,
  `isolation`, `translateZ` and `will-change` didn't. Worth re-checking on a real phone.
- Verified in a browser end to end against real Chicago data: search, routing, alternative
  selection, re-ranking (refetches with the new costs), drag-to-reorder (busy roads clamped
  to 5th), settings persistence across reloads; no console errors.

---

## 17. Route tuning (2026-10-30)

From first real use: routes had too many turns, and the 606 and Lakefront Trail weren't
favored. Tuned against nine Chicago trips on the real segment data (`tune*.py` harness in
the session; results in the table).

| Setting | Before | After | Why |
|---|---|---|---|
| `turn_cost` (per 90°) | 20 | 200 | Long straightaways over zig-zags |
| `node_cost_signal` / crosswalk signal / stop | 250 / 80 / 60 | 80 / 25 / 30 | High light costs pushed routes off through streets (Milwaukee Ave) onto side-street zig-zags |
| `cf_scale` | n/a | 2.0 | Room for express trails below every ranked class |
| `arterial_infra_bonus` | n/a | 0.8 | Prefer lanes on through streets |
| `cf_express` / `express_entry` | n/a | 1.0 / 150 | Favor the 606 and Lakefront Trail beyond 2–3 blocks |

| Trip | Before | After |
|---|---|---|
| Logan Square → Loop | 6.7 mi, 22 turns | 5.8–6.0 mi, 3–7 turns, along Milwaukee Ave |
| Lincoln Park → Museum Campus | n/a | 80% Lakefront Trail |
| Hyde Park → Loop | n/a | 86% Lakefront Trail |
| 606 west trailhead → Damen | n/a | 70% on the 606 |

Also added in this round: the app asks for location at launch and centers on it; a
server data-build progress banner (`/data/status.json`, written by `data/refresh.sh`);
and an optional offline basemap download per area (Cache Storage, served through the
same `pmtiles://` URL).

---

## 18. Stoplights only; data build fixes (2026-10-30)

- **Stop signs are no longer counted.** OSM's stop-sign coverage in Chicago is incomplete.
  The temperature offset now counts mapped **stoplights** only. Riding time on side
  streets (`residential`, `living_street`, `unclassified`, `service`), where the stop signs
  are, gets the flat % instead, as does time anywhere lights aren't mapped (coverage grid).
  Express trails get no buffer. Nothing is placed by guessing. This supersedes the stop-sign
  parts of §6.2 and §6.4; the `t_stop` and `t_allway` settings are gone.
- **Out-of-memory fix.** The first deploy's stoplight step was OOM-killed: `osmium extract`
  over the whole Illinois file exceeded the `data` container's 512 MB limit. The build now
  uses streaming `osmium tags-filter` passes (stoplight nodes; arterial ways plus their
  nodes) and clips to each area in `build-controls.mjs`. Peak memory is tens of MB.
- **The map no longer waits for stoplights.** `refresh.sh` publishes the basemaps and
  manifest right after they're built, then builds the stoplight file. If that step fails,
  the map still works, ETAs use the flat buffer (or the previous stoplight file), and
  `status.json` reports the failure.
- **Dismissible notices.** The data-setup banner, location notices and routing errors are
  toasts with a close button.
- **Cornering speed** (setting, default 13 mph): the speed through a 90° corner (×1.5 at
  45°, ×0.75 at 135°, ×0.4 for a U-turn). Each turn costs the time to slow from the
  current speed to it and accelerate back (§7.4), replacing the fixed corner-radius table.
- **Express-trail routing fix** (shipped in PR #9 alongside `minor_street_factor`): no turn
  cost on express trails (curves and ramps aren't street corners), and express and plain
  trails share one entry classifier, so pieces of the 606 don't re-charge the entry cost.

---

## 19. Speed-based routing and calibrated ETAs (2026-10-30)

The rider's own average speeds by street type (stops included) now drive both routing
and ETAs. Defaults come from the rider's trips:

| Street type | Avg (mph) | Notes |
|---|---|---|
| Lakefront Trail | 23 | Express trail near the lake (shoreline heuristic) |
| 606, off-peak / busy | 23 / 16 | Busy = weekdays 7–9:30, 11:30–1:30, 4–7, March–November, Chicago time |
| Other regional trails | 20 | |
| Painted/shared lanes on through streets | 16 | Elston, Damen, Clark, Division |
| Protected lanes | 17 | Milwaukee, Belmont, Augusta (heavy bike traffic) |
| Busy roads, no bike lane | 23 | North, Western, Ashland, Fullerton; ×2 safety penalty in routing |
| Side streets (with or without lanes) | 14 | Assumed; stop sign most blocks |
| Park paths / other | 14 / 10 | Assumed |

- **Routing = fastest time.** Cost per meter is the class's time per meter relative to the
  fastest class (`routingFactors`, `cf_scale` = 1). The 606's cost follows the departure
  time (`cf_railtrail`). Busy roads without a bike lane are ×`busyRoadPenalty` (2), so they
  serve as short connectors but not long stretches. The drag-to-rank list is a small
  tie-breaker (default ×1.03 per rank). New profile variables: `cf_railtrail`,
  `cf_infra_minor`.
- **ETA = the model, calibrated.** For each class, the moving speed is back-solved so that,
  at the default temperature (0.5), moving time plus the model's stops reproduces the
  rider's average:
  - through streets: lights at 4 per mile × 8 s (`t_signal` = 16 s worst case);
  - side streets: the flat 25%;
  - trails: no stops.

  Mapped lights are counted; on through streets where they aren't mapped, lights are
  estimated at that same rate. Grades under 2% count as flat (elevation noise), and descents
  are never slower than flat. Cautious and assertive temperatures move the result below or
  above the rider's averages.
- **Settings migration** (schema 2): earlier tie-break strength and light-wait values are
  reset to the new defaults; everything else is kept.
- **Location:** used silently if already allowed. Otherwise a "Use my location" notice
  appears, whose button (a tap) shows the prompt, as mobile browsers require. Picking the
  map area also asks. If blocked, the notice gives re-enable steps for iPhone and Android.

