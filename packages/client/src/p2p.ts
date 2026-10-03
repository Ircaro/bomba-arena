import { Room, parseClientMessage, type InviteInfo, type Member, type Peer, type PeerRoute } from '@bomba/shared';
import { BaseChannel, localPair, signalingUrl, type Channel } from './net';

const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const RTC_TIMEOUT_MS = 10_000;
const KEEPALIVE_MS = 20_000;
const GUEST_MESSAGES_PER_SECOND = 120;
const GUEST_MESSAGE_MAX_BYTES = 2048;
const FAST_TYPES = ['{"type":"snapshot"', '{"type":"ping"', '{"type":"pong"'];

export interface Connection {
  channel: Promise<Channel>;
  close(): void;
}

function relayOnly(): boolean {
  return new URLSearchParams(location.search).has('relay');
}

function parse(raw: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(raw) as unknown;
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

class PeerLink {
  readonly channel: BaseChannel;
  route: PeerRoute = 'servidor';
  private pc: RTCPeerConnection | null = null;
  private reliable: RTCDataChannel | null = null;
  private fast: RTCDataChannel | null = null;
  private candidates: RTCIceCandidateInit[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly role: 'host' | 'guest',
    private readonly relay: (data: string) => void,
    private readonly signal: (data: unknown) => void,
    relayBuffered: () => number,
  ) {
    this.channel = new BaseChannel(
      (data) => this.transmit(data),
      () => (this.route === 'direto' && this.reliable ? this.reliable.bufferedAmount : relayBuffered()),
      () => this.shutdown(),
    );
    this.channel.markOpen();
    if (role === 'host' && !relayOnly() && typeof RTCPeerConnection !== 'undefined') void this.offer();
  }

  receiveRelay(data: string): void {
    this.channel.deliver(data);
  }

  async receiveSignal(data: unknown): Promise<void> {
    if (relayOnly() || typeof data !== 'object' || data === null) return;
    const message = data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    try {
      if (message.sdp) {
        if (message.sdp.type === 'offer' && this.role === 'guest') {
          this.createConnection();
          const pc = this.pc as RTCPeerConnection;
          await pc.setRemoteDescription(message.sdp);
          await this.flushCandidates();
          await pc.setLocalDescription(await pc.createAnswer());
          this.signal({ sdp: pc.localDescription?.toJSON() });
        } else if (message.sdp.type === 'answer' && this.role === 'host' && this.pc) {
          await this.pc.setRemoteDescription(message.sdp);
          await this.flushCandidates();
        }
      } else if (message.candidate) {
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(message.candidate);
        else this.candidates.push(message.candidate);
      }
    } catch {
      this.abandonRtc();
    }
  }

  remoteClosed(reason: string | null): void {
    this.shutdown();
    this.channel.finish(reason);
  }

  private async flushCandidates(): Promise<void> {
    const pending = this.candidates.splice(0);
    for (const candidate of pending) await this.pc?.addIceCandidate(candidate).catch(() => undefined);
  }

  private createConnection(): void {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) this.signal({ candidate: event.candidate.toJSON() });
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.abandonRtc();
    });
    pc.addEventListener('datachannel', (event) => this.adopt(event.channel));
    this.timer = setTimeout(() => {
      if (this.route !== 'direto') this.abandonRtc();
    }, RTC_TIMEOUT_MS);
  }

  private async offer(): Promise<void> {
    this.createConnection();
    const pc = this.pc as RTCPeerConnection;
    this.adopt(pc.createDataChannel('r', { ordered: true }));
    this.adopt(pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }));
    try {
      await pc.setLocalDescription(await pc.createOffer());
      this.signal({ sdp: pc.localDescription?.toJSON() });
    } catch {
      this.abandonRtc();
    }
  }

  private adopt(channel: RTCDataChannel): void {
    if (channel.label === 'r') this.reliable = channel;
    else if (channel.label === 'u') this.fast = channel;
    else return;
    channel.addEventListener('message', (event) => {
      if (typeof event.data === 'string') this.channel.deliver(event.data);
    });
    channel.addEventListener('open', () => this.checkReady());
    channel.addEventListener('close', () => {
      if (this.route === 'direto') this.abandonRtc();
    });
    this.checkReady();
  }

  private checkReady(): void {
    if (this.reliable?.readyState === 'open' && this.fast?.readyState === 'open') {
      this.route = 'direto';
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private transmit(data: string): void {
    if (this.route === 'direto' && this.reliable?.readyState === 'open') {
      const fast = this.fast?.readyState === 'open' && FAST_TYPES.some((prefix) => data.startsWith(prefix));
      (fast ? (this.fast as RTCDataChannel) : this.reliable).send(data);
      return;
    }
    this.relay(data);
  }

  private abandonRtc(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.route = 'servidor';
    this.reliable = null;
    this.fast = null;
    const pc = this.pc;
    this.pc = null;
    pc?.close();
  }

  private shutdown(): void {
    this.abandonRtc();
  }
}

function keepAlive(socket: WebSocket): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"keepalive"}');
  }, KEEPALIVE_MS);
}

