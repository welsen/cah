import { render } from "../../utils/render.mjs";

export async function createConnectionBadge() {
  await render(document.querySelector('badge'), './templates/connection-badge/connection-badge.html');
}

export function updateBadge(txt, className) {
  const badge = document.getElementById('socketStatus');
  if (!badge) return;
  const statusText = badge.querySelector('.status-text');
  if (!statusText) return;
  statusText.textContent = `Socket: ${txt}`;
  badge.className = `socket-status ${className}`;
}

export function initBadgeListeners() {
  const appInstance = window.App;
  if (!appInstance || !appInstance.socket) return;
  appInstance.socket.on('connect', () => {
    updateBadge('connected', 'connected');
  });
  appInstance.socket.on('disconnect', (reason) => {
    updateBadge('disconnected', 'disconnected');
  });
  appInstance.socket.on('connect_error', () => {
    updateBadge('error', 'connect_error');
  });
  appInstance.socket.on('reconnect_attempt', (n) => {
    updateBadge('reconnecting...', 'reconnecting');
  });
}
