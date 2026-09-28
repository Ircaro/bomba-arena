import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, parseClientMessage, type ErrorCode } from '@bomba/shared';
import { Room, type InviteInfo, type Member } from './room';
import { serveStatic } from './static';
import { openTunnel, type PublicTunnel } from './tunnel';

const args = process.argv.slice(2);
const useTunnel = args.includes('--tunnel');
const useNetwork = args.includes('--rede');
const useDirect = args.includes('--direto');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = useNetwork || useDirect ? '::' : process.env.HOST ?? '127.0.0.1';
const MAX_ROOMS = 50;
const JOIN_FAILURE_WINDOW_MS = 60_000;
const MAX_JOIN_FAILURES = 12;
const MAX_CONNECTIONS = 200;
const MESSAGES_PER_SECOND = 120;
const root = fileURLToPath(new URL('../../client/dist/', import.meta.url));

if (!existsSync(path.join(root, 'index.html'))) {
  console.error('Não encontrei o build do jogo. Rode "npm run build" antes de iniciar o servidor.');
  process.exit(1);
}

const rooms = new Map<string, Room>();
const joinFailures = new Map<string, number[]>();
let tunnel: PublicTunnel | null = null;

function recentFailures(key: string, now: number): number[] {
  const recent = (joinFailures.get(key) ?? []).filter((time) => now - time < JOIN_FAILURE_WINDOW_MS);
  if (recent.length > 0) joinFailures.set(key, recent);
  else joinFailures.delete(key);
  return recent;
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function clientKey(request: http.IncomingMessage): string {
  const remote = request.socket.remoteAddress;
  const forwarded = request.headers['cf-connecting-ip'];
  const viaTunnel = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (viaTunnel && isLoopback(remote)) return viaTunnel;
  return remote ?? 'desconhecido';
}

interface NetworkAddress {
  label: string;
  address: string;
}

function describeInterface(name: string, address: string): string {
  if (/radmin/i.test(name) || address.startsWith('26.')) return 'Radmin VPN';
  if (/hamachi/i.test(name) || address.startsWith('25.')) return 'Hamachi';
  if (/zerotier/i.test(name)) return 'ZeroTier';
  if (/tailscale/i.test(name)) return 'Tailscale';
  return 'Rede local';
}

function networkAddresses(): NetworkAddress[] {
  const found: NetworkAddress[] = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue;
      found.push({ label: describeInterface(name, entry.address), address: entry.address });
    }
  }
  return found.sort((a, b) => Number(a.label === 'Rede local') - Number(b.label === 'Rede local'));
}

function chosenAddress(addresses: NetworkAddress[]): NetworkAddress | null {
  const forced = args.find((arg) => arg.startsWith('--ip='))?.slice('--ip='.length) ?? process.env.PUBLIC_HOST;
  if (forced) return addresses.find((item) => item.address === forced) ?? { label: 'Endereço escolhido', address: forced };
  return addresses[0] ?? null;
}

function globalIpv6(): string | null {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv6' && !entry.internal && /^[23]/.test(entry.address)) return entry.address;
    }
  }
  return null;
}

const networkInvite = useNetwork ? chosenAddress(networkAddresses()) : null;
const directIpv6 = useDirect ? globalIpv6() : null;

function inviteInfo(): InviteInfo {
  if (tunnel) return { url: tunnel.url, hint: null };
  if (directIpv6) {
    return { url: `http://[${directIpv6}]:${PORT}`, hint: null };
  }
  if (!networkInvite) return { url: null, hint: null };
  const hint =
    networkInvite.label === 'Rede local'
      ? 'Quem for entrar precisa estar na mesma rede (mesmo Wi-Fi ou cabo) que você.'
      : `Quem for entrar precisa estar conectado à sua rede no ${networkInvite.label}.`;
  return { url: `http://${networkInvite.address}:${PORT}`, hint };
}

function createRoomCode(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error('Sem códigos de sala disponíveis');
}

function reject(socket: WebSocket, code: ErrorCode, message: string): void {
  socket.send(JSON.stringify({ type: 'error', code, message }));
  socket.close(1008, code);
}

const server = http.createServer((request, response) => {
  void serveStatic(root, request, response);
});
const sockets = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });

sockets.on('connection', (socket, request) => {
  const key = clientKey(request);
  if (sockets.clients.size > MAX_CONNECTIONS) {
    reject(socket, 'server-full', 'O servidor está cheio. Tente de novo em instantes.');
    return;
  }
  let room: Room | null = null;
  let member: Member | null = null;
  let windowStart = performance.now();
  let received = 0;

  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    const now = performance.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      received = 0;
    }
    if (++received > MESSAGES_PER_SECOND) return;
    const message = parseClientMessage(data.toString());
    if (!message) return;

    if (message.type !== 'join') {
      if (room && member) room.handle(member, message);
      return;
    }
    if (member) return;
    if (message.room === null) {
      if (rooms.size >= MAX_ROOMS) {
        reject(socket, 'server-full', 'O servidor está cheio. Tente de novo em instantes.');
        return;
      }
      room = new Room(createRoomCode(), inviteInfo, (empty) => rooms.delete(empty.code));
      rooms.set(room.code, room);
    } else {
      const failures = recentFailures(key, now);
      if (failures.length >= MAX_JOIN_FAILURES) {
        reject(socket, 'too-many-attempts', 'Muitas tentativas de entrar em salas. Espere um minuto e tente de novo.');
        return;
      }
      room = rooms.get(message.room) ?? null;
      if (!room) {
        joinFailures.set(key, [...failures, now]);
        reject(socket, 'room-not-found', 'Essa sala não existe ou já foi fechada.');
        return;
      }
    }
    member = room.join(socket);
    if (!member) {
      room = null;
      reject(socket, 'room-full', 'A sala está cheia (máximo de 4 jogadores).');
    }
  });

  socket.on('close', () => {
    if (room && member) room.leave(member);
  });
  socket.on('error', () => socket.terminate());
});

const heartbeat = setInterval(() => {
  const now = performance.now();
  for (const room of rooms.values()) room.heartbeat(now);
}, 1000);

async function startTunnel(): Promise<void> {
  console.log('Abrindo o túnel público da Cloudflare...');
  try {
    tunnel = await openTunnel(`http://127.0.0.1:${PORT}`);
    console.log(`\nLink público do jogo: ${tunnel.url}\n`);
    for (const room of rooms.values()) room.broadcastLobby();
  } catch (error) {
    console.error('Não consegui abrir o túnel:', error instanceof Error ? error.message : error);
  }
}

function shutdown(): void {
  clearInterval(heartbeat);
  tunnel?.stop();
  for (const room of rooms.values()) room.stop();
  sockets.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`Bomba Arena rodando em http://localhost:${PORT}`);
  if (useNetwork) {
    const addresses = networkAddresses();
    if (addresses.length === 0) console.log('Nenhuma rede encontrada além deste computador.');
    for (const item of addresses) console.log(`  ${item.label.padEnd(12)} http://${item.address}:${PORT}`);
    if (networkInvite) console.log(`\nConvites da sala vão usar http://${networkInvite.address}:${PORT} (${networkInvite.label})\n`);
  }
  if (useDirect) {
    if (directIpv6) console.log(`\nLink direto pela internet (IPv6): http://[${directIpv6}]:${PORT}\n`);
    else console.log('\nEste computador não tem IPv6 público, então o modo direto não vai funcionar.\n');
  }
  if (useTunnel) void startTunnel();
});
