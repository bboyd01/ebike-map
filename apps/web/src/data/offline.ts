// Offline basemap: the whole area's PMTiles archive saved in Cache Storage (SPEC §16).
const CACHE = 'offline-map-v1';

export interface OfflineInfo {
  bytes: number;
  savedAt: number;
}

async function cache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE);
  } catch {
    return null; // e.g. private mode
  }
}

export async function offlineInfo(url: string): Promise<OfflineInfo | null> {
  const c = await cache();
  const res = await c?.match(url);
  if (!res) return null;
  return { bytes: Number(res.headers.get('content-length') ?? 0), savedAt: Number(res.headers.get('x-saved-at') ?? 0) };
}

export async function offlineBlob(url: string): Promise<Blob | null> {
  const c = await cache();
  const res = await c?.match(url);
  return res ? res.blob() : null;
}

/** Downloads the archive with progress, then stores it. Replaces any older copy for this area. */
export async function downloadOffline(url: string, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<void> {
  const c = await cache();
  if (!c) throw new Error('Offline storage isn’t available in this browser.');
  // Ask the browser not to evict it under storage pressure (best effort).
  await navigator.storage?.persist?.().catch(() => false);
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    chunks.push(value);
    done += value.byteLength;
    onProgress(done, total);
  }
  const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
  // Drop copies of older versions (e.g. city.v20261026.pmtiles) before saving.
  for (const req of await c.keys()) if (sameArea(req.url, url)) await c.delete(req);
  await c.put(url, new Response(blob, { headers: { 'content-length': String(blob.size), 'x-saved-at': String(Date.now()) } }));
}

export async function removeOffline(url: string): Promise<void> {
  const c = await cache();
  if (!c) return;
  for (const req of await c.keys()) if (sameArea(req.url, url)) await c.delete(req);
}

/** city.v20261026.pmtiles and city.v20261102.pmtiles are the same area. */
function sameArea(a: string, b: string): boolean {
  const area = (u: string) => new URL(u, location.href).pathname.split('/').pop()?.split('.')[0];
  return area(a) === area(b);
}

export const fmtMB = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
