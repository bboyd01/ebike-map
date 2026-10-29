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

/** Corner radius by turn angle (deg), linearly interpolated. */
const RADII: [number, number][] = [
  [45, 12],
  [90, 6],
  [135, 4],
  [180, 2],
];
export function turnSpeed(angleDeg: number): number {
  let r = RADII[0]![1];
  for (let i = 1; i < RADII.length; i++) {
    const [a0, r0] = RADII[i - 1]!, [a1, r1] = RADII[i]!;
    if (angleDeg <= a1) {
      r = r0 + ((r1 - r0) * (Math.max(angleDeg, a0) - a0)) / (a1 - a0);
      break;
    }
    r = r1;
  }
  return Math.sqrt(0.5 * G * r) * 0.85;
}
