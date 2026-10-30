import { ControlType, type RouteControl } from '../controls/controls';
import type { Settings } from '../settings/settings';

export interface OffsetInput {
  controls: RouteControl[]; // mapped stoplights on the route, in covered cells
  leftTurnSignals: number; // lights where the route turns left (count 1.5x, SPEC §7.4)
  estimatedMovingS: number; // side-street time + time where lights aren't mapped
  totalMovingS: number; // all riding time except express trails
}

export interface OffsetResult {
  seconds: number;
  lightS: number; // from counted stoplights
  estimateS: number; // flat % on side streets and unmapped areas
  lights: number;
  estimatedFraction: number; // share of riding time that got the flat %
}

type OffsetSettings = Pick<Settings, 'temperature' | 'tSignalS' | 'flatMax'>;

/**
 * Temperature offset (SPEC §6). Mapped stoplights are counted. Stop signs aren't: OSM's
 * coverage of them is incomplete, so side-street time (where they are) gets the flat %,
 * as does time anywhere lights aren't mapped. Nothing is placed by guessing.
 */
export function computeOffset(inp: OffsetInput, s: OffsetSettings): OffsetResult {
  const level = 1 - Math.min(Math.max(s.temperature, 0), 1);
  const lights = inp.controls.filter((c) => c.type === ControlType.signal || c.type === ControlType.crossingSignal).length;
  const lightS = level * (lights + 0.5 * inp.leftTurnSignals) * s.tSignalS;
  const estimateS = level * Math.min(Math.max(s.flatMax, 0), 0.5) * inp.estimatedMovingS;
  const estimatedFraction = inp.totalMovingS > 0 ? inp.estimatedMovingS / inp.totalMovingS : 0;
  return { seconds: lightS + estimateS, lightS, estimateS, lights, estimatedFraction };
}
