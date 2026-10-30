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

/**
 * "Simplest" route: ignores bike infrastructure and street-type ranking, and makes turns
 * expensive and lights cheap, so it follows the fewest, longest streets (tuned in SPEC §17).
 * Surface/dismount toggles still apply.
 */
export function simplestParams(s: Settings): Record<string, string> {
  const flat: Record<string, number> = {
    cf_scale: 1, cf_shared: 1, cf_lane: 1, cf_protected: 1, cf_trail: 1, cf_greenway: 1, cf_quiet: 1,
    cf_arterial: 1, cf_other: 1.5, busy_factor: 1, arterial_infra_bonus: 1, cf_express: 1, express_entry: 0,
    node_cost_signal: 40, node_cost_crossing_signal: 10, node_cost_stop: 20, turn_cost: 500,
  };
  const out = profileParams(s);
  for (const [k, v] of Object.entries(flat)) out[`profile:${k}`] = String(v);
  return out;
}

export type RouteVariant = 'preferred' | 'simplest';

export function routeUrl(base: string, points: LonLat[], s: Settings, alternative: number, variant: RouteVariant = 'preferred'): string {
  const q = new URLSearchParams({
    lonlats: points.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join('|'),
    profile: 'ebike',
    alternativeidx: String(alternative),
    format: 'geojson',
    timode: String(TIMODE),
    ...(variant === 'simplest' ? simplestParams(s) : profileParams(s)),
  });
  // BRouter expects literal `|` and `:`; URLSearchParams encodes them, which BRouter decodes.
  return `${base}?${q.toString()}`;
}
