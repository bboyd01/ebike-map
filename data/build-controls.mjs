#!/usr/bin/env node
// Builds <area>.controls.v<N>.bin from osmium OPL output (docs/SPEC.md §6.4).
//
// usage: node build-controls.mjs --bbox W,S,E,N --version N \
//          --controls controls.opl --arterials arterials.opl --out file.bin
//
// controls.opl:  nodes tagged highway=traffic_signals|stop|give_way or crossing=traffic_signals
// arterials.opl: primary/secondary/tertiary ways with node locations
//                (osmium add-locations-to-ways -f opl)
//
// A coverage cell is "covered" (count mode) when its lights look mapped:
//   - it has arterial junctions and ≥ 1 tagged signal per 3 of them, or
//   - it has no arterial junctions but at least one tagged stop sign.
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { CONTROL_TYPES, cellIndex, controlType, encodeControls, gridSize } from './controls-format.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
for (const k of ['bbox', 'version', 'controls', 'arterials', 'out']) {
  if (!args[k]) throw new Error(`missing --${k}`);
}
const bbox = args.bbox.split(',').map(Number);
const { nx, ny } = gridSize(bbox);

// OPL escapes special characters as %<hex codepoint>%.
const unescape = (s) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));

function parseTags(field) {
  const tags = {};
  if (!field) return tags;
  for (const kv of field.split(',')) {
    const eq = kv.indexOf('=');
    if (eq > 0) tags[unescape(kv.slice(0, eq))] = unescape(kv.slice(eq + 1));
  }
  return tags;
}

function fields(line) {
  const out = {};
  for (const tok of line.split(' ')) out[tok[0]] = tok.slice(1);
  return out;
}

async function* lines(path) {
  yield* createInterface({ input: createReadStream(path), crlfDelay: Infinity });
}

const controls = [];
const signalsPerCell = new Uint32Array(nx * ny);
const stopsPerCell = new Uint32Array(nx * ny);
for await (const line of lines(args.controls)) {
  if (line[0] !== 'n') continue;
  const f = fields(line);
  const type = controlType(parseTags(f.T));
  if (!type || !f.x || !f.y) continue;
  const lon = Number(f.x), lat = Number(f.y);
  const cell = cellIndex(bbox, nx, ny, lon, lat);
  if (cell < 0) continue;
  controls.push({ lon, lat, type });
  if (type === CONTROL_TYPES.signal) signalsPerCell[cell]++;
  if (type === CONTROL_TYPES.stop || type === CONTROL_TYPES.allWayStop) stopsPerCell[cell]++;
}

// Arterial junctions: nodes shared by arterial ways with different names
// (split segments of the same street share endpoints but aren't junctions).
const nodeNames = new Map(); // node id -> { lon, lat, names:Set }
for await (const line of lines(args.arterials)) {
  if (line[0] !== 'w') continue;
  const f = fields(line);
  const name = parseTags(f.T).name ?? `#${f.w}`;
  for (const ref of (f.N ?? '').split(',')) {
    const m = /^n(\d+)x(-?[\d.]+)y(-?[\d.]+)$/.exec(ref);
    if (!m) continue;
    let e = nodeNames.get(m[1]);
    if (!e) nodeNames.set(m[1], (e = { lon: Number(m[2]), lat: Number(m[3]), names: new Set() }));
    e.names.add(name);
  }
}
const junctionsPerCell = new Uint32Array(nx * ny);
for (const e of nodeNames.values()) {
  if (e.names.size < 2) continue;
  const cell = cellIndex(bbox, nx, ny, e.lon, e.lat);
  if (cell >= 0) junctionsPerCell[cell]++;
}

const covered = new Uint8Array(nx * ny);
for (let i = 0; i < nx * ny; i++) {
  covered[i] = junctionsPerCell[i] > 0 ? (signalsPerCell[i] * 3 >= junctionsPerCell[i] ? 1 : 0) : stopsPerCell[i] > 0 ? 1 : 0;
}

const bin = encodeControls({ version: Number(args.version), bbox, covered, controls });
writeFileSync(args.out, bin);
const coveredCount = covered.reduce((a, b) => a + b, 0);
console.log(
  JSON.stringify({ out: args.out, controls: controls.length, bytes: bin.length, cells: nx * ny, covered: coveredCount }),
);
