#!/usr/bin/env node
// Builds <area>.controls.v<N>.bin for every map area from osmium OPL output (SPEC §6.4).
//
// usage: node build-controls.mjs --areas "city=W,S,E,N;metro=W,S,E,N" --version N \
//          --signals signals.opl --arterials arterials.opl --outdir DIR
//
// signals.opl:   nodes tagged highway=traffic_signals or crossing=traffic_signals
//                (osmium tags-filter -R ... -f opl; streaming, low memory)
// arterials.opl: primary/secondary/tertiary ways with node locations
//                (osmium add-locations-to-ways -f opl)
//
// Only stoplights are stored. Stop signs are left out: OSM's stop-sign coverage in Chicago
// is incomplete, so time on side streets gets the flat buffer instead (SPEC §6).
//
// A coverage cell is "covered" (lights counted) when its lights look mapped: it has no
// arterial junctions (no lights expected), or ≥ 1 tagged signal per 3 of them.
import { createReadStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { CONTROL_TYPES, cellIndex, controlType, encodeControls, gridSize } from './controls-format.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
for (const k of ['areas', 'version', 'signals', 'arterials', 'outdir']) {
  if (!args[k]) throw new Error(`missing --${k}`);
}
const areas = args.areas.split(';').map((spec) => {
  const [name, bbox] = spec.split('=');
  return { name, bbox: bbox.split(',').map(Number) };
});

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

// Stoplights (statewide; clipped per area below).
const signals = [];
for await (const line of lines(args.signals)) {
  if (line[0] !== 'n') continue;
  const f = fields(line);
  const type = controlType(parseTags(f.T));
  if ((type !== CONTROL_TYPES.signal && type !== CONTROL_TYPES.crossingSignal) || !f.x || !f.y) continue;
  signals.push({ lon: Number(f.x), lat: Number(f.y), type });
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
const junctions = [...nodeNames.values()].filter((e) => e.names.size >= 2);

for (const { name, bbox } of areas) {
  const { nx, ny } = gridSize(bbox);
  const inArea = signals.filter((c) => cellIndex(bbox, nx, ny, c.lon, c.lat) >= 0);
  const signalsPerCell = new Uint32Array(nx * ny);
  const junctionsPerCell = new Uint32Array(nx * ny);
  for (const c of inArea) if (c.type === CONTROL_TYPES.signal) signalsPerCell[cellIndex(bbox, nx, ny, c.lon, c.lat)]++;
  for (const j of junctions) {
    const cell = cellIndex(bbox, nx, ny, j.lon, j.lat);
    if (cell >= 0) junctionsPerCell[cell]++;
  }
  const covered = new Uint8Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) covered[i] = junctionsPerCell[i] === 0 || signalsPerCell[i] * 3 >= junctionsPerCell[i] ? 1 : 0;

  const out = join(args.outdir, `${name}.controls.v${args.version}.bin`);
  const bin = encodeControls({ version: Number(args.version), bbox, covered, controls: inArea });
  writeFileSync(out, bin);
  const coveredCount = covered.reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ out, signals: inArea.length, bytes: bin.length, cells: nx * ny, covered: coveredCount }));
}
