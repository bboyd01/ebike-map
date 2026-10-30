import { describe, expect, it } from 'vitest';
import { estimate } from '../src/eta/eta';
import type { LonLat } from '../src/geo/geo';
import type { ParsedRoute } from '../src/routing/parse';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { mphToMps } from '../src/settings/units';

function route(coords: LonLat[], tags: Record<string, string>): ParsedRoute {
  return {
    coords,
    elev: coords.map(() => 180),
    edges: coords.slice(1).map((_, i) => ({ from: i, to: i + 1, wayTags: tags })),
    nodeTags: new Map(),
    voicehints: [],
  };
}

// ~1 km due north on a flat residential street.
const straight: LonLat[] = [
  [-87.65, 41.85],
  [-87.65, 41.8545],
  [-87.65, 41.859],
];

describe('estimate', () => {
  it('moving time is distance / cruise speed on a flat quiet street', () => {
    const eta = estimate(route(straight, { highway: 'residential' }), DEFAULT_SETTINGS, null);
    expect(eta.distanceM).toBeCloseTo(1000.8, 0);
    expect(eta.movingS).toBeCloseTo(eta.distanceM / mphToMps(18), 1);
    expect(eta.turnS).toBe(0);
  });

  it('without a controls file, uses the flat offset and reports average speed', () => {
    const eta = estimate(route(straight, { highway: 'residential' }), DEFAULT_SETTINGS, null);
    expect(eta.offset.mode).toBe('flat');
    expect(eta.offset.seconds).toBeCloseTo(0.25 * eta.movingS, 6);
    expect(eta.totalS).toBeCloseTo(eta.movingS * 1.25, 6);
    expect(eta.avgMps).toBeCloseTo(eta.distanceM / eta.totalS, 9);
    expect(eta.movingAvgMps).toBeCloseTo(mphToMps(18), 2);
    expect(eta.avgMps).toBeLessThan(eta.movingAvgMps);
  });

  it('caps speed on trails and adds turn loss at a corner', () => {
    const corner: LonLat[] = [
      [-87.65, 41.85],
      [-87.65, 41.8545],
      [-87.644, 41.8545],
    ];
    const eta = estimate(route(corner, { highway: 'cycleway' }), DEFAULT_SETTINGS, null);
    expect(eta.edges[0]!.speedMps).toBeCloseTo(mphToMps(15), 6);
    expect(eta.turnS).toBeGreaterThan(0);
    expect(eta.byClassM.trail).toBeCloseTo(eta.distanceM, 6);
  });

  it('uses the express-trail speed with no stop buffer on express trails', () => {
    const eta = estimate(route(straight, { highway: 'cycleway', route_bicycle_ncn: 'yes' }), { ...DEFAULT_SETTINGS, expressTrailMph: 24 }, null);
    expect(eta.byClassM.express).toBeCloseTo(eta.distanceM, 6);
    expect(eta.edges[0]!.speedMps).toBeCloseTo(mphToMps(24), 6);
    expect(eta.offset.seconds).toBe(0);
  });

  it('counts real turns from voicehints, not slight bends', () => {
    const r = route(straight, { highway: 'residential' });
    r.voicehints = [
      [1, 2, 0, 100, -90], // turn left
      [2, 3, 0, 100, -20], // slight left: not a turn
      [3, 5, 0, 100, 90], // turn right
      [4, 8, 0, 100, -10], // keep left: not a turn
    ];
    expect(estimate(r, DEFAULT_SETTINGS, null).turns).toBe(2);
  });
});

