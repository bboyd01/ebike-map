// Rider-measured average speeds by street type (stops included), and everything derived
// from them: calibrated moving speeds for the ETA model and per-class routing costs
// (SPEC §19).
import type { LonLat } from '../geo/geo';
import type { Tags } from '../routing/classify';
import { RANKABLE, type InfraClass, type Settings } from '../settings/settings';
import { mphToMps } from '../settings/units';

/** What a segment is, for speed purposes. */
export type SpeedKind = 'lakefront' | 'trail606' | 'express' | 'trail' | 'protected' | 'lane' | 'arterial' | 'side' | 'other';

/** How stops are modeled on top of the moving speed (must match eta.ts). */
type StopModel = 'none' | 'lights' | 'side';

const STOPS: Record<SpeedKind, StopModel> = {
  lakefront: 'none',
  trail606: 'none',
  express: 'none',
  trail: 'none',
  protected: 'lights',
  lane: 'lights',
  arterial: 'lights',
  side: 'side',
  other: 'none',
};

export const stopModel = (kind: SpeedKind): StopModel => STOPS[kind];

/** Calibration assumptions: your averages are reproduced at this temperature on a street with this many mapped lights. */
export const CAL_TEMPERATURE = 0.5;
export const CAL_LIGHTS_PER_MILE = 4;

const isArterialHw = (hw: string | undefined) =>
  hw !== undefined && ['tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link'].includes(hw);

/** Approximate Lake Michigan shoreline longitude by latitude (Chicago). */
const SHORE: [number, number][] = [
  [41.7, -87.53],
  [41.76, -87.555],
  [41.8, -87.578],
  [41.85, -87.605],
  [41.88, -87.615],
  [41.9, -87.622],
  [41.93, -87.632],
  [41.96, -87.64],
  [42.0, -87.655],
  [42.03, -87.66],
];
function shoreLon(lat: number): number {
  if (lat <= SHORE[0]![0]) return SHORE[0]![1];
  for (let i = 1; i < SHORE.length; i++) {
    const [a0, l0] = SHORE[i - 1]!, [a1, l1] = SHORE[i]!;
    if (lat <= a1) return l0 + ((l1 - l0) * (lat - a0)) / (a1 - a0);
  }
  return SHORE.at(-1)![1];
}
/** Express trail within ~1.6 km of the lake: the Lakefront Trail. */
const nearLake = ([lon, lat]: LonLat) => lat > 41.68 && lat < 42.03 && lon > shoreLon(lat) - 0.02;
/** The 606 (Bloomingdale Trail) corridor. */
const in606 = ([lon, lat]: LonLat) => lat > 41.9105 && lat < 41.9165 && lon > -87.7225 && lon < -87.6585;

export function speedKind(cls: InfraClass, tags: Tags, at: LonLat): SpeedKind {
  switch (cls) {
    case 'express':
      if (tags.railway === 'abandoned' || in606(at)) return 'trail606';
      return nearLake(at) ? 'lakefront' : 'express';
    case 'trail':
      return 'trail';
    case 'protected':
      return 'protected';
    case 'lane':
    case 'shared':
      return isArterialHw(tags.highway) ? 'lane' : 'side';
    case 'arterial':
      return 'arterial';
    case 'greenway':
    case 'quiet':
      return 'side';
    case 'other':
      return 'other';
  }
}

/** The 606's busy times: weekday rush and lunch, March–November, Chicago time. */
export function is606Peak(date: Date): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const month = Number(parts.month), weekday = parts.weekday as string;
  if (month < 3 || month > 11 || weekday === 'Sat' || weekday === 'Sun') return false;
  const t = Number(parts.hour) + Number(parts.minute) / 60;
  return (t >= 7 && t < 9.5) || (t >= 11.5 && t < 13.5) || (t >= 16 && t < 19);
}