class RoomHost {
  private readonly room: Room;
  private readonly links = new Map<string, PeerLink>();
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(
    code: string,
    invite: InviteInfo,
    private readonly socket: WebSocket,
  ) {
    this.room = new Room(code, () => invite, () => undefined);
    this.heartbeat = setInterval(() => this.room.heartbeat(performance.now()), 1000);
  }

  addGuest(peer: string): void {
    const link = new PeerLink(
      'host',
      (data) => this.send({ type: 'relay', to: peer, data }),
      (data) => this.send({ type: 'signal', to: peer, data }),
      () => this.socket.bufferedAmount,
    );
    this.links.set(peer, link);
    this.accept(link.channel, () => link.route);
  }

  relay(from: string, data: string): void {
    this.links.get(from)?.receiveRelay(data);
  }

  signal(from: string, data: unknown): void {
    void this.links.get(from)?.receiveSignal(data);
  }

  guestLeft(peer: string): void {
    this.links.get(peer)?.remoteClosed(null);
    this.links.delete(peer);
  }

  accept(channel: Channel, route: () => PeerRoute): void {
    let member: Member | null = null;
    let windowStart = performance.now();
    let received = 0;
    const peer: Peer = {
      get open() {
        return channel.open;
      },
      get buffered() {
        return channel.buffered;
      },
      get route() {
        return route();
      },
      send: (data) => channel.send(data),
      close: () => channel.close(),
    };
    channel.onMessage((raw) => {
      if (raw.length > GUEST_MESSAGE_MAX_BYTES) return;
      const now = performance.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        received = 0;
      }
      if (++received > GUEST_MESSAGES_PER_SECOND) return;
      const message = parseClientMessage(raw);
      if (!message) return;
      if (message.type === 'join') {
        if (member) return;
        member = this.room.join(peer);
        if (!member) {
          channel.send(JSON.stringify({ type: 'error', code: 'room-full', message: 'A sala está cheia (máximo de 4 jogadores).' }));
          channel.close();
        }
        return;
      }
      if (member) this.room.handle(member, message);
    });
    channel.onClose(() => {
      if (member) this.room.leave(member);
      member = null;
    });
  }

  stop(): void {
    clearInterval(this.heartbeat);
    this.room.stop();
    for (const link of this.links.values()) link.remoteClosed(null);
    this.links.clear();
  }

  private send(message: unknown): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}

