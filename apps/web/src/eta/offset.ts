import { ControlType, type RouteControl } from '../controls/controls';
import type { Settings } from '../settings/settings';

export interface OffsetInput {
  controls: RouteControl[]; // controls in covered cells only
  leftTurnSignals: number; // signals where the route turns left (count 1.5x, SPEC §7.4)
  uncoveredMovingS: number; // moving time spent outside covered cells
  totalMovingS: number;
}

export interface OffsetResult {
  mode: 'count' | 'flat' | 'mixed';
  seconds: number;
  countS: number;
  flatS: number;
  signals: number;
  stops: number;
  allWayStops: number;
  flatFraction: number; // share of moving time estimated with the flat %
}

type OffsetSettings = Pick<Settings, 'temperature' | 'tSignalS' | 'tStopS' | 'tAllWayS' | 'flatMax'>;

/** Temperature offset (SPEC §6): count mode where controls are mapped, flat % elsewhere. */
export function computeOffset(inp: OffsetInput, s: OffsetSettings): OffsetResult {
  const level = 1 - Math.min(Math.max(s.temperature, 0), 1);
  let signals = 0, stops = 0, allWayStops = 0;
  for (const c of inp.controls) {
    if (c.type === ControlType.signal || c.type === ControlType.crossingSignal) signals++;
    else if (c.type === ControlType.allWayStop) allWayStops++;
    else if (c.type === ControlType.stop) stops++;
  }
  const countS = level * ((signals + 0.5 * inp.leftTurnSignals) * s.tSignalS + stops * s.tStopS + allWayStops * s.tAllWayS);
  const flatS = level * Math.min(Math.max(s.flatMax, 0), 0.5) * inp.uncoveredMovingS;
  const flatFraction = inp.totalMovingS > 0 ? inp.uncoveredMovingS / inp.totalMovingS : 1;
  const mode = flatFraction >= 0.999 ? 'flat' : flatFraction <= 0.001 ? 'count' : 'mixed';
  return { mode, seconds: countS + flatS, countS, flatS, signals, stops, allWayStops, flatFraction };
}
