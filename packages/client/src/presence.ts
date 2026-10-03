const HEARTBEAT_MS = 20_000;

function apiUrl(path: string): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (typeof configured !== 'string' || !configured) return path;
  return `${configured.replace(/^ws/, 'http').replace(/\/ws$/, '')}${path}`;
}

export function startPresence(): void {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ping = () => {
    void fetch(apiUrl('/api/presenca'), { method: 'POST', body: id, keepalive: true }).catch(() => undefined);
  };
  ping();
  setInterval(ping, HEARTBEAT_MS);
  window.addEventListener('pagehide', () => navigator.sendBeacon(apiUrl('/api/presenca/sair'), id));
}
