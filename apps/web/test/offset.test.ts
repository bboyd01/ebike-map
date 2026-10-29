import { describe, expect, it } from 'vitest';
import { ControlType } from '../src/controls/controls';
import { computeOffset } from '../src/eta/offset';
import { DEFAULT_SETTINGS } from '../src/settings/settings';

const ctl = (type: number, index = 0) => ({ index, type });
const two_signals_three_stops = [
  ctl(ControlType.signal),
  ctl(ControlType.crossingSignal),
  ctl(ControlType.stop),
  ctl(ControlType.stop),
  ctl(ControlType.allWayStop),
];

describe('temperature offset', () => {
  it('count mode at T=0 uses worst-case seconds per control', () => {
    const r = computeOffset(
      { controls: two_signals_three_stops, leftTurnSignals: 0, uncoveredMovingS: 0, totalMovingS: 600 },
      { ...DEFAULT_SETTINGS, temperature: 0 },
    );
    expect(r.mode).toBe('count');
    expect(r.seconds).toBe(2 * 50 + 2 * 8 + 10);
    expect([r.signals, r.stops, r.allWayStops]).toEqual([2, 2, 1]);
  });

  it('T=1 adds nothing', () => {
    const r = computeOffset(
      { controls: two_signals_three_stops, leftTurnSignals: 1, uncoveredMovingS: 300, totalMovingS: 600 },
      { ...DEFAULT_SETTINGS, temperature: 1 },
    );
    expect(r.seconds).toBe(0);
  });

  it('flat mode at the default T=0.5 adds 25% of moving time', () => {
    const r = computeOffset({ controls: [], leftTurnSignals: 0, uncoveredMovingS: 600, totalMovingS: 600 }, DEFAULT_SETTINGS);
    expect(r.mode).toBe('flat');
    expect(r.seconds).toBeCloseTo(150, 6);
  });

  it('mixed routes combine both parts', () => {
    const r = computeOffset(
      { controls: [ctl(ControlType.signal)], leftTurnSignals: 1, uncoveredMovingS: 200, totalMovingS: 800 },
      { ...DEFAULT_SETTINGS, temperature: 0 },
    );
    expect(r.mode).toBe('mixed');
    expect(r.countS).toBe(1.5 * 50);
    expect(r.flatS).toBeCloseTo(0.5 * 200, 6);
  });

  it('clamps flatMax to 50%', () => {
    const r = computeOffset(
      { controls: [], leftTurnSignals: 0, uncoveredMovingS: 100, totalMovingS: 100 },
      { ...DEFAULT_SETTINGS, temperature: 0, flatMax: 0.9 },
    );
    expect(r.seconds).toBeCloseTo(50, 6);
  });
});
