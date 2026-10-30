import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AREA_LABEL } from '../data/manifest';
import { CAL_LIGHTS_PER_MILE } from '../eta/speeds';
import { signOut } from '../auth';
import { downloadOffline, fmtMB, offlineInfo, removeOffline, type OfflineInfo } from '../data/offline';
import { CLASS_COLORS, CLASS_LABEL, prefersDark } from '../map/palette';
import { costFactors, normalizeRanking, type AreaId, type BikeClass, type InfraClass, type Position, type Settings } from '../settings/settings';
import { LB } from '../settings/units';
import { resetSettings, settings, updateSettings } from '../state/settings';
import { CloseIcon, DownIcon, GripIcon, UpIcon } from './icons';

const KMH_PER_MPH = 1.609344;

type SpeedKey = 'lakefrontMph' | 'trail606PeakMph' | 'trail606OffPeakMph' | 'expressMph' | 'laneMph' | 'protectedMph' | 'arterialMph' | 'sideStreetMph' | 'trailMph' | 'otherMph';
const SPEED_ROWS: [SpeedKey, string, string][] = [
  ['lakefrontMph', 'Lakefront Trail', 'When not congested'],
  ['trail606OffPeakMph', '606, off-peak', 'Nights, weekends, winter'],
  ['trail606PeakMph', '606, busy', 'Weekday rush and lunch, March–November'],
  ['expressMph', 'Other regional trails', 'North Branch Trail and similar'],
  ['laneMph', 'Painted or shared lanes', 'On through streets: Elston, Damen, Clark, Division'],
  ['protectedMph', 'Protected lanes', 'Milwaukee, Belmont, Augusta'],
  ['arterialMph', 'Busy roads, no bike lane', 'North, Western, Ashland, Fullerton'],
  ['sideStreetMph', 'Side streets', 'Residential, stop sign most blocks'],
  ['trailMph', 'Park paths', 'Other off-street paths'],
  ['otherMph', 'Everything else', 'Alleys, parking lots'],
];

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ComponentChildren; htmlFor?: string }) {
  return (
    <div class="setting">
      <div>
        <label for={htmlFor}>{label}</label>
        {hint && <div class="muted small">{hint}</div>}
      </div>
      <div class="setting-control">{children}</div>
    </div>
  );
}

function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <input id={id} type="checkbox" role="switch" class="switch" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />;
}

