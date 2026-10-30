import { describe, expect, it } from 'vitest';
import { classify } from '../src/routing/classify';
import { profileParams } from '../src/routing/params';
import { costFactors, DEFAULT_SETTINGS, normalizeRanking } from '../src/settings/settings';

describe('ranking → cost factors (SPEC §5.3)', () => {
  it('matches the spec example for s = 0.20', () => {
    const cf = costFactors({ ...DEFAULT_SETTINGS, pickiness: 0.2 });
    expect([cf.shared, cf.lane, cf.protected, cf.trail, cf.greenway, cf.quiet, cf.arterial]).toEqual([
      1, 1.2, 1.44, 1.728, 2.074, 2.488, 2.986,
    ]);
    expect(cf.other).toBeGreaterThan(cf.arterial);
    expect(cf.express).toBeLessThan(cf.shared); // express trails beat every ranked class
  });

  it('keeps arterial at 5th or lower and fills missing classes', () => {
    expect(normalizeRanking(['arterial', 'trail'])).toEqual(['trail', 'shared', 'lane', 'protected', 'arterial', 'greenway', 'quiet']);
  });

  it('emits speed-based profile overrides (fastest = 1, busy roads penalized)', () => {
    const p = profileParams(DEFAULT_SETTINGS, new Date('2026-12-15T15:00:00Z')); // winter: 606 off-peak
    expect(p['profile:cf_express']).toBe('1'); // Lakefront 23 mph is the fastest class
    expect(p['profile:cf_railtrail']).toBe('1'); // 606 off-peak 23 mph
    expect(Number(p['profile:cf_protected'])).toBeCloseTo((23 / 17) * 1.03 ** 2, 2); // 17 mph, ranked 3rd
    expect(Number(p['profile:cf_arterial'])).toBeGreaterThanOrEqual(2); // 23 mph x2 safety penalty
    const peak = profileParams(DEFAULT_SETTINGS, new Date('2026-06-16T22:30:00Z')); // Tue 5:30 pm CDT
    expect(Number(peak['profile:cf_railtrail'])).toBeCloseTo(23 / 16, 2);
  });
});

describe('classify (mirrors ebike.brf)', () => {
  const cases: [Record<string, string>, string][] = [
    [{ highway: 'cycleway' }, 'trail'],
    [{ highway: 'cycleway', route_bicycle_rcn: 'yes', railway: 'abandoned' }, 'express'], // the 606
    [{ highway: 'cycleway', route_bicycle_ncn: 'yes' }, 'express'], // Lakefront Trail
    [{ highway: 'cycleway', route_bicycle_rcn: 'yes', oneway: 'yes' }, 'protected'], // one-way sidepath
    [{ highway: 'footway', bicycle: 'designated' }, 'trail'],
    [{ highway: 'footway' }, 'other'],
    [{ highway: 'secondary', 'cycleway:right': 'track' }, 'protected'],
    [{ highway: 'tertiary', cycleway: 'lane' }, 'lane'],
    [{ highway: 'tertiary', cycleway: 'shared_lane' }, 'shared'],
    [{ highway: 'residential', route_bicycle_lcn: 'yes' }, 'greenway'],
    [{ highway: 'residential' }, 'quiet'],
    [{ highway: 'service', service: 'parking_aisle' }, 'other'],
    [{ highway: 'service', service: 'alley' }, 'other'],
    [{ highway: 'cycleway', oneway: 'yes' }, 'protected'],
    [{ highway: 'primary' }, 'arterial'],
  ];
  it.each(cases)('%o → %s', (tags, cls) => expect(classify(tags)).toBe(cls));
});
