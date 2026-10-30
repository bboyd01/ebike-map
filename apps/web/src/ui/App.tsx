import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Controls } from '../controls/controls';
import { AREA_BBOX, loadControls, loadManifest, pmtilesUrl, resetDataCache } from '../data/manifest';
import { offlineBlob } from '../data/offline';
import { protocol, registerOfflineArchive } from '../map/protocol';
import { DataBanner } from './DataBanner';
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
  const [focus, setFocus] = useState<{ p: LonLat; key: number } | null>(null);

  /** Ask for the rider's location; center the map on it if it's inside the area. */
  const locate = (center: boolean) =>
    getPosition().then(
      (p) => {
        setMe(p);
        setMeError(null);
        if (center && inBbox(p, AREA_BBOX[settings.value.area ?? 'city'])) setFocus({ p, key: Date.now() });
      },
      (e: Error) => setMeError(e.message),
    );

  // Ask for location as soon as the app opens (after the first-launch area choice).
  useEffect(() => {
    if (s.area) locate(true);
  }, [s.area]);

  const [raw, setRaw] = useState<RawRoute[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState<'idle' | 'first' | 'more'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<{ p: LonLat; x: number; y: number; label: string } | null>(null);

  // Basemap + controls for the chosen area. A saved offline copy is used if present.
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setPmtiles(undefined);
    pmtilesUrl(area).then(async (url) => {
      const blob = url ? await offlineBlob(url) : null;
      if (url && blob) registerOfflineArchive(url, blob);
      else if (url) protocol.tiles.delete(url); // offline copy removed: back to the network
      if (live) setPmtiles(url);
    });
    loadControls(area).then((c) => live && setControls(c));
    return () => {
      live = false;
    };
  }, [area, dataVersion]);
  const [dataPending, setDataPending] = useState(false);
  useEffect(() => {
    loadManifest().then((m) => setDataPending(!m && !import.meta.env.VITE_PMTILES_URL));
  }, [dataVersion]);
  const onDataReady = () => {
    resetDataCache();
    setDataVersion((v) => v + 1);
  };

  // If a route needs "My location" and we don't have it yet (e.g. permission was
  // dismissed earlier), ask again.
  const needsMe = origin?.kind === 'me' || destination?.kind === 'me';
  useEffect(() => {
    if (needsMe && destination && origin && !me) locate(false);
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
          focus={focus}
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
        {dataPending && <DataBanner onReady={onDataReady} />}
        <div class="fabs">
          <button class="fab" aria-label="Settings" onClick={() => setShowSettings(true)}>
            <GearIcon />
          </button>
          <button
            class="fab"
            aria-label="Use my location as the start"
            onClick={() => {
              setOrigin({ kind: 'me' });
              locate(true);
            }}
          >
            <LocateIcon />
          </button>
        </div>
        <RouteSheet options={options} selected={selected} loading={loading} error={error} units={s.units} hint={hint} onSelect={setSelected} />
      </div>



      {pin && <PinMenu x={pin.x} y={pin.y} label={pin.label} onFrom={() => setPinEndpoint('from')} onTo={() => setPinEndpoint('to')} onClose={() => setPin(null)} />}
      {showSettings && (
        <SettingsPanel
          mapUrl={pmtiles ?? null}
          onClose={() => setShowSettings(false)}
          onChangeArea={() => setPickingArea(true)}
          onOfflineChange={() => setDataVersion((v) => v + 1)}
        />
      )}
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
