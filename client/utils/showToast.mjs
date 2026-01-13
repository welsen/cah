const __recentToasts = new Map(); // message -> timestamp
export function showToast(message, opts = {}) {
  const { type = 'error', actionLabel, action } = opts;
  const now = Date.now();
  // dedupe: don't show identical messages within 4 seconds
  const last = __recentToasts.get(message);
  if (last && now - last < 4000) {
    console.debug('[toast] suppressed duplicate message:', message);
    return;
  }
  __recentToasts.set(message, now);
  setTimeout(() => {
    __recentToasts.delete(message);
  }, 4500);

  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  // limit concurrent toasts to 3; remove oldest if needed
  const existing = Array.from(container.querySelectorAll('.toast'));
  if (existing.length >= 3) {
    existing[0].remove();
  }

  const toast = document.createElement('div');
  toast.className = 'toast toast--' + type;
  toast.textContent = message;
  if (actionLabel && typeof action === 'function') {
    const action = document.createElement('button');
    action.className = 'toast-action';
    action.textContent = actionLabel;
    action.addEventListener('click', (ev) => {
      ev.stopPropagation();
      action();
      toast.remove();
    });
    toast.appendChild(action);
  }
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('visible');
  }, 20);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