type SpeedSettings = Pick<
  Settings,
  | 'lakefrontMph'
  | 'trail606PeakMph'
  | 'trail606OffPeakMph'
  | 'expressMph'
  | 'trailMph'
  | 'protectedMph'
  | 'laneMph'
  | 'arterialMph'
  | 'sideStreetMph'
  | 'otherMph'
>;

/** The rider's average speed (stops included) for a kind of segment. */
export function avgMph(kind: SpeedKind, s: SpeedSettings, peak606: boolean): number {
  switch (kind) {
    case 'lakefront':
      return s.lakefrontMph;
    case 'trail606':
      return peak606 ? s.trail606PeakMph : s.trail606OffPeakMph;
    case 'express':
      return s.expressMph;
    case 'trail':
      return s.trailMph;
    case 'protected':
      return s.protectedMph;
    case 'lane':
      return s.laneMph;
    case 'arterial':
      return s.arterialMph;
    case 'side':
      return s.sideStreetMph;
    case 'other':
      return s.otherMph;
  }
}

/**
 * Moving speed (m/s) that reproduces the rider's average once the ETA model adds its
 * stops at the calibration temperature: counted lights at CAL_LIGHTS_PER_MILE on through
 * streets, the flat buffer on side streets, nothing on trails.
 */
export function movingMps(kind: SpeedKind, s: SpeedSettings & Pick<Settings, 'tSignalS' | 'flatMax'>, peak606: boolean): number {
  const avg = mphToMps(avgMph(kind, s, peak606));
  const level = 1 - CAL_TEMPERATURE;
  switch (STOPS[kind]) {
    case 'none':
      return avg;
    case 'side':
      return avg * (1 + level * Math.min(Math.max(s.flatMax, 0), 0.5));
    case 'lights': {
      const stopSPerM = (CAL_LIGHTS_PER_MILE * level * s.tSignalS) / 1609.344;
      const movingSPerM = 1 / avg - stopSPerM;
      // Guard: a light-wait setting too large for the average would imply an absurd moving
      // speed; cap it at 1.5x the average.
      return movingSPerM > 1 / (1.5 * avg) ? 1 / movingSPerM : 1.5 * avg;
    }
  }
}

/**
 * Routing cost per meter by profile variable: time per meter relative to the fastest
 * class (so fastest = 1), times a small tie-break from the drag-to-rank list, with a
 * safety penalty on busy roads without bike lanes.
 */
export function routingFactors(s: Settings, peak606: boolean): Record<string, number> {
  const speeds = [s.lakefrontMph, s.trail606OffPeakMph, s.trail606PeakMph, s.expressMph, s.trailMph, s.protectedMph, s.laneMph, s.arterialMph, s.sideStreetMph, s.otherMph];
  const ref = Math.max(...speeds);
  const t = (mph: number) => ref / Math.max(mph, 1);
  const rank = (c: InfraClass) => (1 + s.pickiness) ** Math.max(s.ranking.indexOf(c), 0);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    cf_scale: 1,
    arterial_infra_bonus: 1,
    minor_street_factor: 1,
    busy_factor: 1,
    cf_express: r3(t(s.lakefrontMph)),
    cf_railtrail: r3(t(peak606 ? s.trail606PeakMph : s.trail606OffPeakMph)),
    cf_trail: r3(t(s.trailMph) * rank('trail')),
    cf_protected: r3(t(s.protectedMph) * rank('protected')),
    cf_lane: r3(t(s.laneMph) * rank('lane')),
    cf_shared: r3(t(s.laneMph) * rank('shared')),
    cf_infra_minor: r3(t(s.sideStreetMph) * rank('lane')),
    cf_greenway: r3(t(s.sideStreetMph) * rank('greenway')),
    cf_quiet: r3(t(s.sideStreetMph) * rank('quiet')),
    cf_arterial: r3(t(s.arterialMph) * rank('arterial') * s.busyRoadPenalty),
    cf_other: r3(t(s.otherMph) * (1 + s.pickiness) ** RANKABLE.length),
  };
}
