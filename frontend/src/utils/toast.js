/**
 * Toast notifications rendered into a single live region (bottom-right).
 *
 *   toast.success('Saved');
 *   toast.error(msg, { id: 'session-expired' });   // same id replaces the open toast
 *   toast.warning(msg, { duration: 8000 });
 *
 * Errors use role="alert"; success, info and warning use role="status".
 * Hover or focus pauses the auto-dismiss timer.
 */

const TOAST_CONTAINER_ID = 'toast-notifications';
const TOAST_DURATION_MS = 5000;
const EXIT_ANIMATION_MS = 300;

const BG_COLORS = {
  error: '#c0392b',
  success: '#2d6a4f',
  warning: '#f5a623',
  info: '#333',
};

const openToasts = new Map(); // id -> dismiss()

function getOrCreateContainer() {
  let container = document.getElementById(TOAST_CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = TOAST_CONTAINER_ID;
    container.setAttribute('aria-live', 'polite');
    container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }
  return container;
}

function show(type, message, { id, duration = TOAST_DURATION_MS } = {}) {
  if (id != null) openToasts.get(id)?.(true);

  const container = getOrCreateContainer();
  const toastEl = document.createElement('div');
  toastEl.style.cssText = `
    background: ${BG_COLORS[type]};
    color: #fff;
    padding: 12px 18px;
    border-radius: 8px;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    max-width: 360px;
    word-wrap: break-word;
    pointer-events: auto;
    animation: slideIn 0.3s ease-out;
  `;
  toastEl.textContent = message;
  toastEl.tabIndex = 0;
  toastEl.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toastEl.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  container.appendChild(toastEl);

  let remaining = duration;
  let startedAt = 0;
  let timerId = null;
  let hovered = false;
  let focused = false;
  let dismissed = false;

  const dismiss = (instant = false) => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timerId);
    if (id != null && openToasts.get(id) === dismiss) openToasts.delete(id);
    if (instant) {
      toastEl.remove();
      return;
    }
    toastEl.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => {
      toastEl.remove();
      if (container.children.length === 0) container.remove();
    }, EXIT_ANIMATION_MS);
  };

  const sync = () => {
    if (dismissed) return;
    if (hovered || focused) {
      if (timerId == null) return;
      clearTimeout(timerId);
      timerId = null;
      remaining -= Date.now() - startedAt;
    } else if (timerId == null) {
      startedAt = Date.now();
      timerId = setTimeout(() => dismiss(), Math.max(remaining, 0));
    }
  };

  toastEl.addEventListener('mouseenter', () => { hovered = true; sync(); });
  toastEl.addEventListener('mouseleave', () => { hovered = false; sync(); });
  toastEl.addEventListener('focusin', () => { focused = true; sync(); });
  toastEl.addEventListener('focusout', () => { focused = false; sync(); });

  if (id != null) openToasts.set(id, dismiss);
  sync();
  return () => dismiss();
}

export const toast = {
  success: (message, opts) => show('success', message, opts),
  error: (message, opts) => show('error', message, opts),
  info: (message, opts) => show('info', message, opts),
  warning: (message, opts) => show('warning', message, opts),
};

// Add animation styles if not already present
if (typeof document !== 'undefined' && !document.getElementById('toast-animations')) {
  const style = document.createElement('style');
  style.id = 'toast-animations';
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}
