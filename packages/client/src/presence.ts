const HEARTBEAT_MS = 20_000;

export function startPresence(): void {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ping = () => {
    void fetch('/api/presenca', { method: 'POST', body: id, keepalive: true }).catch(() => undefined);
  };
  ping();
  setInterval(ping, HEARTBEAT_MS);
  window.addEventListener('pagehide', () => navigator.sendBeacon('/api/presenca/sair', id));
}
