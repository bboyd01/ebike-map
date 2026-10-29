import type { InfraClass } from '../settings/settings';

export type Tags = Record<string, string>;

/** Parses BRouter's "k=v k2=v2" tag strings (WayTags / NodeTags columns). */
export function parseTagString(s: string | undefined): Tags {
  const tags: Tags = {};
  if (!s) return tags;
  for (const kv of s.split(' ')) {
    const eq = kv.indexOf('=');
    if (eq > 0) tags[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  return tags;
}

const is = (v: string | undefined, ...vals: string[]) => v !== undefined && vals.includes(v);
const anySide = (t: Tags, ...vals: string[]) =>
  is(t.cycleway, ...vals) || is(t['cycleway:left'], ...vals) || is(t['cycleway:right'], ...vals) || is(t['cycleway:both'], ...vals);

/** Assigns exactly one infrastructure class; mirrors `class_cf` in routing/ebike.brf (SPEC §5.1). */
export function classify(t: Tags): InfraClass {
  const hw = t.highway;
  const bikeYes = is(t.bicycle, 'yes', 'permissive', 'designated');
  // A one-way cycleway is a separated lane beside a street; trails are two-way.
  if (hw === 'cycleway' && is(t.oneway, 'yes', 'true', '1', '-1')) return 'protected';
  if (hw === 'cycleway' || (is(hw, 'path', 'footway', 'bridleway') && t.bicycle === 'designated')) return 'trail';
  if (is(hw, 'steps') || t.bicycle === 'dismount' || (is(hw, 'footway', 'pedestrian', 'path') && !bikeYes)) return 'other';
  if (anySide(t, 'track', 'separate')) return 'protected';
  if (anySide(t, 'lane', 'opposite_lane')) return 'lane';
  if (anySide(t, 'shared_lane', 'shared')) return 'shared';
  const quietHw = is(hw, 'residential', 'living_street', 'unclassified', 'service');
  if (quietHw && (t.route_bicycle_lcn === 'yes' || t.route_bicycle_rcn === 'yes' || t.bicycle_road === 'yes')) return 'greenway';
  if (quietHw) return is(t.service, 'alley', 'parking_aisle', 'driveway', 'drive-through') ? 'other' : 'quiet';
  if (is(hw, 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link')) return 'arterial';
  return 'other';
}

export function isDismount(t: Tags): boolean {
  const bikeYes = is(t.bicycle, 'yes', 'permissive', 'designated');
  return is(t.highway, 'steps') || t.bicycle === 'dismount' || (is(t.highway, 'footway', 'pedestrian', 'path') && !bikeYes && t.bicycle !== 'designated');
}

export type SurfaceKind = 'paved' | 'unpaved' | 'rough';

export function surfaceKind(t: Tags): SurfaceKind {
  if (is(t.surface, 'unpaved', 'gravel', 'fine_gravel', 'compacted', 'dirt', 'earth', 'ground', 'grass', 'sand', 'mud', 'pebblestone', 'woodchips'))
    return 'unpaved';
  if (is(t.surface, 'cobblestone', 'sett', 'unhewn_cobblestone') || is(t.smoothness, 'bad', 'very_bad', 'horrible', 'very_horrible', 'impassable'))
    return 'rough';
  return 'paved';
}
