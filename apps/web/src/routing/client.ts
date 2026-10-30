import type { Controls } from '../controls/controls';
import { estimate, type Eta } from '../eta/eta';
import type { LonLat } from '../geo/geo';
import type { Settings } from '../settings/settings';
import { routeUrl, type RouteVariant } from './params';
import { parseBRouter, type ParsedRoute } from './parse';
import { rankAlternatives } from './rank';

export interface RawRoute {
  id: string; // stable key: `${variant}-${alternativeidx}`
  route: ParsedRoute;
  simplest: boolean; // this geometry is (also) the simplest route
}

export interface RouteOption extends RawRoute {
  eta: Eta;
  overDetour: boolean;
}

/** Request order: best preferred route first, then the simplest, then preferred alternatives. */
const REQUESTS: { variant: RouteVariant; idx: number }[] = [
  { variant: 'preferred', idx: 0 },
  { variant: 'simplest', idx: 0 },
  { variant: 'preferred', idx: 1 },
  { variant: 'preferred', idx: 2 },
];

/** Settings that change which path BRouter picks; everything else only changes the ETA. */
export function routingKey(points: LonLat[], s: Settings): string {
  return JSON.stringify([points, s.ranking, s.pickiness, s.avoidUnpaved, s.avoidRough, s.avoidDismount]);
}

/**
 * Fetches routes in order and reports the list after each one. BRouter computes
 * alternatives cumulatively (alt 2 recomputes 0 and 1), so sequential requests cost no
 * more than parallel ones and show the first route sooner.
 */
export async function fetchRoutes(
  points: LonLat[],
  s: Settings,
  onUpdate: (routes: RawRoute[], done: boolean) => void,
  signal: AbortSignal,
): Promise<void> {
  const found: RawRoute[] = [];
  for (const [n, { variant, idx }] of REQUESTS.entries()) {
    let res: Response;
    try {
      res = await fetch(routeUrl('/route', points, s, idx, variant), { signal });
    } catch {
      if (signal.aborted) return;
      if (n === 0) throw new Error('Can’t reach the routing server.');
      continue;
    }
    if (!res.ok) {
      if (n === 0) throw new Error(friendlyError(await res.text()));
      if (variant === 'preferred') break; // no more alternatives
      continue;
    }
    const route = parseBRouter(await res.json());
    if (signal.aborted) return;
    // Same path as one already found (common on short trips): just note it.
    const dup = found.find((f) => sameRoute(f.route, route));
    if (dup) {
      if (variant === 'simplest') dup.simplest = true;
      continue;
    }
    found.push({ id: `${variant}-${idx}`, route, simplest: variant === 'simplest' });
    onUpdate([...found], false);
  }
  if (!signal.aborted) onUpdate([...found], true);
}

/** ETA and ranking for fetched routes under the current settings (cheap; no network). */
export function evaluate(routes: RawRoute[], s: Settings, controls: Controls | null): RouteOption[] {
  const ranked = rankAlternatives(
    routes.map((r) => ({ ...r, eta: estimate(r.route, s, controls) })),
    s,
  );
  // The simplest route ignores the rider's preferences, so it's always listed last
  // (unless it's also one of the preferred routes).
  return [...ranked.filter((r) => !r.id.startsWith('simplest')), ...ranked.filter((r) => r.id.startsWith('simplest'))];
}

function sameRoute(a: ParsedRoute, b: ParsedRoute): boolean {
  if (Math.abs(a.coords.length - b.coords.length) > 2) return false;
  // Compare a few sample points; identical paths can differ by a vertex at the ends.
  const at = (r: ParsedRoute, f: number) => r.coords[Math.floor((r.coords.length - 1) * f)]!;
  return [0.25, 0.5, 0.75].every((f) => {
    const p = at(a, f), q = at(b, f);
    return Math.abs(p[0] - q[0]) < 2e-4 && Math.abs(p[1] - q[1]) < 2e-4;
  });
}

function friendlyError(text: string): string {
  if (/not mapped/i.test(text)) return 'That point isn’t near a rideable street. Try moving it.';
  if (/target island|no route|not found/i.test(text)) return 'No bikeable route found between these points.';
  return text.trim().slice(0, 200) || 'Routing failed.';
}
