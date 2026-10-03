export const RELAY_MAX_BYTES = 48 * 1024;
export const SIGNAL_MAX_BYTES = 16 * 1024;
export const PEER_ID_MAX_LENGTH = 24;

export type SignalClientMessage =
  | { type: 'host' }
  | { type: 'relay'; to?: string; data: string }
  | { type: 'signal'; to?: string; data: unknown }
  | { type: 'keepalive' };

export type SignalServerMessage =
  | { type: 'hosting'; room: string; publicUrl: string | null; inviteHint: string | null }
  | { type: 'p2p'; peer: string }
  | { type: 'peer'; peer: string }
  | { type: 'peerLeft'; peer: string }
  | { type: 'hostLeft' }
  | { type: 'relay'; from?: string; data: string }
  | { type: 'signal'; from?: string; data: unknown };

function peerId(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.length > 0 && value.length <= PEER_ID_MAX_LENGTH ? value : null;
}

export function parseSignalMessage(raw: string): SignalClientMessage | null {
  if (raw.length > RELAY_MAX_BYTES + 256) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case 'host':
      return { type: 'host' };
    case 'keepalive':
      return { type: 'keepalive' };
    case 'relay': {
      const to = peerId(message.to);
      if (to === null || typeof message.data !== 'string' || message.data.length > RELAY_MAX_BYTES) return null;
      return to === undefined ? { type: 'relay', data: message.data } : { type: 'relay', to, data: message.data };
    }
    case 'signal': {
      const to = peerId(message.to);
      if (to === null || typeof message.data !== 'object' || message.data === null) return null;
      if (JSON.stringify(message.data).length > SIGNAL_MAX_BYTES) return null;
      return to === undefined ? { type: 'signal', data: message.data } : { type: 'signal', to, data: message.data };
    }
    default:
      return null;
  }
}
