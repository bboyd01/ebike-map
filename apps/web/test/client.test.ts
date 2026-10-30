import { describe, expect, it } from 'vitest';
import type { LonLat } from '../src/geo/geo';
import { routingKey } from '../src/routing/client';
import { DEFAULT_SETTINGS } from '../src/settings/settings';

const pts: LonLat[] = [
  [-87.7078, 41.9295],
  [-87.6301, 41.884],
];

describe('routingKey', () => {
  it('ignores ETA-only settings, so they re-estimate without refetching', () => {
    const base = routingKey(pts, DEFAULT_SETTINGS);
    for (const patch of [{ temperature: 0.9 }, { cruiseMph: 22 }, { massKg: 80 }, { units: 'metric' as const }, { trailCapMph: 12 }]) {
      expect(routingKey(pts, { ...DEFAULT_SETTINGS, ...patch })).toBe(base);
    }
  });

  it('changes with route-shaping settings', () => {
    const base = routingKey(pts, DEFAULT_SETTINGS);
    expect(routingKey(pts, { ...DEFAULT_SETTINGS, pickiness: 0.4 })).not.toBe(base);
    expect(routingKey(pts, { ...DEFAULT_SETTINGS, avoidRough: false })).not.toBe(base);
    expect(routingKey(pts, { ...DEFAULT_SETTINGS, ranking: ['trail', ...DEFAULT_SETTINGS.ranking.filter((c) => c !== 'trail')] })).not.toBe(base);
    expect(routingKey([pts[1]!, pts[0]!], DEFAULT_SETTINGS)).not.toBe(base);
  });
});
