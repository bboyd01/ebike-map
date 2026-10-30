import { decodeControls, type Controls } from '../controls/controls';
import type { AreaId } from '../settings/settings';

export interface AreaInfo {
  bbox: [number, number, number, number];
  pmtiles: string;
  controls: string;
}
export interface Manifest {
  version: number;
  areas: Record<AreaId, AreaInfo>;
}

/** Fallback bboxes (data/areas.env) so the map can frame the area before data exists. */
export const AREA_BBOX: Record<AreaId, [number, number, number, number]> = {
  city: [-87.95, 41.64, -87.52, 42.03],
  metro: [-88.45, 41.45, -87.5, 42.35],
};

export const AREA_LABEL: Record<AreaId, { name: string; detail: string; size: string }> = {
  city: { name: 'Chicago (city)', detail: "O'Hare to the lake, Howard St to 138th St", size: '~30–60 MB' },
  metro: { name: 'Chicagoland', detail: 'City plus Cook, DuPage, and parts of Lake, Kane, and Will', size: '~100–200 MB' },
};

let manifestPromise: Promise<Manifest | null> | null = null;

/** Forget cached manifest/controls (e.g. after the server finishes its first data build). */
export function resetDataCache() {
  manifestPromise = null;
  controlsCache.clear();
}

/** Progress of the server's data build (data/refresh.sh writes /data/status.json). */
export interface DataStatus {
  state: 'running' | 'done' | 'failed';
  step: number;
  steps: number;
  label: string;
  bytes?: number;
  total?: number;
  updated?: number;
}

export async function loadDataStatus(): Promise<DataStatus | null> {
  try {
    const r = await fetch('/data/status.json', { cache: 'no-store' });
    return r.ok ? ((await r.json()) as DataStatus) : null;
  } catch {
    return null;
  }
}

/** The data manifest, or null while the data service hasn't produced one yet. */
export function loadManifest(): Promise<Manifest | null> {
  manifestPromise ??= fetch('/data/manifest.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .catch(() => null);
  return manifestPromise;
}

const controlsCache = new Map<string, Promise<Controls | null>>();

export function loadControls(area: AreaId): Promise<Controls | null> {
  const key = area;
  let p = controlsCache.get(key);
  if (!p) {
    p = loadManifest().then(async (m) => {
      const file = m?.areas[area]?.controls;
      if (!file) return null;
      try {
        const res = await fetch(`/data/${file}`);
        return res.ok ? decodeControls(await res.arrayBuffer()) : null;
      } catch {
        return null;
      }
    });
    controlsCache.set(key, p);
  }
  return p;
}

/** Basemap URL: from the manifest, or VITE_PMTILES_URL in local development. */
export async function pmtilesUrl(area: AreaId): Promise<string | null> {
  const dev = import.meta.env.VITE_PMTILES_URL as string | undefined;
  if (dev) return dev;
  const m = await loadManifest();
  const file = m?.areas[area]?.pmtiles;
  return file ? new URL(`/data/${file}`, location.href).href : null;
}
