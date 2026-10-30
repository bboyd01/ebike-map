import { useEffect, useRef, useState } from 'preact/hooks';
import type { LonLat } from '../geo/geo';
import { recentPlaces, rememberPlace, searchPlaces, type Place } from '../geocode/photon';
import { CloseIcon, SwapIcon } from './icons';

/** An endpoint: a chosen place, or the rider's current location. */
export type Endpoint = { kind: 'place'; place: Place } | { kind: 'me' };

export const endpointLabel = (e: Endpoint | null) => (!e ? '' : e.kind === 'me' ? 'My location' : e.place.label);

interface FieldProps {
  id: string;
  label: string;
  placeholder: string;
  value: Endpoint | null;
  allowMe: boolean;
  bbox: number[];
  near: LonLat | null;
  onChange: (e: Endpoint | null) => void;
}

function PlaceField({ id, label, placeholder, value, allowMe, bbox, near, onChange }: FieldProps) {
  const [text, setText] = useState(endpointLabel(value));
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => setText(endpointLabel(value)), [value]);

  useEffect(() => {
    if (!open) return;
    const q = text.trim();
    if (q.length < 3 || q === endpointLabel(value)) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      setStatus('loading');
      searchPlaces(q, bbox, near, ac.signal)
        .then((r) => {
          setResults(r);
          setStatus('idle');
        })
        .catch(() => !ac.signal.aborted && setStatus('error'));
    }, 250);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [text, open]);

  const choose = (e: Endpoint) => {
    if (e.kind === 'place') rememberPlace(e.place);
    onChange(e);
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const typing = text.trim().length >= 3 && text !== endpointLabel(value);
  const recents = typing ? [] : recentPlaces().slice(0, 5);

  return (
    <div class="field">
      <label for={id} class="field-label">
        {label}
      </label>
      <div class="field-input">
        <input
          id={id}
          type="search"
          autocomplete="off"
          enterkeyhint="search"
          placeholder={placeholder}
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          onFocus={(e) => {
            clearTimeout(blurTimer.current);
            setOpen(true);
            e.currentTarget.select();
          }}
          onBlur={() => (blurTimer.current = setTimeout(() => setOpen(false), 150))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) choose({ kind: 'place', place: results[0] });
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        {text && (
          <button
            class="icon-btn small"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              setText('');
              onChange(null);
            }}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      {open && (
        <ul class="suggestions" role="listbox">
          {allowMe && !typing && (
            <li>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => choose({ kind: 'me' })}>
                <strong>My location</strong>
              </button>
            </li>
          )}
          {(typing ? results : recents).map((p) => (
            <li key={`${p.label}|${p.detail}`}>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => choose({ kind: 'place', place: p })}>
                <strong>{p.label}</strong>
                {p.detail && <span class="muted">{p.detail}</span>}
              </button>
            </li>
          ))}
          {typing && status === 'loading' && results.length === 0 && <li class="muted pad">Searching…</li>}
          {typing && status === 'idle' && results.length === 0 && <li class="muted pad">No matches in this area.</li>}
          {status === 'error' && <li class="muted pad">Search is unavailable right now.</li>}
        </ul>
      )}
    </div>
  );
}

interface SearchPanelProps {
  origin: Endpoint | null;
  destination: Endpoint | null;
  bbox: number[];
  near: LonLat | null;
  onOrigin: (e: Endpoint | null) => void;
  onDestination: (e: Endpoint | null) => void;
  onSwap: () => void;
}

export function SearchPanel(p: SearchPanelProps) {
  return (
    <div class="search card">
      <div class="search-fields">
        <PlaceField id="from" label="From" placeholder="Start" value={p.origin} allowMe bbox={p.bbox} near={p.near} onChange={p.onOrigin} />
        <PlaceField id="to" label="To" placeholder="Where to?" value={p.destination} allowMe bbox={p.bbox} near={p.near} onChange={p.onDestination} />
      </div>
      <button class="icon-btn swap" aria-label="Swap start and destination" onClick={p.onSwap}>
        <SwapIcon />
      </button>
    </div>
  );
}
