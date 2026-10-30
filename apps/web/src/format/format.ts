import type { Settings } from '../settings/settings';
import { mpsToKmh, mpsToMph } from '../settings/units';

type Units = Settings['units'];

export function fmtDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function fmtArrival(seconds: number, now = Date.now()): string {
  return new Date(now + seconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function fmtDistance(m: number, units: Units): string {
  if (units === 'metric') return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
  const mi = m / 1609.344;
  return mi < 0.2 ? `${Math.round((m * 3.28084) / 50) * 50} ft` : `${mi.toFixed(1)} mi`;
}

export function fmtSpeed(mps: number, units: Units): string {
  return units === 'metric' ? `${mpsToKmh(mps).toFixed(1)} km/h` : `${mpsToMph(mps).toFixed(1)} mph`;
}
