import type { LonLat } from '../geo/geo';
import { haversine } from '../geo/geo';

// Mirrors data/controls-format.mjs (the builder side of the format).
export const LAT_STEP = 0.01;
export const LON_STEP = 0.0135;
export const ControlType = { signal: 1, crossingSignal: 2, stop: 3, allWayStop: 4, giveWay: 5 } as const;

export interface Controls {
  version: number;
  bbox: [number, number, number, number];
  nx: number;
  ny: number;
  covered: Uint8Array; // bitmap
  /** microdegree "lon,lat" -> control type */
  byCoord: Map<string, number>;
  count: number;
}

export function decodeControls(buf: ArrayBuffer): Controls {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'EBC1') throw new Error(`bad controls file magic: ${magic}`);
  const version = dv.getUint32(4, true);
  const bbox = [0, 1, 2, 3].map((i) => dv.getInt32(8 + i * 4, true) / 1e6) as Controls['bbox'];
  const nx = dv.getUint16(24, true), ny = dv.getUint16(26, true), n = dv.getUint32(28, true);
  const bitmapLen = Math.ceil((nx * ny) / 8);
  const covered = new Uint8Array(buf, 32, bitmapLen);
  const lonOff = 32 + bitmapLen, latOff = lonOff + n * 4, typeOff = latOff + n * 4;
  const byCoord = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const lon = dv.getInt32(lonOff + i * 4, true), lat = dv.getInt32(latOff + i * 4, true);
    byCoord.set(`${lon},${lat}`, dv.getUint8(typeOff + i));
  }
  return { version, bbox, nx, ny, covered, byCoord, count: n };
}

export function isCovered(c: Controls, lon: number, lat: number): boolean {
  const x = Math.floor((lon - c.bbox[0]) / LON_STEP);
  const y = Math.floor((lat - c.bbox[1]) / LAT_STEP);
  if (x < 0 || y < 0 || x >= c.nx || y >= c.ny) return false;
  const i = y * c.nx + x;
  return ((c.covered[i >> 3] ?? 0) & (1 << (i & 7))) !== 0;
}

/** Control type at an exact route vertex (±1 µdeg for rounding), or 0. */
export function controlAt(c: Controls, p: LonLat): number {
  const lon = Math.round(p[0] * 1e6), lat = Math.round(p[1] * 1e6);
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const t = c.byCoord.get(`${lon + dx},${lat + dy}`);
      if (t) return t;
    }
  return 0;
}

export interface RouteControl {
  index: number; // geometry index
  type: number;
}

/**
 * Controls the route passes through, matched on route vertices only (a stop
 * sign on a side street next to the route is not counted).
 *
 * Controls of the same kind within `mergeM` of each other along the route
 * count once: one intersection often has several signal nodes (dual
 * carriageways, one per approach), and riding straight through a two-way stop
 * passes both approaches' stop nodes.
 */
export function controlsOnRoute(c: Controls, coords: LonLat[], mergeM = 30): RouteControl[] {
  const out: RouteControl[] = [];
  let along = 0;
  const lastAt = { signal: -Infinity, stop: -Infinity };
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) along += haversine(coords[i - 1]!, coords[i]!);
    const type = controlAt(c, coords[i]!);
    if (!type || type === ControlType.giveWay) continue;
    const kind = type === ControlType.signal || type === ControlType.crossingSignal ? 'signal' : 'stop';
    if (along - lastAt[kind] < mergeM) continue;
    lastAt[kind] = along;
    out.push({ index: i, type });
  }
  return out;
}