export function hostRoom(): Connection {
  const socket = new WebSocket(signalingUrl());
  const alive = keepAlive(socket);
  let host: RoomHost | null = null;
  let local: BaseChannel | null = null;
  let settled = false;
  const channel = new Promise<Channel>((resolve, reject) => {
    socket.addEventListener('open', () => socket.send('{"type":"host"}'));
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      const message = parse(event.data);
      if (!message) return;
      switch (message.type) {
        case 'hosting': {
          const [roomSide, playerSide] = localPair();
          host = new RoomHost(String(message.room), { url: (message.publicUrl as string | null) ?? null, hint: (message.inviteHint as string | null) ?? null }, socket);
          host.accept(roomSide, () => 'local');
          local = playerSide;
          settled = true;
          resolve(playerSide);
          break;
        }
        case 'peer':
          host?.addGuest(String(message.peer));
          break;
        case 'relay':
          if (typeof message.from === 'string' && typeof message.data === 'string') host?.relay(message.from, message.data);
          break;
        case 'signal':
          if (typeof message.from === 'string') host?.signal(message.from, message.data);
          break;
        case 'peerLeft':
          host?.guestLeft(String(message.peer));
          break;
        case 'error':
          if (!settled) {
            settled = true;
            reject(new Error(String(message.message)));
          }
          break;
        default:
          break;
      }
    });
    socket.addEventListener('close', () => {
      clearInterval(alive);
      host?.stop();
      host = null;
      if (!settled) {
        settled = true;
        reject(new Error('Não consegui falar com o servidor do jogo.'));
      } else local?.finish('A conexão com o servidor caiu, e a sala foi fechada.');
    });
  });
  return {
    channel,
    close() {
      clearInterval(alive);
      host?.stop();
      host = null;
      socket.close();
    },
  };
}

export function joinRoom(code: string): Connection {
  const socket = new WebSocket(signalingUrl());
  const alive = keepAlive(socket);
  let link: PeerLink | null = null;
  const channel = new Promise<Channel>((resolve, reject) => {
    let decided = false;
    const detect = (event: MessageEvent) => {
      if (typeof event.data !== 'string' || decided) return;
      decided = true;
      socket.removeEventListener('message', detect);
      const message = parse(event.data);
      if (message?.type === 'p2p') {
        link = new PeerLink(
          'guest',
          (data) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'relay', data })),
          (data) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'signal', data })),
          () => socket.bufferedAmount,
        );
        const current = link;
        socket.addEventListener('message', (next) => {
          if (typeof next.data !== 'string') return;
          const signal = parse(next.data);
          if (signal?.type === 'relay' && typeof signal.data === 'string') current.receiveRelay(signal.data);
          else if (signal?.type === 'signal') void current.receiveSignal(signal.data);
          else if (signal?.type === 'hostLeft') current.remoteClosed('Quem criou a sala saiu, e a sala foi fechada.');
        });
        socket.addEventListener('close', () => current.remoteClosed('A conexão com a sala caiu.'));
        resolve(current.channel);
        return;
      }
      const direct = new BaseChannel(
        (data) => socket.send(data),
        () => socket.bufferedAmount,
        () => socket.close(),
      );
      direct.markOpen();
      direct.deliver(event.data);
      socket.addEventListener('message', (next) => {
        if (typeof next.data === 'string') direct.deliver(next.data);
      });
      socket.addEventListener('close', () => direct.finish(null));
      resolve(direct);
    };
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'join', room: code })));
    socket.addEventListener('message', detect);
    socket.addEventListener('close', () => {
      clearInterval(alive);
      if (!decided) reject(new Error('Não consegui falar com o servidor do jogo.'));
    });
  });
  return {
    channel,
    close() {
      clearInterval(alive);
      link?.remoteClosed(null);
      socket.close();
    },
  };
}

export function serverRoom(): Connection {
  const socket = new WebSocket(signalingUrl());
  const direct = new BaseChannel(
    (data) => socket.send(data),
    () => socket.bufferedAmount,
    () => socket.close(),
  );
  const channel = new Promise<Channel>((resolve, reject) => {
    socket.addEventListener('open', () => {
      direct.markOpen();
      resolve(direct);
    });
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') direct.deliver(event.data);
    });
    socket.addEventListener('close', () => {
      direct.finish(null);
      reject(new Error('Não consegui falar com o servidor do jogo.'));
    });
  });
  return { channel, close: () => socket.close() };
}
