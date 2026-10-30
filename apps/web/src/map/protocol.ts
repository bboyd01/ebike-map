import * as maplibregl from 'maplibre-gl';
// MapLibre v6 resolves its worker next to its own module file, which doesn't survive
// bundling; ship the (self-contained) worker as an asset and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { PMTiles, Protocol, type RangeResponse, type Source } from 'pmtiles';

/** One pmtiles:// protocol for the app, so offline archives can be registered on it. */
export const protocol = new Protocol();

let added = false;
export function ensureProtocol() {
  if (added) return;
  maplibregl.setWorkerUrl(workerUrl);
  maplibregl.addProtocol('pmtiles', protocol.tile);
  added = true;
}

/** Serves a PMTiles archive from a Blob (the offline copy) under its original URL. */
class BlobSource implements Source {
  constructor(
    private readonly key: string,
    private readonly blob: Blob,
  ) {}
  getKey() {
    return this.key;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: await this.blob.slice(offset, offset + length).arrayBuffer() };
  }
}

/** Make pmtiles://<url> read from `blob` instead of the network. */
export function registerOfflineArchive(url: string, blob: Blob) {
  protocol.add(new PMTiles(new BlobSource(url, blob)));
}
