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
  it('reproduces the side-street average at the default temperature (calibration)', () => {
    const eta = estimate(route(straight, { highway: 'residential' }), DEFAULT_SETTINGS, null);
    expect(eta.distanceM).toBeCloseTo(1000.8, 0);
    expect(eta.turnS).toBe(0);
    // moving faster than the average, then the side-street buffer brings it back to 14 mph
    expect(eta.movingAvgMps).toBeGreaterThan(mphToMps(14));
    expect(eta.offset.estimatedFraction).toBe(1);
    expect(eta.avgMps).toBeCloseTo(mphToMps(DEFAULT_SETTINGS.sideStreetMph), 6);
  });

  it('a cautious temperature lands below the average, assertive above', () => {
    const r = route(straight, { highway: 'residential' });
    const avg = mphToMps(DEFAULT_SETTINGS.sideStreetMph);
    expect(estimate(r, { ...DEFAULT_SETTINGS, temperature: 0 }, null).avgMps).toBeLessThan(avg);
    expect(estimate(r, { ...DEFAULT_SETTINGS, temperature: 1 }, null).avgMps).toBeGreaterThan(avg);
  });

  it('uses the park-path speed on trails and adds turn loss at a corner', () => {
    const corner: LonLat[] = [
      [-87.65, 41.85],
      [-87.65, 41.8545],
      [-87.644, 41.8545],
    ];
    const eta = estimate(route(corner, { highway: 'cycleway' }), DEFAULT_SETTINGS, null);
    expect(eta.edges[0]!.speedMps).toBeCloseTo(mphToMps(DEFAULT_SETTINGS.trailMph), 6);
    expect(eta.turnS).toBeGreaterThan(0);
    expect(eta.byClassM.trail).toBeCloseTo(eta.distanceM, 6);
  });

  it('uses the rider\'s own speed with no stop buffer on express trails', () => {
    // `straight` is inland (Pilsen), so this is "other regional trail", not the Lakefront.
    const eta = estimate(route(straight, { highway: 'cycleway', route_bicycle_ncn: 'yes' }), { ...DEFAULT_SETTINGS, expressMph: 24 }, null);
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

  it('turns cost more time with a slower cornering speed', () => {
    const corner: LonLat[] = [
      [-87.65, 41.85],
      [-87.65, 41.8545],
      [-87.644, 41.8545],
    ];
    const r = route(corner, { highway: 'residential' });
    const slow = estimate(r, { ...DEFAULT_SETTINGS, cornerMph: 8 }, null);
    const fast = estimate(r, { ...DEFAULT_SETTINGS, cornerMph: 16 }, null);
    expect(slow.turnS).toBeGreaterThan(fast.turnS);
    expect(slow.avgMps).toBeLessThan(fast.avgMps);
  });
});

