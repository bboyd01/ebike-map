import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Controls } from '../controls/controls';
import { AREA_BBOX, loadControls, loadManifest, pmtilesUrl } from '../data/manifest';
import type { LonLat } from '../geo/geo';
import { reverseLabel, type Place } from '../geocode/photon';
import { MapView } from '../map/MapView';
import { evaluate, fetchRoutes, routingKey, type RawRoute } from '../routing/client';
import type { AreaId } from '../settings/settings';
import { settings, updateSettings } from '../state/settings';
import { AreaPicker } from './AreaPicker';
import { GearIcon, LocateIcon } from './icons';
import { PinMenu } from './PinMenu';
import { RouteSheet } from './RouteSheet';
import { SearchPanel, type Endpoint } from './SearchPanel';
import { SettingsPanel } from './SettingsPanel';

const inBbox = (p: LonLat, b: number[]) => p[0] >= b[0]! && p[0] <= b[2]! && p[1] >= b[1]! && p[1] <= b[3]!;

function getPosition(): Promise<LonLat> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location isn’t available on this device.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Location permission is off. Choose a start point instead.' : 'Couldn’t get your location.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

export function App() {
  const s = settings.value;
  const area: AreaId = s.area ?? 'city';
  const bbox = AREA_BBOX[area];

  const [pickingArea, setPickingArea] = useState(s.area === null);
  const [showSettings, setShowSettings] = useState(false);
  const [pmtiles, setPmtiles] = useState<string | null | undefined>(undefined);
  const [controls, setControls] = useState<Controls | null>(null);

  const [origin, setOrigin] = useState<Endpoint | null>({ kind: 'me' });
  const [destination, setDestination] = useState<Endpoint | null>(null);
  const [me, setMe] = useState<LonLat | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  const [raw, setRaw] = useState<RawRoute[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState<'idle' | 'first' | 'more'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<{ p: LonLat; x: number; y: number; label: string } | null>(null);

  // Basemap + controls for the chosen area.
  useEffect(() => {
    setPmtiles(undefined);
    pmtilesUrl(area).then(setPmtiles);
    loadControls(area).then(setControls);
  }, [area]);
  const [dataPending, setDataPending] = useState(false);
  useEffect(() => {
    loadManifest().then((m) => setDataPending(!m && !import.meta.env.VITE_PMTILES_URL));
  }, []);

  // Resolve "My location" only when it's needed for a route.
  const needsMe = origin?.kind === 'me' || destination?.kind === 'me';
  useEffect(() => {
    if (!needsMe || !destination || !origin) return;
    let live = true;
    setMeError(null);
    getPosition()
      .then((p) => live && setMe(p))
      .catch((e: Error) => live && setMeError(e.message));
    return () => {
      live = false;
    };
  }, [needsMe, !!destination, !!origin]);

  const point = (e: Endpoint | null): LonLat | null => (!e ? null : e.kind === 'me' ? me : e.place.lonLat);
  const from = point(origin), to = point(destination);
  const points = from && to ? [from, to] : null;
  const outside = points?.some((p) => !inBbox(p, bbox)) ?? false;
  const key = points && !outside ? routingKey(points, s) : null;

  // Fetch routes when endpoints or routing preferences change (debounced for sliders).
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    abort.current?.abort();
    setError(null);
    if (!key || !points) {
      setRaw([]);
      setLoading('idle');
      return;
    }
    const ac = new AbortController();
    abort.current = ac;
    const t = setTimeout(() => {
      setLoading('first');
      fetchRoutes(
        points,
        s,
        (routes, done) => {
          setRaw(routes);
          setLoading(done ? 'idle' : 'more');
        },
        ac.signal,
      ).catch((e: Error) => {
        if (ac.signal.aborted) return;
        setRaw([]);
        setLoading('idle');
        setError(e.message);
      });
    }, 250);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [key]);

  // ETA-only settings (speed, temperature, …) re-evaluate instantly without refetching.
  const options = useMemo(() => evaluate(raw, s, controls), [raw, s, controls]);
  useEffect(() => setSelected(null), [key]);

  const tripKey = points ? JSON.stringify(points) : '';
  const hint = outside
    ? 'That point is outside your map area. Change the area in Settings to route there.'
    : meError ?? (!destination ? null : needsMe && !me ? 'Finding your location…' : null);

  const setPinEndpoint = (which: 'from' | 'to') => {
    if (!pin) return;
    const place: Place = { label: pin.label, detail: '', lonLat: pin.p };
    (which === 'from' ? setOrigin : setDestination)({ kind: 'place', place });
    setPin(null);
  };

  return (
    <div class="app">
      {pmtiles !== undefined && (
        <MapView
          pmtiles={pmtiles}
          bbox={bbox}
          origin={from}
          destination={to}
          userLocation={me}
          options={options}
          selected={selected}
          fitKey={tripKey}
          onSelect={setSelected}
          onLongPress={(p, pt) => {
            setPin({ p, x: pt.x, y: pt.y, label: 'Dropped pin' });
            reverseLabel(p).then((label) => label && setPin((cur) => (cur && cur.p === p ? { ...cur, label } : cur)));
          }}
        />
      )}

      <div class="panel">
        <SearchPanel
          origin={origin}
          destination={destination}
          bbox={bbox}
          near={me}
          onOrigin={setOrigin}
          onDestination={setDestination}
          onSwap={() => {
            setOrigin(destination);
            setDestination(origin);
          }}
        />
        {dataPending && <div class="banner card">Map data is still downloading on the server. Routing works; the basemap appears when it’s ready.</div>}
        <RouteSheet options={options} selected={selected} loading={loading} error={error} units={s.units} hint={hint} onSelect={setSelected} />
      </div>

      <div class="fabs">
        <button class="fab" aria-label="Settings" onClick={() => setShowSettings(true)}>
          <GearIcon />
        </button>
        <button
          class="fab"
          aria-label="Use my location as the start"
          onClick={() => {
            setOrigin({ kind: 'me' });
            getPosition().then(setMe, (e: Error) => setMeError(e.message));
          }}
        >
          <LocateIcon />
        </button>
      </div>

      {pin && <PinMenu x={pin.x} y={pin.y} label={pin.label} onFrom={() => setPinEndpoint('from')} onTo={() => setPinEndpoint('to')} onClose={() => setPin(null)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} onChangeArea={() => setPickingArea(true)} />}
      {pickingArea && (
        <AreaPicker
          current={s.area}
          onPick={(a) => {
            updateSettings({ area: a });
            setPickingArea(false);
          }}
          onCancel={s.area ? () => setPickingArea(false) : undefined}
        />
      )}
    </div>
  );
}
