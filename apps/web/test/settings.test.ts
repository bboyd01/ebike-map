import { describe, expect, it } from 'vitest';
import { classify } from '../src/routing/classify';
import { profileParams } from '../src/routing/params';
import { costFactors, DEFAULT_SETTINGS, normalizeRanking } from '../src/settings/settings';

describe('ranking → cost factors (SPEC §5.3)', () => {
  it('matches the spec example for s = 0.20', () => {
    const cf = costFactors(DEFAULT_SETTINGS);
    expect([cf.shared, cf.lane, cf.protected, cf.trail, cf.greenway, cf.quiet, cf.arterial]).toEqual([
      1, 1.2, 1.44, 1.728, 2.074, 2.488, 2.986,
    ]);
    expect(cf.other).toBeGreaterThan(cf.arterial);
  });

  it('keeps arterial at 5th or lower and fills missing classes', () => {
    expect(normalizeRanking(['arterial', 'trail'])).toEqual(['trail', 'shared', 'lane', 'protected', 'arterial', 'greenway', 'quiet']);
  });

  it('emits profile overrides', () => {
    expect(profileParams(DEFAULT_SETTINGS)['profile:cf_trail']).toBe('1.728');
  });
});

describe('classify (mirrors ebike.brf)', () => {
  const cases: [Record<string, string>, string][] = [
    [{ highway: 'cycleway' }, 'trail'],
    [{ highway: 'footway', bicycle: 'designated' }, 'trail'],
    [{ highway: 'footway' }, 'other'],
    [{ highway: 'secondary', 'cycleway:right': 'track' }, 'protected'],
    [{ highway: 'tertiary', cycleway: 'lane' }, 'lane'],
    [{ highway: 'tertiary', cycleway: 'shared_lane' }, 'shared'],
    [{ highway: 'residential', route_bicycle_lcn: 'yes' }, 'greenway'],
    [{ highway: 'residential' }, 'quiet'],
    [{ highway: 'service', service: 'parking_aisle' }, 'other'],
    [{ highway: 'primary' }, 'arterial'],
  ];
  it.each(cases)('%o → %s', (tags, cls) => expect(classify(tags)).toBe(cls));
});
