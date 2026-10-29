import type { LonLat } from '../geo/geo';
import { costFactors, type Settings } from '../settings/settings';

/** BRouter turn-instruction mode; final value confirmed in the Phase 0 spike. */
export const TIMODE = 1;

/** Profile variable overrides for routing/ebike.brf (SPEC §5.3–5.4). */
export function profileParams(s: Settings): Record<string, string> {
  const cf = costFactors(s);
  return {
    'profile:cf_shared': String(cf.shared),
    'profile:cf_lane': String(cf.lane),
    'profile:cf_protected': String(cf.protected),
    'profile:cf_trail': String(cf.trail),
    'profile:cf_greenway': String(cf.greenway),
    'profile:cf_quiet': String(cf.quiet),
    'profile:cf_arterial': String(cf.arterial),
    'profile:cf_other': String(cf.other),
    'profile:avoid_unpaved': s.avoidUnpaved ? '1' : '0',
    'profile:avoid_rough': s.avoidRough ? '1' : '0',
    'profile:avoid_dismount': s.avoidDismount ? '1' : '0',
  };
}

export function routeUrl(base: string, points: LonLat[], s: Settings, alternative: number): string {
  const q = new URLSearchParams({
    lonlats: points.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join('|'),
    profile: 'ebike',
    alternativeidx: String(alternative),
    format: 'geojson',
    timode: String(TIMODE),
    ...profileParams(s),
  });
  // BRouter expects literal `|` and `:`; URLSearchParams encodes them, which BRouter decodes.
  return `${base}?${q.toString()}`;
}
