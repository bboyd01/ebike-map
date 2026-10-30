import { effect, signal } from '@preact/signals';
import { DEFAULT_SETTINGS, normalizeRanking, SETTINGS_SCHEMA, type Settings } from '../settings/settings';

const KEY = 'ebike-map:settings:v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const stored = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...stored } as Settings;
    // Schema 2 (speed-based routing, SPEC §19): the ranking became a tie-breaker and the
    // light wait was recalibrated, so earlier values for those two no longer fit.
    if ((stored.schema ?? 1) < 2) {
      merged.pickiness = DEFAULT_SETTINGS.pickiness;
      merged.tSignalS = DEFAULT_SETTINGS.tSignalS;
    }
    // Schema 3: protected-lane default 14 -> 17 mph (keep a value the rider changed).
    if ((stored.schema ?? 1) < 3 && (stored.protectedMph === undefined || stored.protectedMph === 14)) {
      merged.protectedMph = DEFAULT_SETTINGS.protectedMph;
    }
    // Schema 4: painted/shared-lane default 16 -> 19 mph (keep a value the rider changed).
    if ((stored.schema ?? 1) < 4 && (stored.laneMph === undefined || stored.laneMph === 16)) {
      merged.laneMph = DEFAULT_SETTINGS.laneMph;
    }
    // Schema 5: side-street default 14 -> 16 mph (keep a value the rider changed).
    if ((stored.schema ?? 1) < 5 && (stored.sideStreetMph === undefined || stored.sideStreetMph === 14)) {
      merged.sideStreetMph = DEFAULT_SETTINGS.sideStreetMph;
    }
    merged.schema = SETTINGS_SCHEMA;
    return { ...merged, ranking: normalizeRanking(merged.ranking) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** App-wide settings, persisted to localStorage (SPEC §9). */
export const settings = signal<Settings>(load());

effect(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings.value));
  } catch {
    /* private mode / storage blocked: settings just won't persist */
  }
});

export function updateSettings(patch: Partial<Settings>) {
  const next = { ...settings.value, ...patch };
  if (patch.ranking) next.ranking = normalizeRanking(patch.ranking);
  settings.value = next;
}

export function resetSettings() {
  settings.value = { ...DEFAULT_SETTINGS, area: settings.value.area };
}
