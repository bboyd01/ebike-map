import { describe, expect, it } from 'vitest';
import { riderModel } from '../src/eta/eta';
import { powerRequired, slowdownLoss, steadySpeed, turnSpeed } from '../src/eta/physics';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import { mphToMps } from '../src/settings/units';

const m = riderModel(DEFAULT_SETTINGS);

describe('power balance', () => {
  it('needs ~220 W to cruise at 18 mph with default rider (SPEC §7.2)', () => {
    expect(powerRequired(mphToMps(18), 0, m)).toBeGreaterThan(210);
    expect(powerRequired(mphToMps(18), 0, m)).toBeLessThan(230);
  });

  it('holds cruise speed on the flat', () => {
    expect(steadySpeed(0, m)).toBeCloseTo(mphToMps(18), 2);
  });

  it('slows on climbs but stays well above walking pace with assist', () => {
    const v = steadySpeed(0.05, m);
    expect(v).toBeLessThan(mphToMps(18));
    expect(v).toBeGreaterThan(mphToMps(8));
  });

  it('never exceeds cruise on the flat, even for a class 3 bike', () => {
    const c3 = riderModel({ ...DEFAULT_SETTINGS, bikeClass: 'class3' });
    expect(steadySpeed(0, c3)).toBeLessThanOrEqual(mphToMps(18) * 1.05);
  });

  it('caps descents', () => {
    expect(steadySpeed(-0.08, m)).toBeCloseTo(mphToMps(25), 5);
  });

  it('never uses assist to go past the cutoff on a climb', () => {
    const strong = riderModel({ ...DEFAULT_SETTINGS, cruiseMph: 20, motorW: 750 });
    expect(steadySpeed(0.02, strong)).toBeLessThanOrEqual(mphToMps(20) + 1e-9);
  });

  it('a rider who cruises above the cutoff keeps that pace unassisted', () => {
    const fast = riderModel({ ...DEFAULT_SETTINGS, cruiseMph: 22 });
    expect(steadySpeed(0, fast)).toBeCloseTo(mphToMps(22), 2);
  });
});

describe('kinematics', () => {
  it('full stop from 8 m/s at a_a = 1.2 loses 6.0 s (SPEC §6.2 example)', () => {
    expect(slowdownLoss(8, 0, 1.2)).toBeCloseTo(6.0, 5);
  });
  it('sharper turns are slower', () => {
    const corner = mphToMps(13);
    expect(turnSpeed(90, corner)).toBeCloseTo(corner, 9); // the setting is the 90° speed
    expect(turnSpeed(135, corner)).toBeLessThan(turnSpeed(90, corner));
    expect(turnSpeed(90, corner)).toBeLessThan(turnSpeed(45, corner));
    expect(turnSpeed(180, corner)).toBeCloseTo(0.4 * corner, 9);
  });
});
