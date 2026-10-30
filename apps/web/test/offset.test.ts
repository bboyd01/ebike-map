import { describe, expect, it } from 'vitest';
import { ControlType } from '../src/controls/controls';
import { computeOffset } from '../src/eta/offset';
import { DEFAULT_SETTINGS } from '../src/settings/settings';

const ctl = (type: number, index = 0) => ({ index, type });
const twoLights = [ctl(ControlType.signal), ctl(ControlType.crossingSignal)];

describe('temperature offset', () => {
  it('counts mapped stoplights at their worst-case wait at T=0', () => {
    const r = computeOffset({ controls: twoLights, leftTurnSignals: 0, estimatedMovingS: 0, totalMovingS: 600 }, { ...DEFAULT_SETTINGS, temperature: 0 });
    expect(r.lights).toBe(2);
    expect(r.seconds).toBe(2 * 50);
    expect(r.estimateS).toBe(0);
  });

  it('ignores stop signs entirely (incomplete in OSM)', () => {
    const r = computeOffset({ controls: [ctl(ControlType.stop), ctl(ControlType.allWayStop)], leftTurnSignals: 0, estimatedMovingS: 0, totalMovingS: 600 }, { ...DEFAULT_SETTINGS, temperature: 0 });
    expect(r.seconds).toBe(0);
  });

  it('T=1 adds nothing', () => {
    const r = computeOffset({ controls: twoLights, leftTurnSignals: 1, estimatedMovingS: 300, totalMovingS: 600 }, { ...DEFAULT_SETTINGS, temperature: 1 });
    expect(r.seconds).toBe(0);
  });

  it('side-street / unmapped time gets the flat %: 25% at the default T=0.5', () => {
    const r = computeOffset({ controls: [], leftTurnSignals: 0, estimatedMovingS: 600, totalMovingS: 600 }, DEFAULT_SETTINGS);
    expect(r.seconds).toBeCloseTo(150, 6);
    expect(r.estimatedFraction).toBe(1);
  });

  it('combines counted lights with the estimated part', () => {
    const r = computeOffset({ controls: [ctl(ControlType.signal)], leftTurnSignals: 1, estimatedMovingS: 200, totalMovingS: 800 }, { ...DEFAULT_SETTINGS, temperature: 0 });
    expect(r.lightS).toBe(1.5 * 50);
    expect(r.estimateS).toBeCloseTo(0.5 * 200, 6);
    expect(r.estimatedFraction).toBe(0.25);
  });

  it('clamps flatMax to 50%', () => {
    const r = computeOffset({ controls: [], leftTurnSignals: 0, estimatedMovingS: 100, totalMovingS: 100 }, { ...DEFAULT_SETTINGS, temperature: 0, flatMax: 0.9 });
    expect(r.seconds).toBeCloseTo(50, 6);
  });
});
