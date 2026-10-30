import { layers, namedFlavor } from '@protomaps/basemaps';
import type { Feature, FeatureCollection } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre v6 resolves its worker next to its own module file, which doesn't survive
// bundling; ship the (self-contained) worker as an asset and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';
import { useEffect, useRef } from 'preact/hooks';
import { classify } from '../routing/classify';
import type { RouteOption } from '../routing/client';
import type { LonLat } from '../geo/geo';
import type { InfraClass } from '../settings/settings';
import { CLASS_COLORS, prefersDark } from './palette';

let protocolAdded = false;
function ensureProtocol() {
  if (protocolAdded) return;
  maplibregl.setWorkerUrl(workerUrl);
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  protocolAdded = true;
}

const ASSETS = 'https://protomaps.github.io/basemaps-assets';

function baseStyle(pmtiles: string | null, dark: boolean): StyleSpecification {
  const flavor = dark ? 'dark' : 'light';
  if (!pmtiles) {
    return {
      version: 8,
      sources: {},
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': dark ? '#1b1f1d' : '#eef1ef' } }],
    };
  }
  return {
    version: 8,
    glyphs: `${ASSETS}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${ASSETS}/sprites/v4/${flavor}`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${pmtiles}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: layers('protomaps', namedFlavor(flavor), { lang: 'en' }),
  };
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Consecutive edges of the same class merged into one colored line each. */
function classRuns(opt: RouteOption, colors: Record<InfraClass, string>): FeatureCollection {
  const { coords, edges } = opt.route;
  const features: Feature[] = [];
  let cur: { cls: InfraClass; line: LonLat[] } | null = null;
  for (const e of edges) {
    const cls = classify(e.wayTags);
    if (!cur || cur.cls !== cls) {
      if (cur) features.push(runFeature(cur, colors));
      cur = { cls, line: [coords[e.from]!] };
    }
    cur.line.push(coords[e.to]!);
  }
  if (cur) features.push(runFeature(cur, colors));
  return { type: 'FeatureCollection', features };
}

function runFeature(run: { cls: InfraClass; line: LonLat[] }, colors: Record<InfraClass, string>): Feature {
  return {
    type: 'Feature',
    properties: { cls: run.cls, color: colors[run.cls] },
    geometry: { type: 'LineString', coordinates: run.line },
  };
}

function altLines(options: RouteOption[], selected: number | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: options
      .filter((o) => o.idx !== selected)
      .map((o) => ({ type: 'Feature', properties: { idx: o.idx }, geometry: { type: 'LineString', coordinates: o.route.coords } })),
  };
}

function addRouteLayers(map: maplibregl.Map, dark: boolean) {
  map.addSource('alts', { type: 'geojson', data: EMPTY });
  map.addSource('selected', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'alts-line',
    type: 'line',
    source: 'alts',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': dark ? '#6b7570' : '#9aa5a0', 'line-width': 6, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'selected-casing',
    type: 'line',
    source: 'selected',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': dark ? '#0d100f' : '#ffffff', 'line-width': 10 },
  });
  map.addLayer({
    id: 'selected-line',
    type: 'line',
    source: 'selected',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 6 },
  });
}

function markerEl(kind: 'origin' | 'destination'): HTMLElement {
  const el = document.createElement('div');
  el.className = `marker marker-${kind}`;
  el.setAttribute('aria-label', kind === 'origin' ? 'Start' : 'Destination');
  return el;
}

export interface MapViewProps {
  pmtiles: string | null;
  bbox: [number, number, number, number];
  origin: LonLat | null;
  destination: LonLat | null;
  userLocation: LonLat | null;
  options: RouteOption[];
  selected: number | null;
  fitKey: string; // changes when a new trip should be framed
  onLongPress: (p: LonLat, screen: { x: number; y: number }) => void;
  onSelect: (idx: number) => void;
}

