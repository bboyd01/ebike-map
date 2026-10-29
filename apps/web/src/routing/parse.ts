import type { LonLat } from '../geo/geo';
import { parseTagString, type Tags } from './classify';

/** One stretch of the route between two consecutive geometry points. */
export interface Edge {
  from: number; // geometry index
  to: number;
  wayTags: Tags;
}

export interface ParsedRoute {
  coords: LonLat[];
  elev: (number | null)[];
  edges: Edge[];
  /** NodeTags reported by BRouter, keyed by geometry index (may be empty; see SPEC §12 Phase 0). */
  nodeTags: Map<number, Tags>;
  /** Raw voicehints rows, kept for the navigation engine. */
  voicehints: number[][];
}

interface BRouterFeature {
  geometry: { coordinates: number[][] };
  properties: { messages?: string[][]; voicehints?: number[][] };
}

/**
 * Parses BRouter GeoJSON (format=geojson). The `messages` table starts with a
 * header row; each later row describes the stretch *ending* at its lon/lat
 * (microdegrees) with the given WayTags. Column order is read from the header.
 */
export function parseBRouter(geojson: { features: BRouterFeature[] }): ParsedRoute {
  const f = geojson.features[0];
  if (!f) throw new Error('BRouter response has no features');
  const coords = f.geometry.coordinates.map((c) => [c[0], c[1]] as LonLat);
  const elev = f.geometry.coordinates.map((c) => (c.length > 2 && Number.isFinite(c[2]) ? (c[2] as number) : null));
  const msgs = f.properties.messages ?? [];
  const header = msgs[0] ?? [];
  const col = (name: string) => header.indexOf(name);
  const iLon = col('Longitude'), iLat = col('Latitude'), iWay = col('WayTags'), iNode = col('NodeTags');

  const key = (lon: number, lat: number) => `${Math.round(lon * 1e6)},${Math.round(lat * 1e6)}`;
  const indexByCoord = new Map<string, number[]>();
  coords.forEach((c, i) => {
    const k = key(c[0], c[1]);
    const list = indexByCoord.get(k);
    if (list) list.push(i);
    else indexByCoord.set(k, [i]);
  });

  const edges: Edge[] = [];
  const nodeTags = new Map<number, Tags>();
  let cursor = 0;
  for (const row of msgs.slice(1)) {
    const lon = Number(row[iLon]) / 1e6, lat = Number(row[iLat]) / 1e6;
    const candidates = indexByCoord.get(key(lon, lat)) ?? [];
    const end = candidates.find((i) => i > cursor) ?? candidates.find((i) => i >= cursor);
    if (end === undefined) continue;
    const wayTags = parseTagString(row[iWay]);
    for (let i = cursor; i < end; i++) edges.push({ from: i, to: i + 1, wayTags });
    if (iNode >= 0 && row[iNode]) nodeTags.set(end, parseTagString(row[iNode]));
    cursor = end;
  }
  // Any tail not covered by a message row inherits the last known tags.
  const last = edges.at(-1)?.wayTags ?? {};
  for (let i = cursor; i < coords.length - 1; i++) edges.push({ from: i, to: i + 1, wayTags: last });

  return { coords, elev, edges, nodeTags, voicehints: f.properties.voicehints ?? [] };
}
