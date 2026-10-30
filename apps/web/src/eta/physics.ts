// Power-balance speed model (SPEC §7.2). SI units throughout.
const G = 9.81;
const RHO = 1.2;
export const ETA_DRIVETRAIN = 0.8;

export interface RiderModel {
  massKg: number;
  cda: number;
  crr: number;
  cruiseMps: number;
  cutoffMps: number;
  motorW: number;
  riderW: number;
  descentCapMps: number;
}

/** Power needed to hold speed v on grade g (rise/run). */
export function powerRequired(v: number, grade: number, m: RiderModel): number {
  const th = Math.atan(grade);
  return v * (m.massKg * G * (m.crr * Math.cos(th) + Math.sin(th)) + 0.5 * RHO * m.cda * v * v);
}

/** Speed at which powerRequired(v) = P. Bisection; P(v) is increasing past its minimum. */
export function solveSpeed(power: number, grade: number, m: RiderModel): number {
  let lo = 0, hi = 40;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (powerRequired(mid, grade, m) < power) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Extra effort riders put in on climbs: 1.0 on the flat up to 1.35 at ≥ 6%. */
const kHill = (grade: number) => 1 + 0.35 * Math.min(Math.max(grade / 0.06, 0), 1);

/** Steady-state speed on a grade, before context caps (SPEC §7.2 steps 1–6). */
export function steadySpeed(grade: number, m: RiderModel): number {
  const pCruise = powerRequired(m.cruiseMps, 0, m);
  // A rider who cruises above the cutoff is producing that power without assist.
  const pRiderEff = m.cruiseMps > m.cutoffMps ? Math.max(m.riderW, pCruise) : m.riderW;

  if (grade <= -0.01) {
    return Math.min(solveSpeed(0.5 * pCruise, grade, m), m.descentCapMps);
  }
  const pAvail = Math.min(pCruise * kHill(grade), pRiderEff + ETA_DRIVETRAIN * m.motorW);
  let v = solveSpeed(pAvail, grade, m);
  if (v > m.cutoffMps) v = Math.max(m.cutoffMps, solveSpeed(pRiderEff, grade, m));
  if (Math.abs(grade) < 0.01) v = Math.min(v, m.cruiseMps * 1.05);
  return v;
}

/** Launch acceleration in m/s² (SPEC §7.4). */
export function launchAccel(v: number, m: RiderModel, throttle: boolean): number {
  const a = (ETA_DRIVETRAIN * m.motorW) / (m.massKg * Math.max(v / 2, 0.5));
  return Math.min(Math.max(a, 0.6), 1.8) + (throttle ? 0.2 : 0);
}

export const DECEL = 1.5;

/** Time lost slowing from v to vMin and accelerating back to v. */
export function slowdownLoss(v: number, vMin: number, accel: number): number {
  if (v <= vMin) return 0;
  return ((v - vMin) ** 2 / (2 * v)) * (1 / DECEL + 1 / accel);
}

/** Turn speed relative to the rider's 90° cornering speed, by turn angle (deg). */
const TURN_FACTOR: [number, number][] = [
  [45, 1.5],
  [90, 1],
  [135, 0.75],
  [180, 0.4], // U-turn
];

/** Speed through a turn of `angleDeg`, given the rider's speed through a 90° corner. */
export function turnSpeed(angleDeg: number, cornerMps: number): number {
  const a = Math.min(Math.max(angleDeg, TURN_FACTOR[0]![0]), 180);
  for (let i = 1; i < TURN_FACTOR.length; i++) {
    const [a0, f0] = TURN_FACTOR[i - 1]!, [a1, f1] = TURN_FACTOR[i]!;
    if (a <= a1) return cornerMps * (f0 + ((f1 - f0) * (a - a0)) / (a1 - a0));
  }
  return cornerMps * TURN_FACTOR.at(-1)![1];
}
