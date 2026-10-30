import { useEffect, useState } from 'preact/hooks';
import { loadDataStatus, type DataStatus } from '../data/manifest';
import { fmtMB } from '../data/offline';

/**
 * Shown while the server is still building its map data (first deploy only). Polls the
 * build status and calls onReady when the data is in place.
 */
export function DataBanner({ onReady }: { onReady: () => void }) {
  const [st, setSt] = useState<DataStatus | null>(null);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const s = await loadDataStatus();
      if (!live) return;
      setSt(s);
      if (s?.state === 'done') onReady();
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const pct = st?.total ? Math.min(100, Math.round(((st.bytes ?? 0) / st.total) * 100)) : null;
  return (
    <div class="banner card" role="status">
      <strong>Setting up map data on your server</strong>
      <div class="muted small">One-time, on first deploy (about 10–20 min). After that it refreshes weekly in the background. Routing already works.</div>
      {st && st.state === 'running' && (
        <>
          <div class="small">
            Step {st.step} of {st.steps}: {st.label}
            {pct !== null && ` · ${pct}% (${fmtMB(st.bytes ?? 0)} of ${fmtMB(st.total ?? 0)})`}
          </div>
          <div class="progress" aria-hidden="true">
            <span style={{ width: `${pct ?? ((st.step - 1) / st.steps) * 100}%` }} />
          </div>
        </>
      )}
      {st?.state === 'failed' && <div class="error small">The data build failed at: {st.label}. It retries every hour; check the `data` container's logs.</div>}
    </div>
  );
}
