import { mphToMps } from './units';

export type InfraClass = 'express' | 'shared' | 'lane' | 'protected' | 'trail' | 'greenway' | 'quiet' | 'arterial' | 'other';

/**
 * The seven rankable classes; `other` is always last (SPEC §5.2). `express` (the 606,
 * Lakefront Trail and other long regional trails) isn't ranked: it's always preferred
 * once the route can stay on it for a few blocks (SPEC §5.7).
 */
export const RANKABLE: InfraClass[] = ['shared', 'lane', 'protected', 'trail', 'greenway', 'quiet', 'arterial'];

export type BikeClass = 'class1' | 'class2' | 'class3' | 'custom';
export type Position = 'upright' | 'commuter' | 'sporty';
export type AreaId = 'city' | 'metro';

export interface Settings {
  area: AreaId | null; // null until chosen on first launch
  bikeClass: BikeClass;
  customCutoffMph: number;
  cruiseMph: number;
  motorW: number;
  riderW: number;
  massKg: number;
  position: Position;
  throttle: boolean;
  descentCapMph: number;
  trailCapMph: number;
  expressTrailMph: number; // average speed on express trails (no stops)

  ranking: InfraClass[]; // permutation of RANKABLE
  pickiness: number; // s in cf(r) = (1+s)^(r-1)
  maxDetour: number; // 0.25 = +25%
  avoidUnpaved: boolean;
  avoidRough: boolean;
  avoidDismount: boolean;

  temperature: number; // T in [0,1]; offset level = 1 - T (SPEC §6)
  tSignalS: number;
  tStopS: number;
  tAllWayS: number;
  flatMax: number; // 0..0.5

  units: 'imperial' | 'metric';
  voice: boolean;
  recordRides: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  area: null,
  bikeClass: 'class2',
  customCutoffMph: 20,
  cruiseMph: 18,
  motorW: 500,
  riderW: 120,
  massKg: 100,
  position: 'commuter',
  throttle: true,
  descentCapMph: 25,
  trailCapMph: 15,
  expressTrailMph: 20,

  ranking: ['shared', 'lane', 'protected', 'trail', 'greenway', 'quiet', 'arterial'],
  pickiness: 0.2,
  maxDetour: 0.25,
  avoidUnpaved: true,
  avoidRough: true,
  avoidDismount: true,

  temperature: 0.5,
  tSignalS: 50,
  tStopS: 8,
  tAllWayS: 10,
  flatMax: 0.5,

  units: 'imperial',
  voice: true,
  recordRides: false,
};

export const POSITIONS: Record<Position, { cda: number; crr: number }> = {
  upright: { cda: 0.6, crr: 0.007 },
  commuter: { cda: 0.55, crr: 0.006 },
  sporty: { cda: 0.45, crr: 0.005 },
};

export function assistCutoffMps(s: Pick<Settings, 'bikeClass' | 'customCutoffMph'>): number {
  switch (s.bikeClass) {
    case 'class1':
    case 'class2':
      return mphToMps(20);
    case 'class3':
      return mphToMps(28);
    case 'custom':
      return mphToMps(s.customCutoffMph);
  }
}

/** ebike.brf multiplies ranked classes by cf_scale; express trails cost cf_express = 1. */
export const CF_SCALE = 2;
export const CF_EXPRESS = 1;

/** Cost factor per class from the ranking, relative to the top-ranked class (SPEC §5.3). */
export function costFactors(s: Pick<Settings, 'ranking' | 'pickiness'>): Record<InfraClass, number> {
  const cf = {} as Record<InfraClass, number>;
  s.ranking.forEach((c, i) => (cf[c] = round3((1 + s.pickiness) ** i)));
  cf.other = round3((1 + s.pickiness) ** s.ranking.length);
  cf.express = CF_EXPRESS / CF_SCALE;
  return cf;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Enforces SPEC §5.2: a full permutation, with `arterial` no higher than 5th. */
export function normalizeRanking(r: InfraClass[]): InfraClass[] {
  const seen = new Set<InfraClass>();
  const out = r.filter((c) => RANKABLE.includes(c) && !seen.has(c) && seen.add(c));
  for (const c of RANKABLE) if (!seen.has(c)) out.push(c);
  const ai = out.indexOf('arterial');
  if (ai < 4) {
    out.splice(ai, 1);
    out.splice(4, 0, 'arterial');
  }
  return out;
}
