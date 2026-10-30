import type { InfraClass } from '../settings/settings';

/** Route-line colors by infrastructure class, for light and dark basemaps. */
export const CLASS_COLORS: Record<'light' | 'dark', Record<InfraClass, string>> = {
  light: {
    protected: '#0b7a4b',
    trail: '#2e7d32',
    lane: '#1565c0',
    shared: '#6a4fb3',
    greenway: '#00838f',
    quiet: '#5c6f7b',
    arterial: '#c62828',
    other: '#8d6e63',
  },
  dark: {
    protected: '#3ccf8e',
    trail: '#7bd88f',
    lane: '#64a8ff',
    shared: '#b39ddb',
    greenway: '#4dd0e1',
    quiet: '#a7b6bf',
    arterial: '#ff6b6b',
    other: '#c8a597',
  },
};

export const CLASS_LABEL: Record<InfraClass, string> = {
  protected: 'Protected lane',
  trail: 'Off-street trail',
  lane: 'Painted lane',
  shared: 'Shared lane',
  greenway: 'Greenway',
  quiet: 'Quiet street',
  arterial: 'Busy road',
  other: 'Other',
};

export const prefersDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
