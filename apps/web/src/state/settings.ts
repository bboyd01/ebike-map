import { effect, signal } from '@preact/signals';
import { DEFAULT_SETTINGS, normalizeRanking, type Settings } from '../settings/settings';

const KEY = 'ebike-map:settings:v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings;
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
