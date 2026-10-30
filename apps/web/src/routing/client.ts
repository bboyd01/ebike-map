import type { Controls } from '../controls/controls';
import { estimate, type Eta } from '../eta/eta';
import type { LonLat } from '../geo/geo';
import type { Settings } from '../settings/settings';
import { routeUrl } from './params';
import { parseBRouter, type ParsedRoute } from './parse';
import { rankAlternatives } from './rank';

export interface RawRoute {
  idx: number; // BRouter alternativeidx
  route: ParsedRoute;
}

export interface RouteOption extends RawRoute {
  eta: Eta;
  overDetour: boolean;
}

const ALTERNATIVES = [0, 1, 2];

/** Settings that change which path BRouter picks; everything else only changes the ETA. */
export function routingKey(points: LonLat[], s: Settings): string {
  return JSON.stringify([points, s.ranking, s.pickiness, s.avoidUnpaved, s.avoidRough, s.avoidDismount]);
}

/**
 * Fetches alternatives in order and reports the list after each one.
 * BRouter computes alternatives cumulatively (alt 2 recomputes 0 and 1), so
 * sequential requests cost no more than parallel ones and show alt 0 sooner.
 */
export async function fetchRoutes(
  points: LonLat[],
  s: Settings,
  onUpdate: (routes: RawRoute[], done: boolean) => void,
  signal: AbortSignal,
): Promise<void> {
  const found: RawRoute[] = [];
  for (const idx of ALTERNATIVES) {
    let res: Response;
    try {
      res = await fetch(routeUrl('/route', points, s, idx), { signal });
    } catch (e) {
      if (signal.aborted) return;
      if (idx === 0) throw new Error('Can’t reach the routing server.');
      break;
    }
    if (!res.ok) {
      if (idx === 0) throw new Error(friendlyError(await res.text()));
      break;
    }
    const route = parseBRouter(await res.json());
    if (signal.aborted) return;
    // BRouter can return the same path for several indices on short trips.
    if (!found.some((f) => sameRoute(f.route, route))) {
      found.push({ idx, route });
      onUpdate([...found], false);
    }
  }
  if (!signal.aborted) onUpdate([...found], true);
}

/** ETA and ranking for fetched routes under the current settings (cheap; no network). */
export function evaluate(routes: RawRoute[], s: Settings, controls: Controls | null): RouteOption[] {
  return rankAlternatives(
    routes.map((r) => ({ ...r, eta: estimate(r.route, s, controls) })),
    s,
  );
}

function sameRoute(a: ParsedRoute, b: ParsedRoute): boolean {
  if (a.coords.length !== b.coords.length) return false;
  const mid = Math.floor(a.coords.length / 2);
  return a.coords[mid]![0] === b.coords[mid]![0] && a.coords[mid]![1] === b.coords[mid]![1];
}

function friendlyError(text: string): string {
  if (/not mapped/i.test(text)) return 'That point isn’t near a rideable street. Try moving it.';
  if (/target island|no route|not found/i.test(text)) return 'No bikeable route found between these points.';
  return text.trim().slice(0, 200) || 'Routing failed.';
}
