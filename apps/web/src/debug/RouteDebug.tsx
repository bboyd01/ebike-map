import { useState } from 'preact/hooks';
import { decodeControls, type Controls } from '../controls/controls';
import { estimate, type Eta } from '../eta/eta';
import type { LonLat } from '../geo/geo';
import { routeUrl } from '../routing/params';
import { parseBRouter } from '../routing/parse';
import { rankAlternatives } from '../routing/rank';
import { DEFAULT_SETTINGS } from '../settings/settings';
import { mpsToMph } from '../settings/units';

// Phase 0 route debugger: two points in, ranked alternatives with the ETA breakdown out.
// Replaced by the map UI in Phase 1.

const parseLatLon = (s: string): LonLat | null => {
  const m = s.split(',').map((x) => Number(x.trim()));
  return m.length === 2 && m.every(Number.isFinite) ? [m[1]!, m[0]!] : null;
};

async function loadControls(): Promise<Controls | null> {
  try {
    const manifest = await (await fetch('/data/manifest.json')).json();
    const file = manifest.areas.metro.controls as string;
    return decodeControls(await (await fetch(`/data/${file}`)).arrayBuffer());
  } catch {
    return null; // no controls → flat offset everywhere
  }
}

const fmtMin = (s: number) => `${Math.round(s / 60)} min`;
const arrival = (s: number) => new Date(Date.now() + s * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function RouteDebug() {
  const [from, setFrom] = useState('41.9295, -87.7078'); // Logan Square
  const [to, setTo] = useState('41.8840, -87.6301'); // Daley Plaza
  const [alts, setAlts] = useState<{ eta: Eta; overDetour: boolean; idx: number }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    const a = parseLatLon(from), b = parseLatLon(to);
    if (!a || !b) return setError('Enter points as "lat, lon".');
    setError('');
    setBusy(true);
    try {
      const s = DEFAULT_SETTINGS;
      const controls = await loadControls();
      // BRouter computes alternatives cumulatively (alt 2 recomputes 0 and 1), so
      // fetch them in order and show each as it arrives.
      const found: { idx: number; eta: Eta }[] = [];
      for (const idx of [0, 1, 2]) {
        const res = await fetch(routeUrl('/route', [a, b], s, idx));
        if (!res.ok) {
          if (idx === 0) throw new Error(await res.text());
          break;
        }
        found.push({ idx, eta: estimate(parseBRouter(await res.json()), s, controls) });
        setAlts(rankAlternatives(found, s));
      }
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>ebike-map · route debugger</h1>
      <label for="from">From (lat, lon)</label>
      <input id="from" value={from} onInput={(e) => setFrom(e.currentTarget.value)} />
      <label for="to">To (lat, lon)</label>
      <input id="to" value={to} onInput={(e) => setTo(e.currentTarget.value)} />
      <button onClick={go} disabled={busy}>{busy ? 'Routing…' : 'Route'}</button>
      {error && <p class="err">{error}</p>}
      {alts.map(({ eta, overDetour, idx }) => (
        <div class="card" key={idx}>
          <div class="eta">
            {fmtMin(eta.totalS)} · arrive {arrival(eta.totalS)} · avg {mpsToMph(eta.avgMps).toFixed(1)} mph
          </div>
          <div class="muted">
            {(eta.distanceM / 1609.344).toFixed(1)} mi · {mpsToMph(eta.movingAvgMps).toFixed(1)} mph moving · alternative {idx}
            {overDetour && ' · over max detour'}
          </div>
          <div class="muted">
            moving {fmtMin(eta.movingS)} + turns {Math.round(eta.turnS)} s + offset {fmtMin(eta.offset.seconds)} (
            {eta.offset.mode === 'flat'
              ? `estimated +${Math.round(eta.offset.flatS / eta.movingS * 100)}%`
              : `${eta.offset.signals} lights · ${eta.offset.stops + eta.offset.allWayStops} stop signs` +
                (eta.offset.mode === 'mixed' ? ` + estimated for ${Math.round(eta.offset.flatFraction * 100)}% of the ride` : '')}
            )
          </div>
          <div class="muted">
            {Object.entries(eta.byClassM)
              .filter(([, m]) => m > 0)
              .sort((x, y) => y[1] - x[1])
              .map(([c, m]) => `${c} ${Math.round((m / eta.distanceM) * 100)}%`)
              .join(' · ')}
          </div>
        </div>
      ))}
    </main>
  );
}
