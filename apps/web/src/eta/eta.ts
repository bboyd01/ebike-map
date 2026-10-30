import { controlsOnRoute, ControlType, isCovered, type Controls, type RouteControl } from '../controls/controls';
import { bearing, haversine, turnAngle, type LonLat } from '../geo/geo';
import { classify, isDismount, surfaceKind } from '../routing/classify';
import type { ParsedRoute } from '../routing/parse';
import { assistCutoffMps, POSITIONS, type InfraClass, type Settings } from '../settings/settings';
import { mphToMps } from '../settings/units';
import { computeOffset, type OffsetResult } from './offset';
import { launchAccel, slowdownLoss, steadySpeed, turnSpeed, type RiderModel } from './physics';

export interface EdgeEstimate {
  distM: number;
  speedMps: number;
  timeS: number;
  cls: InfraClass;
}

export interface Eta {
  distanceM: number;
  movingS: number;
  turnS: number;
  offset: OffsetResult;
  totalS: number;
  avgMps: number; // distance / total ETA
  movingAvgMps: number; // distance / moving time
  byClassM: Record<InfraClass, number>;
  turns: number; // real turns (left/right/sharp/U/roundabout) from BRouter's voicehints
  edges: EdgeEstimate[];
  controls: RouteControl[];
}

const is = (v: string | undefined, ...vals: string[]) => v !== undefined && vals.includes(v);
const WALK_MPS = 1.2;
const SURFACE_MULT = { paved: 1, unpaved: 0.75, rough: 0.8 } as const;
const GRADE_WINDOW_M = 50;
const MIN_TURN_DEG = 50;
const LEFT_TURN_MIN_DEG = 60;
// BRouter VoiceHint commands that count as a turn (not "slightly", "keep" or "continue").
const TURN_COMMANDS = new Set([2, 4, 5, 7, 10, 11, 13, 14, 15]);

export function riderModel(s: Settings): RiderModel {
  const pos = POSITIONS[s.position];
  return {
    massKg: s.massKg,
    cda: pos.cda,
    crr: pos.crr,
    cruiseMps: mphToMps(s.cruiseMph),
    cutoffMps: assistCutoffMps(s),
    motorW: s.motorW,
    riderW: s.riderW,
    descentCapMps: mphToMps(s.descentCapMph),
  };
}

/** Grade per edge from elevation smoothed over a ±25 m window (SPEC §7.2). */
export function edgeGrades(coords: LonLat[], elev: (number | null)[]): number[] {
  const n = coords.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1]! + haversine(coords[i - 1]!, coords[i]!));
  const elevAt = (target: number) => {
    // linear interpolation of elevation at distance `target`
    let i = 0;
    while (i < n - 1 && cum[i + 1]! < target) i++;
    const e0 = elev[i], e1 = elev[Math.min(i + 1, n - 1)];
    if (e0 == null || e1 == null) return null;
    const span = cum[Math.min(i + 1, n - 1)]! - cum[i]!;
    return span > 0 ? e0 + ((e1 - e0) * (target - cum[i]!)) / span : e0;
  };
  const total = cum[n - 1] ?? 0;
  const grades: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const mid = (cum[i]! + cum[i + 1]!) / 2;
    const a = Math.max(0, mid - GRADE_WINDOW_M / 2), b = Math.min(total, mid + GRADE_WINDOW_M / 2);
    const ea = elevAt(a), eb = elevAt(b);
    grades.push(ea == null || eb == null || b - a < 1 ? 0 : (eb - ea) / (b - a));
  }
  return grades;
}

