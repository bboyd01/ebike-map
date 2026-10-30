import { AREA_LABEL } from '../data/manifest';
import type { AreaId } from '../settings/settings';

/** First-launch choice of map area (SPEC FR-0); also reachable from Settings. */
export function AreaPicker({ current, onPick, onCancel }: { current: AreaId | null; onPick: (a: AreaId) => void; onCancel?: () => void }) {
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="area-title">
      <div class="dialog card">
        <h1 id="area-title">Choose your map</h1>
        <p class="muted">You can change this later in Settings.</p>
        <div class="area-options">
          {(['city', 'metro'] as AreaId[]).map((a) => (
            <button key={a} class={`area-option${current === a ? ' selected' : ''}`} onClick={() => onPick(a)}>
              <strong>{AREA_LABEL[a].name}</strong>
              <span class="muted">{AREA_LABEL[a].detail}</span>
              <span class="muted small">Map download {AREA_LABEL[a].size} (only the parts you view)</span>
            </button>
          ))}
        </div>
        {onCancel && (
          <button class="btn secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
