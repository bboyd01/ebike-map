import type { LonLat } from '../geo/geo';

export interface Place {
  label: string;
  detail: string;
  lonLat: LonLat;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
}

const ENDPOINT = 'https://photon.komoot.io/api/';

/** Autocomplete search, restricted to the area's bbox and biased toward `near` (SPEC FR-2). */
export async function searchPlaces(q: string, bbox: number[], near: LonLat | null, signal: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ q, limit: '6', lang: 'en', bbox: bbox.join(',') });
  if (near) {
    params.set('lon', String(near[0]));
    params.set('lat', String(near[1]));
  }
  const res = await fetch(`${ENDPOINT}?${params}`, { signal });
  if (!res.ok) throw new Error(`search failed (${res.status})`);
  const json = (await res.json()) as { features: PhotonFeature[] };
  return json.features.map(toPlace);
}

function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const label = p.name ?? (street || p.city || 'Unnamed place');
  const detail = [p.name && street ? street : null, p.district ?? p.locality, p.city].filter(Boolean).join(', ');
  return { label, detail, lonLat: f.geometry.coordinates };
}

const RECENT_KEY = 'ebike-map:recent:v1';

export function recentPlaces(): Place[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Place[];
  } catch {
    return [];
  }
}

export function rememberPlace(p: Place) {
  try {
    const list = [p, ...recentPlaces().filter((r) => r.label !== p.label || r.detail !== p.detail)].slice(0, 20);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

/** Best-effort label for a dropped pin ("1600 N Milwaukee Ave"); null if unavailable. */
export async function reverseLabel(p: LonLat, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lon=${p[0]}&lat=${p[1]}&limit=1&lang=en`, { signal });
    if (!res.ok) return null;
    const f = ((await res.json()) as { features: PhotonFeature[] }).features[0];
    return f ? toPlace(f).label : null;
  } catch {
    return null;
  }
}
