// Binary format for <area>.controls.v<N>.bin (docs/SPEC.md §6.4). Little-endian.
//
//   0  'EBC1'                      magic
//   4  u32  version                 e.g. 20261029
//   8  i32  west, south, east, north (microdegrees)
//  24  u16  nx, u16 ny             coverage grid size
//  28  u32  n                      control count
//  32  u8[ceil(nx*ny/8)]           coverage bitmap, row-major from (west, south)
//      i32[n] lon, i32[n] lat      microdegrees
//      u8[n]  type                 see CONTROL_TYPES
//
// Only OSM-tagged controls are stored; nothing is inferred.

export const MAGIC = 'EBC1';
export const LAT_STEP = 0.01; // ~1.1 km
export const LON_STEP = 0.0135; // ~1.1 km at Chicago's latitude
export const CONTROL_TYPES = { signal: 1, crossingSignal: 2, stop: 3, allWayStop: 4, giveWay: 5 };

/** Maps OSM node tags to a CONTROL_TYPES value (0 = not a control). */
export function controlType(tags) {
  if (tags.highway === 'traffic_signals') return CONTROL_TYPES.signal;
  if (tags.crossing === 'traffic_signals') return CONTROL_TYPES.crossingSignal;
  if (tags.highway === 'stop') return tags.stop === 'all' ? CONTROL_TYPES.allWayStop : CONTROL_TYPES.stop;
  if (tags.highway === 'give_way') return CONTROL_TYPES.giveWay;
  return 0;
}

export function gridSize(bbox) {
  const [w, s, e, n] = bbox;
  // Epsilon keeps float error (0.1 / 0.01 = 10.000000000000002) from adding a cell.
  return { nx: Math.ceil((e - w) / LON_STEP - 1e-9), ny: Math.ceil((n - s) / LAT_STEP - 1e-9) };
}

export function cellIndex(bbox, nx, ny, lon, lat) {
  const x = Math.floor((lon - bbox[0]) / LON_STEP);
  const y = Math.floor((lat - bbox[1]) / LAT_STEP);
  if (x < 0 || y < 0 || x >= nx || y >= ny) return -1;
  return y * nx + x;
}

/** @param {{version:number,bbox:number[],covered:Uint8Array|boolean[],controls:{lon:number,lat:number,type:number}[]}} d */
export function encodeControls({ version, bbox, covered, controls }) {
  const { nx, ny } = gridSize(bbox);
  const n = controls.length;
  const bitmapLen = Math.ceil((nx * ny) / 8);
  const buf = new ArrayBuffer(32 + bitmapLen + n * 9);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, MAGIC.charCodeAt(i));
  dv.setUint32(4, version, true);
  bbox.forEach((v, i) => dv.setInt32(8 + i * 4, Math.round(v * 1e6), true));
  dv.setUint16(24, nx, true);
  dv.setUint16(26, ny, true);
  dv.setUint32(28, n, true);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < nx * ny; i++) if (covered[i]) bytes[32 + (i >> 3)] |= 1 << (i & 7);
  const lonOff = 32 + bitmapLen;
  const latOff = lonOff + n * 4;
  const typeOff = latOff + n * 4;
  controls.forEach((c, i) => {
    dv.setInt32(lonOff + i * 4, Math.round(c.lon * 1e6), true);
    dv.setInt32(latOff + i * 4, Math.round(c.lat * 1e6), true);
    dv.setUint8(typeOff + i, c.type);
  });
  return bytes;
}
