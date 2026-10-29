import { describe, expect, it } from 'vitest';
// The builder's encoder (data/) and the client's decoder must agree.
import { encodeControls } from '../../../data/controls-format.mjs';
import { controlsOnRoute, ControlType, decodeControls, isCovered } from '../src/controls/controls';
import type { LonLat } from '../src/geo/geo';

const bbox = [-87.7, 41.8, -87.6, 41.9];

function build(controls: { lon: number; lat: number; type: number }[], coveredCells: number[]) {
  const covered = new Uint8Array(10 * 8);
  for (const c of coveredCells) covered[c] = 1;
  const bytes = encodeControls({ version: 20261029, bbox, covered, controls });
  return decodeControls(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

describe('controls file', () => {
  it('round-trips header, coverage and nodes', () => {
    const c = build([{ lon: -87.65, lat: 41.85, type: ControlType.signal }], [0]);
    expect(c.version).toBe(20261029);
    expect(c.nx).toBe(8); // 0.1 / 0.0135 → 8 cells
    expect(c.ny).toBe(10);
    expect(c.count).toBe(1);
    expect(isCovered(c, -87.699, 41.801)).toBe(true);
    expect(isCovered(c, -87.65, 41.85)).toBe(false);
  });

  it('counts only controls on route vertices and merges nearby nodes of one intersection', () => {
    const c = build(
      [
        { lon: -87.65, lat: 41.85, type: ControlType.signal },
        { lon: -87.65, lat: 41.85015, type: ControlType.signal }, // ~17 m on: same intersection
        { lon: -87.65, lat: 41.86, type: ControlType.stop },
        { lon: -87.6499, lat: 41.87, type: ControlType.stop }, // ~8 m off the route: not counted
      ],
      [],
    );
    const route: LonLat[] = [
      [-87.65, 41.84],
      [-87.65, 41.85],
      [-87.65, 41.85015],
      [-87.65, 41.86],
      [-87.65, 41.87],
    ];
    expect(controlsOnRoute(c, route).map((x) => x.type)).toEqual([ControlType.signal, ControlType.stop]);
  });
});
