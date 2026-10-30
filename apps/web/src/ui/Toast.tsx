import type { ComponentChildren } from 'preact';
import { CloseIcon } from './icons';

/** A dismissible message card (location notices, routing errors, data setup). */
export function Toast({ kind = 'info', onClose, children }: { kind?: 'info' | 'error'; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class={`toast card${kind === 'error' ? ' toast-error' : ''}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div class="toast-body">{children}</div>
      <button class="icon-btn small" aria-label="Dismiss" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}
