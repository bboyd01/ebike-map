#!/usr/bin/env node
// Phase 0 spike (docs/SPEC.md §12): checks the spec's must-verify assumptions
// against a running BRouter with ebike.brf. Zero dependencies; Node ≥ 18.
//
//   node routing/spike.mjs http://localhost:17777/brouter
//
// Exit code 0 only if every check passes.

const base = process.argv[2] ?? 'http://localhost:17777/brouter';

// Real Chicago trips (lon,lat).
const TRIPS = {
  'Logan Square → Loop (Milwaukee Ave)': [[-87.7078, 41.9295], [-87.6301, 41.884]],
  'Hyde Park → Loop (Lakefront)': [[-87.587, 41.7913], [-87.6226, 41.8826]],
  'Rogers Park → Lincoln Park': [[-87.661, 41.9988], [-87.6513, 41.9214]],
  'Pilsen → West Loop': [[-87.6466, 41.8579], [-87.6476, 41.8826]],
  'Wicker Park → Lakeview': [[-87.6796, 41.9088], [-87.6681, 41.9398]],
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

function url(points, extra = {}) {
  const q = new URLSearchParams({
    lonlats: points.map(([x, y]) => `${x},${y}`).join('|'),
    profile: 'ebike',
    alternativeidx: '0',
    format: 'geojson',
    timode: '1',
    ...extra,
  });
  return `${base}?${q}`;
}

async function route(points, extra) {
  const t0 = performance.now();
  const res = await fetch(url(points, extra));
  const ms = performance.now() - t0;
  const text = await res.text();
  if (!res.ok || !text.startsWith('{')) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return { json: JSON.parse(text), ms };
}

const [firstName, firstTrip] = Object.entries(TRIPS)[0];

// 1. Profile loads and routes.
let first;
try {
  first = await route(firstTrip);
  check('ebike.brf loads and returns a route', true, `${firstName}, ${first.json.features[0].properties['track-length']} m`);
} catch (e) {
  check('ebike.brf loads and returns a route', false, e.message);
  process.exit(1);
}
const props = first.json.features[0].properties;

// 2. messages table with the columns the client parser needs.
const header = props.messages?.[0] ?? [];
for (const col of ['Longitude', 'Latitude', 'Elevation', 'Distance', 'WayTags', 'NodeTags']) {
  check(`messages has column ${col}`, header.includes(col));
}
const rows = (props.messages ?? []).slice(1);
const lonCol = header.indexOf('Longitude');
const coord0 = first.json.features[0].geometry.coordinates[0];
const msgLon = Number(rows[0]?.[lonCol]);
check(
  'messages Longitude is lon × 1e6 (parser assumption)',
  Math.abs(msgLon / 1e6 - coord0[0]) < 0.05,
  `first row ${msgLon}, geometry ${coord0[0]}`,
);

// 3. Way tags needed for classification appear; street names (expected absent).
const wayTags = rows.map((r) => r[header.indexOf('WayTags')] ?? '').join(' ');
check('WayTags include highway=', /\bhighway=/.test(wayTags));
check('WayTags include some cycleway tag', /\bcycleway(:\w+)?=/.test(wayTags), 'Milwaukee Ave has bike lanes');
console.log(`INFO  street names in WayTags: ${/\bname=/.test(wayTags) ? 'present' : 'absent (use basemap tiles, SPEC §8.2)'}`);

// 4. NodeTags report signals / stop signs on the route.
const nodeTags = rows.map((r) => r[header.indexOf('NodeTags')] ?? '').join(' ');
console.log(
  `INFO  NodeTags: signals=${(nodeTags.match(/highway=traffic_signals/g) ?? []).length} stops=${(nodeTags.match(/highway=stop/g) ?? []).length}`,
);

// 5. Voicehints.
check('voicehints present', Array.isArray(props.voicehints) && props.voicehints.length > 0, `${props.voicehints?.length ?? 0} hints, first: ${JSON.stringify(props.voicehints?.[0])}`);

// 6. Geometry keeps every way node (controls are matched on route vertices, SPEC §6.4).
const coords = first.json.features[0].geometry.coordinates;
const meanGap = Number(props['track-length']) / Math.max(coords.length - 1, 1);
console.log(`INFO  geometry: ${coords.length} points, mean spacing ${meanGap.toFixed(1)} m (city blocks ≈ 100 m → expect < 60 m)`);

// 7. profile: overrides take effect.
try {
  const shared = await route(firstTrip, { 'profile:cf_trail': '1', 'profile:cf_arterial': '1', 'profile:cf_quiet': '1' });
  const costA = props['cost'], costB = shared.json.features[0].properties['cost'];
  check('profile:<var> URL overrides change the result', costA !== costB, `cost ${costA} → ${costB}`);
} catch (e) {
  check('profile:<var> URL overrides change the result', false, e.message);
}

// 8. Alternatives.
try {
  const alt = await route(firstTrip, { alternativeidx: '1' });
  check('alternativeidx=1 returns a different route', alt.json.features[0].properties['track-length'] !== props['track-length']);
} catch (e) {
  check('alternativeidx=1 returns a route', false, e.message);
}

// 9. Latency over all trips × 3 alternatives × 3 rounds.
const times = [];
for (let round = 0; round < 3; round++)
  for (const pts of Object.values(TRIPS))
    for (const alt of ['0', '1', '2']) {
      try {
        times.push((await route(pts, { alternativeidx: alt })).ms);
      } catch {
        /* counted as missing */
      }
    }
times.sort((a, b) => a - b);
const p95 = times[Math.floor(times.length * 0.95)] ?? Infinity;
check('route latency p95 ≤ 400 ms', p95 <= 400, `p50 ${times[Math.floor(times.length / 2)]?.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, n=${times.length}`);
console.log('INFO  check RAM separately: docker stats --no-stream (target ≤ 450 MB for brouter)');

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