export function MapView(props: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<{ origin?: maplibregl.Marker; destination?: maplibregl.Marker; me?: maplibregl.Marker }>({});
  const latest = useRef(props);
  latest.current = props;
  const dark = useRef(prefersDark());

  // Create the map once per basemap URL.
  useEffect(() => {
    ensureProtocol();
    const [w, s, e, n] = props.bbox;
    const padX = (e - w) * 0.15, padY = (n - s) * 0.15;
    const map = new maplibregl.Map({
      container: container.current!,
      style: baseStyle(props.pmtiles, dark.current),
      bounds: [w, s, e, n],
      maxBounds: [w - padX, s - padY, e + padX, n + padY],
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    map.on('load', () => {
      addRouteLayers(map, dark.current);
      syncRoutes(map, latest.current, dark.current);
    });
    map.on('click', 'alts-line', (ev) => {
      const idx = ev.features?.[0]?.properties?.idx;
      if (typeof idx === 'number') latest.current.onSelect(idx);
    });
    map.on('mouseenter', 'alts-line', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'alts-line', () => (map.getCanvas().style.cursor = ''));

    // Long-press: right-click on desktop, press-and-hold on touch screens.
    map.on('contextmenu', (ev) => latest.current.onLongPress([ev.lngLat.lng, ev.lngLat.lat], ev.point));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null;
    const cancel = () => {
      clearTimeout(timer);
      start = null;
    };
    map.on('touchstart', (ev) => {
      if (ev.originalEvent.touches.length !== 1) return cancel();
      start = ev.point;
      const lngLat = ev.lngLat;
      timer = setTimeout(() => {
        if (start) latest.current.onLongPress([lngLat.lng, lngLat.lat], start);
        start = null;
      }, 550);
    });
    map.on('touchmove', (ev) => {
      if (start && Math.hypot(ev.point.x - start.x, ev.point.y - start.y) > 12) cancel();
    });
    map.on('touchend', cancel);
    map.on('touchcancel', cancel);
    map.on('movestart', (ev) => {
      if ((ev as { originalEvent?: Event }).originalEvent?.type === 'touchmove') cancel();
    });

    return () => {
      cancel();
      map.remove();
      mapRef.current = null;
      markers.current = {};
    };
  }, [props.pmtiles]);

  // Route lines.
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getSource('selected')) syncRoutes(map, props, dark.current);
  }, [props.options, props.selected]);

  // Frame a new trip once its first route arrives.
  useEffect(() => {
    const map = mapRef.current;
    const first = props.options[0];
    if (!map || !first) return;
    const b = new maplibregl.LngLatBounds();
    for (const o of props.options) for (const c of o.route.coords) b.extend(c);
    map.fitBounds(b, { padding: framePadding(), duration: 600, maxZoom: 16 });
  }, [props.fitKey, props.options.length > 0]);

  // Markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const place = (key: 'origin' | 'destination' | 'me', p: LonLat | null, make: () => HTMLElement) => {
      const m = markers.current[key];
      if (!p) {
        m?.remove();
        delete markers.current[key];
      } else if (m) m.setLngLat(p);
      else markers.current[key] = new maplibregl.Marker({ element: make() }).setLngLat(p).addTo(map);
    };
    place('origin', props.origin, () => markerEl('origin'));
    place('destination', props.destination, () => markerEl('destination'));
    place('me', props.userLocation, () => {
      const el = document.createElement('div');
      el.className = 'marker marker-me';
      el.setAttribute('aria-label', 'Your location');
      return el;
    });
  }, [props.origin, props.destination, props.userLocation, props.pmtiles]);

  return <div ref={container} class="map" />;
}

function syncRoutes(map: maplibregl.Map, p: MapViewProps, dark: boolean) {
  const colors = CLASS_COLORS[dark ? 'dark' : 'light'];
  const sel = p.options.find((o) => o.idx === p.selected) ?? p.options[0];
  (map.getSource('alts') as GeoJSONSource).setData(altLines(p.options, sel?.idx ?? null));
  (map.getSource('selected') as GeoJSONSource).setData(sel ? classRuns(sel, colors) : EMPTY);
}

/** Keeps the route clear of the search card (top) and route sheet (bottom). */
function framePadding() {
  const wide = window.innerWidth >= 900;
  return wide ? { top: 40, bottom: 40, left: 420, right: 40 } : { top: 150, bottom: Math.round(window.innerHeight * 0.42), left: 24, right: 24 };
}
