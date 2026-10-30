import type { Eta } from '../eta/eta';
import { fmtArrival, fmtDistance, fmtDuration, fmtSpeed } from '../format/format';
import { CLASS_COLORS, CLASS_LABEL, prefersDark } from '../map/palette';
import type { RouteOption } from '../routing/client';
import type { InfraClass, Settings } from '../settings/settings';

const ORDER: InfraClass[] = ['express', 'protected', 'trail', 'lane', 'shared', 'greenway', 'quiet', 'arterial', 'other'];

function ClassBar({ eta, units, legend }: { eta: Eta; units: Settings['units']; legend: boolean }) {
  const colors = CLASS_COLORS[prefersDark() ? 'dark' : 'light'];
  const parts = ORDER.map((c) => ({ c, m: eta.byClassM[c] })).filter((p) => p.m / eta.distanceM >= 0.01);
  return (
    <div>
      <div class="classbar" role="img" aria-label={parts.map((p) => `${CLASS_LABEL[p.c]} ${pct(p.m, eta.distanceM)}`).join(', ')}>
        {parts.map((p) => (
          <span key={p.c} style={{ flexGrow: p.m, background: colors[p.c] }} />
        ))}
      </div>
      {legend && (
      <ul class="legend">
        {parts.slice(0, 4).map((p) => (
          <li key={p.c}>
            <i style={{ background: colors[p.c] }} />
            {CLASS_LABEL[p.c]} {pct(p.m, eta.distanceM)}
            <span class="sr-only"> ({fmtDistance(p.m, units)})</span>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

const pct = (m: number, total: number) => `${Math.round((m / total) * 100)}%`;

function offsetText(eta: Eta): string {
  const o = eta.offset;
  if (o.seconds === 0) return 'No stop buffer';
  const parts: string[] = [];
  if (o.lights > 0) parts.push(`${o.lights} stoplight${o.lights === 1 ? '' : 's'}`);
  if (o.estimateS > 0) parts.push(`${Math.round(o.estimatedFraction * 100)}% of the ride estimated (side streets, unmapped areas)`);
  return `+${fmtDuration(o.seconds)} for stops: ${parts.join(' · ')}`;
}

interface RouteSheetProps {
  options: RouteOption[];
  selected: string | null;
  loading: 'idle' | 'first' | 'more';
  units: Settings['units'];
  onSelect: (id: string) => void;
}

export function RouteSheet({ options, selected, loading, units, onSelect }: RouteSheetProps) {
  if (!options.length && loading === 'idle') return null;
  return (
    <section class="sheet card" aria-live="polite">
      {loading === 'first' && <p class="muted">Finding routes…</p>}
      <ol class="routes">
        {options.map((o, i) => {
          const isSel = (selected ?? options[0]?.id) === o.id;
          return (
            <li key={o.id}>
              <button class={`route${isSel ? ' selected' : ''}`} aria-pressed={isSel} onClick={() => onSelect(o.id)}>
                <div class="route-head">
                  <span class="eta">{fmtDuration(o.eta.totalS)}</span>
                  <span class="arrive">arrive {fmtArrival(o.eta.totalS)}</span>
                  <span class="avg">avg {fmtSpeed(o.eta.avgMps, units)}</span>
                </div>
                {(o.simplest || (i === 0 && options.length > 1)) && (
                  <div class="tags">
                    {i === 0 && options.length > 1 && <span class="tag">Best match</span>}
                    {o.simplest && <span class="tag">Simplest · ignores bike lanes</span>}
                  </div>
                )}
                <div class="muted">
                  {fmtDistance(o.eta.distanceM, units)} · {o.eta.turns} turn{o.eta.turns === 1 ? '' : 's'} · {fmtSpeed(o.eta.movingAvgMps, units)} while moving
                  {o.overDetour && ' · longer than your max detour'}
                </div>
                <ClassBar eta={o.eta} units={units} legend={isSel} />
                {isSel && <div class="muted small">{offsetText(o.eta)}</div>}
              </button>
            </li>
          );
        })}
      </ol>
      {loading === 'more' && <p class="muted small">Looking for alternatives…</p>}
    </section>
  );
}