function Slider(p: { id: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; display: string }) {
  return (
    <div class="slider">
      <input id={p.id} type="range" min={p.min} max={p.max} step={p.step} value={p.value} onInput={(e) => p.onChange(Number(e.currentTarget.value))} />
      <output for={p.id}>{p.display}</output>
    </div>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}

/** Drag-to-reorder list of infrastructure classes (SPEC §5.2), with arrow buttons for keyboards. */
function RankingList({ s }: { s: Settings }) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const colors = CLASS_COLORS[prefersDark() ? 'dark' : 'light'];
  const cf = costFactors(s);
  const shown = drag ? move(s.ranking, drag.from, drag.over) : s.ranking;

  const commit = (next: InfraClass[]) => updateSettings({ ranking: normalizeRanking(next) });

  const onPointerDown = (i: number) => (e: PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const mids = rows.current.map((r) => (r ? r.getBoundingClientRect().top + r.offsetHeight / 2 : 0));
    let over = i;
    setDrag({ from: i, over });
    const onMove = (ev: PointerEvent) => {
      const idx = mids.findIndex((m) => ev.clientY < m);
      over = idx === -1 ? mids.length - 1 : idx;
      setDrag({ from: i, over });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (over !== i) commit(move(s.ranking, i, over));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <ol class="ranking">
      {shown.map((c, i) => (
        <li key={c} ref={(el) => {
            rows.current[i] = el;
          }} class={drag && shown[drag.over] === c ? 'dragging' : ''}>
          <span class="rank">{i + 1}</span>
          <i class="swatch" style={{ background: colors[c] }} />
          <span class="rank-label">{CLASS_LABEL[c]}</span>
          <span class="muted small cf" title="Cost per meter relative to your top choice">×{cf[c].toFixed(2)}</span>
          <button class="icon-btn small" aria-label={`Move ${CLASS_LABEL[c]} up`} disabled={i === 0} onClick={() => commit(move(s.ranking, i, i - 1))}>
            <UpIcon />
          </button>
          <button class="icon-btn small" aria-label={`Move ${CLASS_LABEL[c]} down`} disabled={i === shown.length - 1} onClick={() => commit(move(s.ranking, i, i + 1))}>
            <DownIcon />
          </button>
          <span class="grip" aria-hidden="true" onPointerDown={onPointerDown(i)}>
            <GripIcon />
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Save the whole area's basemap on the device, so the map works without a connection. */
function OfflineMap({ url, areaName, onChange }: { url: string | null; areaName: string; onChange: () => void }) {
  const [info, setInfo] = useState<OfflineInfo | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (url) offlineInfo(url).then(setInfo);
    return () => abort.current?.abort();
  }, [url]);

  if (!url) return <p class="muted small">Available once your server has finished setting up map data.</p>;
  if (url.startsWith('https://build.protomaps.com')) return <p class="muted small">Not available in development mode.</p>;

  const start = async () => {
    setError(null);
    abort.current = new AbortController();
    setProgress({ done: 0, total: 0 });
    try {
      await downloadOffline(url, (done, total) => setProgress({ done, total }), abort.current.signal);
      setInfo(await offlineInfo(url));
      onChange();
    } catch (e) {
      if (!abort.current.signal.aborted) setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div class="setting offline">
      <div>
        <div>{areaName} map on this device</div>
        <div class="muted small">
          {progress
            ? `Downloading… ${pct}% (${fmtMB(progress.done)}${progress.total ? ` of ${fmtMB(progress.total)}` : ''})`
            : info
              ? `Saved (${fmtMB(info.bytes)}, ${new Date(info.savedAt).toLocaleDateString()}). The map works offline; routing still needs a connection.`
              : 'Without this, map pieces download as you view them and stay in the browser cache.'}
        </div>
        {progress && (
          <div class="progress" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        {error && <div class="error small">{error}</div>}
      </div>
      <div class="setting-control">
        {progress ? (
          <button class="btn secondary" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        ) : info ? (
          <button
            class="btn secondary"
            onClick={async () => {
              await removeOffline(url);
              setInfo(null);
              onChange();
            }}
          >
            Remove
          </button>
        ) : (
          <button class="btn" onClick={start}>
            Download
          </button>
        )}
      </div>
    </div>
  );
}

export function SettingsPanel({ mapUrl, onClose, onChangeArea, onOfflineChange }: { mapUrl: string | null; onClose: () => void; onChangeArea: () => void; onOfflineChange: () => void }) {
  const s = settings.value;
  const metric = s.units === 'metric';
  const speed = (mph: number) => (metric ? `${Math.round(mph * KMH_PER_MPH)} km/h` : `${mph} mph`);
  const level = 1 - s.temperature;

  return (
    <div class="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="settings-header">
        <h1 id="settings-title">Settings</h1>
        <button class="icon-btn" aria-label="Close settings" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div class="settings-body">
        <Section title="Your bike">
          <Row label="E-bike class" htmlFor="bike-class" hint="Sets where the motor stops assisting">
            <select id="bike-class" value={s.bikeClass} onChange={(e) => updateSettings({ bikeClass: e.currentTarget.value as BikeClass, throttle: e.currentTarget.value === 'class2' ? true : s.throttle })}>
              <option value="class1">Class 1 (20 mph, pedal assist)</option>
              <option value="class2">Class 2 (20 mph, throttle)</option>
              <option value="class3">Class 3 (28 mph)</option>
              <option value="custom">Custom cutoff</option>
            </select>
          </Row>
          {s.bikeClass === 'custom' && (
            <Row label="Assist cutoff" htmlFor="cutoff">
              <Slider id="cutoff" min={12} max={35} step={1} value={s.customCutoffMph} onChange={(v) => updateSettings({ customCutoffMph: v })} display={speed(s.customCutoffMph)} />
            </Row>
          )}
          <Row label="Motor power" htmlFor="motor">
            <Slider id="motor" min={250} max={1000} step={50} value={s.motorW} onChange={(v) => updateSettings({ motorW: v })} display={`${s.motorW} W`} />
          </Row>
          <Row label="Rider + bike weight" htmlFor="mass">
            <Slider
              id="mass"
              min={50}
              max={180}
              step={1}
              value={s.massKg}
              onChange={(v) => updateSettings({ massKg: v })}
              display={metric ? `${s.massKg} kg` : `${Math.round(s.massKg / LB)} lb`}
            />
          </Row>
          <Row label="Cornering speed" htmlFor="corner" hint="How fast you take a 90° corner. Each turn costs the time to slow down to this and speed back up">
            <Slider id="corner" min={6} max={20} step={1} value={s.cornerMph} onChange={(v) => updateSettings({ cornerMph: v })} display={speed(s.cornerMph)} />
          </Row>
          <Row label="Riding position" htmlFor="position" hint="Affects wind resistance">
            <select id="position" value={s.position} onChange={(e) => updateSettings({ position: e.currentTarget.value as Position })}>
              <option value="upright">Upright (cargo, cruiser)</option>
              <option value="commuter">Commuter</option>
              <option value="sporty">Sporty</option>
            </select>
          </Row>
          <Row label="Throttle" htmlFor="throttle" hint="Faster launches from stops">
            <Toggle id="throttle" checked={s.throttle} onChange={(v) => updateSettings({ throttle: v })} />
          </Row>
        </Section>

        <Section title="Your average speeds">
          <p class="muted small">
            Your typical average on each kind of street, stops included. Arrival times are calibrated to these, and routes take the fastest path using them.
          </p>
          {SPEED_ROWS.map(([key, label, hint]) => (
            <Row key={key} label={label} htmlFor={`sp-${key}`} hint={hint}>
              <Slider id={`sp-${key}`} min={5} max={30} step={1} value={s[key]} onChange={(v) => updateSettings({ [key]: v } as Partial<Settings>)} display={speed(s[key])} />
            </Row>
          ))}
          <Row label="Busy roads without a bike lane" htmlFor="busy" hint="Safety penalty in routing: fine for a few blocks, avoided for long stretches">
            <Slider id="busy" min={1} max={4} step={0.25} value={s.busyRoadPenalty} onChange={(v) => updateSettings({ busyRoadPenalty: v })} display={`×${s.busyRoadPenalty}`} />
          </Row>
        </Section>

        <Section title="Street preferences">
          <p class="muted small">Tie-breaker when routes are about equally fast: drag to rank. Busy roads without bike lanes can't go above 5th.</p>
          <RankingList s={s} />
          <Row label="Tie-break strength" htmlFor="pickiness" hint="How much the ranking can outweigh speed">
            <Slider id="pickiness" min={0} max={0.2} step={0.01} value={s.pickiness} onChange={(v) => updateSettings({ pickiness: Math.round(v * 100) / 100 })} display={s.pickiness < 0.02 ? 'Off' : s.pickiness < 0.08 ? 'Light' : 'Strong'} />
          </Row>
          <Row label="Max detour" htmlFor="detour" hint="Routes longer than this are listed last">
            <Slider id="detour" min={0} max={0.6} step={0.05} value={s.maxDetour} onChange={(v) => updateSettings({ maxDetour: v })} display={`+${Math.round(s.maxDetour * 100)}%`} />
          </Row>
          <Row label="Avoid unpaved" htmlFor="unpaved">
            <Toggle id="unpaved" checked={s.avoidUnpaved} onChange={(v) => updateSettings({ avoidUnpaved: v })} />
          </Row>
          <Row label="Avoid rough surfaces" htmlFor="rough" hint="Cobbles, brick, broken pavement">
            <Toggle id="rough" checked={s.avoidRough} onChange={(v) => updateSettings({ avoidRough: v })} />
          </Row>
          <Row label="Avoid walking the bike" htmlFor="dismount" hint="Stairs and sidewalks">
            <Toggle id="dismount" checked={s.avoidDismount} onChange={(v) => updateSettings({ avoidDismount: v })} />
          </Row>
        </Section>

        <Section title="Temperature">
          <Row label="Stop buffer" htmlFor="temperature" hint="Time added for lights and stop signs">
            <Slider
              id="temperature"
              min={0}
              max={1}
              step={0.05}
              value={s.temperature}
              onChange={(v) => updateSettings({ temperature: v })}
              display={s.temperature <= 0.2 ? 'Cautious' : s.temperature >= 0.8 ? 'Assertive' : 'Typical'}
            />
          </Row>
          <p class="muted small">
            At this setting: {Math.round(level * s.tSignalS)} s per stoplight (estimated at {CAL_LIGHTS_PER_MILE} per mile where they aren't mapped), plus{' '}
            {Math.round(level * s.flatMax * 100)}% of riding time on side streets for stop signs. Trails get no buffer. At the middle setting, your average
            speeds above come out exactly.
          </p>
          <details>
            <summary>Advanced</summary>
            <Row label="Worst-case wait per light" htmlFor="tsig">
              <Slider id="tsig" min={0} max={120} step={5} value={s.tSignalS} onChange={(v) => updateSettings({ tSignalS: v })} display={`${s.tSignalS} s`} />
            </Row>
            <Row label="Side-street buffer" htmlFor="flat" hint="Percent of side-street riding time for stop signs, at the cautious end">
              <Slider id="flat" min={0} max={0.5} step={0.05} value={s.flatMax} onChange={(v) => updateSettings({ flatMax: v })} display={`${Math.round(s.flatMax * 100)}%`} />
            </Row>
            <Row label="Downhill speed cap" htmlFor="descent">
              <Slider id="descent" min={12} max={35} step={1} value={s.descentCapMph} onChange={(v) => updateSettings({ descentCapMph: v })} display={speed(s.descentCapMph)} />
            </Row>
          </details>
        </Section>

        <Section title="Offline map">
          <OfflineMap url={mapUrl} areaName={AREA_LABEL[(s.area ?? 'city') as AreaId].name} onChange={onOfflineChange} />
        </Section>

        <Section title="App">
          <Row label="Units" htmlFor="units">
            <select id="units" value={s.units} onChange={(e) => updateSettings({ units: e.currentTarget.value as Settings['units'] })}>
              <option value="imperial">Miles, mph</option>
              <option value="metric">Kilometers, km/h</option>
            </select>
          </Row>
          <Row label="Map area" hint={s.area ? AREA_LABEL[s.area as AreaId].name : 'Not chosen'}>
            <button class="btn secondary" onClick={onChangeArea}>
              Change
            </button>
          </Row>
          <Row label="Reset all settings" hint="Keeps your map area">
            <button class="btn secondary" onClick={() => confirm('Reset all settings to defaults?') && resetSettings()}>
              Reset
            </button>
          </Row>
          <Row label="Sign out" hint="You'll need the password to get back in">
            <button class="btn secondary" onClick={signOut}>
              Sign out
            </button>
          </Row>
        </Section>
      </div>
    </div>
  );
}
