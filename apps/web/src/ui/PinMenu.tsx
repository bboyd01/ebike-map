/** Menu shown after a long-press on the map. */
export function PinMenu({ x, y, label, onFrom, onTo, onClose }: { x: number; y: number; label: string; onFrom: () => void; onTo: () => void; onClose: () => void }) {
  const left = Math.min(Math.max(x - 110, 12), window.innerWidth - 232);
  const top = Math.min(y + 12, window.innerHeight - 170);
  return (
    <>
      <div class="pin-backdrop" onClick={onClose} />
      <div class="pin-menu card" style={{ left, top }} role="menu" aria-label="Dropped pin">
        <div class="muted small pin-label">{label}</div>
        <button role="menuitem" class="btn" onClick={onTo}>
          Route here
        </button>
        <button role="menuitem" class="btn secondary" onClick={onFrom}>
          Start here
        </button>
      </div>
    </>
  );
}
