import { describe, expect, it } from 'vitest';
import { CAL_LIGHTS_PER_MILE, is606Peak, movingMps, speedKind } from '../src/eta/speeds';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { mphToMps } from '../src/settings/units';

describe('606 peak hours (Chicago time)', () => {
  it.each([
    ['2026-06-16T13:00:00Z', true], // Tue 8:00 am CDT
    ['2026-06-16T17:00:00Z', true], // Tue 12:00 pm CDT
    ['2026-06-16T22:30:00Z', true], // Tue 5:30 pm CDT
    ['2026-06-17T03:00:00Z', false], // Tue 10 pm CDT
    ['2026-06-20T17:00:00Z', false], // Saturday noon
    ['2026-01-13T14:00:00Z', false], // January weekday 8 am CST (winter)
  ])('%s -> %s', (iso, peak) => expect(is606Peak(new Date(iso))).toBe(peak));
});

describe('calibration', () => {
  it('through-street moving speed leaves room for the assumed lights per mile', () => {
    const v = movingMps('arterial', DEFAULT_SETTINGS, false);
    const avg = mphToMps(DEFAULT_SETTINGS.arterialMph);
    const stopsPerM = (CAL_LIGHTS_PER_MILE * 0.5 * DEFAULT_SETTINGS.tSignalS) / 1609.344;
    expect(1 / v + stopsPerM).toBeCloseTo(1 / avg, 9);
    expect(v).toBeGreaterThan(avg);
  });

  it('trails have no stop allowance: moving speed = average', () => {
    expect(movingMps('lakefront', DEFAULT_SETTINGS, false)).toBeCloseTo(mphToMps(23), 9);
    expect(movingMps('trail606', DEFAULT_SETTINGS, true)).toBeCloseTo(mphToMps(16), 9);
  });
});

describe('speedKind', () => {
  const tr = { highway: 'cycleway', route_bicycle_rcn: 'yes' };
  it('tells the Lakefront Trail, the 606 and other express trails apart', () => {
    expect(speedKind('express', tr, [-87.63, 41.93])).toBe('lakefront'); // Lincoln Park lakefront
    expect(speedKind('express', { ...tr, railway: 'abandoned' }, [-87.69, 41.914])).toBe('trail606');
    expect(speedKind('express', tr, [-87.74, 41.98])).toBe('express'); // inland (North Branch area)
  });
  it('bike lanes on through streets vs side streets', () => {
    expect(speedKind('lane', { highway: 'secondary', cycleway: 'lane' }, [-87.68, 41.9])).toBe('lane');
    expect(speedKind('lane', { highway: 'residential', cycleway: 'lane' }, [-87.68, 41.9])).toBe('side');
  });
});

import { estimate } from '../src/eta/eta';
import type { ParsedRoute } from '../src/routing/parse';
describe('end-to-end calibration', () => {
  it('a through street with a bike lane and no mapped lights reproduces the lane average', () => {
    const coords: [number, number][] = [
      [-87.6776, 41.90],
      [-87.6776, 41.9145],
      [-87.6776, 41.929],
    ];
    const r: ParsedRoute = { coords, elev: coords.map(() => 180), edges: coords.slice(1).map((_, i) => ({ from: i, to: i + 1, wayTags: { highway: 'secondary', cycleway: 'lane' } })), nodeTags: new Map(), voicehints: [] };
    const eta = estimate(r, DEFAULT_SETTINGS, null);
    expect(eta.avgMps).toBeCloseTo(mphToMps(DEFAULT_SETTINGS.laneMph), 6);
    expect(eta.offset.estimatedLights).toBeCloseTo((eta.distanceM / 1609.344) * CAL_LIGHTS_PER_MILE, 6);
  });
});