export function estimate(route: ParsedRoute, s: Settings, controls: Controls | null): Eta {
  const m = riderModel(s);
  const grades = edgeGrades(route.coords, route.elev);
  const trailCap = mphToMps(s.trailCapMph);
  const busyCap = Math.min(m.cruiseMps, mphToMps(18));

  const byClassM = { express: 0, shared: 0, lane: 0, protected: 0, trail: 0, greenway: 0, quiet: 0, arterial: 0, other: 0 };
  const expressV = mphToMps(s.expressTrailMph);
  const edges: EdgeEstimate[] = [];
  let movingS = 0, distanceM = 0, estimatedMovingS = 0, streetMovingS = 0;

  route.edges.forEach((e, i) => {
    const a = route.coords[e.from]!, b = route.coords[e.to]!;
    const distM = haversine(a, b);
    const cls = classify(e.wayTags);
    let v: number;
    if (isDismount(e.wayTags)) v = WALK_MPS;
    // Express trails: the rider's own average (no stops, no cars), not the power model.
    else if (cls === 'express') v = expressV;
    else {
      v = steadySpeed(grades[i] ?? 0, m) * SURFACE_MULT[surfaceKind(e.wayTags)];
      if (cls === 'trail') v = Math.min(v, trailCap);
      if (cls === 'shared' || cls === 'arterial') v = Math.min(v, busyCap);
    }
    const timeS = distM / v;
    edges.push({ distM, speedMps: v, timeS, cls });
    movingS += timeS;
    distanceM += distM;
    byClassM[cls] += distM;
    const mid: LonLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // Express trails have essentially no stops, so they're left out of the stop buffer.
    if (cls !== 'express') {
      streetMovingS += timeS;
      // Side streets: stop signs (not counted; OSM coverage is incomplete) -> flat %.
      // Elsewhere: counted lights where they're mapped, flat % where they aren't.
      const sideStreet = is(e.wayTags.highway, 'residential', 'living_street', 'unclassified', 'service');
      if (sideStreet || !controls || !isCovered(controls, mid[0], mid[1])) estimatedMovingS += timeS;
    }
  });

  // Turn losses at vertices with a sharp heading change (SPEC §7.4).
  let turnS = 0;
  const leftTurnAt = new Set<number>();
  for (let i = 1; i < route.coords.length - 1; i++) {
    const inB = bearing(route.coords[i - 1]!, route.coords[i]!);
    const outB = bearing(route.coords[i]!, route.coords[i + 1]!);
    const ang = turnAngle(inB, outB);
    if (ang < MIN_TURN_DEG) continue;
    const vIn = edges[i - 1]?.speedMps ?? 0, vOut = edges[i]?.speedMps ?? 0;
    const v = Math.min(vIn, vOut);
    turnS += slowdownLoss(v, Math.min(turnSpeed(ang), v), launchAccel(v, m, s.throttle));
    const signedLeft = ((outB - inB + 540) % 360) - 180 < 0;
    if (signedLeft && ang >= LEFT_TURN_MIN_DEG) leftTurnAt.add(i);
  }

  const onRoute = controls ? controlsOnRoute(controls, route.coords) : [];
  const counted = onRoute.filter((c) => {
    const p = route.coords[c.index]!;
    return controls !== null && isCovered(controls, p[0], p[1]);
  });
  // A left turn "at" a signal: the turn vertex is within 3 vertices of a signal node.
  const leftTurnSignals = counted.filter(
    (c) =>
      (c.type === ControlType.signal || c.type === ControlType.crossingSignal) &&
      [-3, -2, -1, 0, 1, 2, 3].some((d) => leftTurnAt.has(c.index + d)),
  ).length;

  const offset = computeOffset({ controls: counted, leftTurnSignals, estimatedMovingS, totalMovingS: streetMovingS }, s);
  const totalS = movingS + turnS + offset.seconds;
  return {
    distanceM,
    movingS,
    turnS,
    offset,
    totalS,
    avgMps: totalS > 0 ? distanceM / totalS : 0,
    movingAvgMps: movingS > 0 ? distanceM / movingS : 0,
    byClassM,
    turns: route.voicehints.filter((v) => TURN_COMMANDS.has(v[1] ?? 0)).length,
    edges,
    controls: counted,
  };
}
