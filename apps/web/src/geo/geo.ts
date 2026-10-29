const R = 6371008.8; // mean Earth radius, m
const rad = (d: number) => (d * Math.PI) / 180;

export type LonLat = [number, number];

export function haversine(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Initial bearing a→b in degrees [0, 360). */
export function bearing(a: LonLat, b: LonLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Absolute heading change in degrees [0, 180]. */
export function turnAngle(inBearing: number, outBearing: number): number {
  const d = Math.abs(outBearing - inBearing) % 360;
  return d > 180 ? 360 - d : d;
}
