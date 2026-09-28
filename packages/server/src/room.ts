import { WebSocket } from 'ws';
import {
  COUNTDOWN_MS,
  MATCH_START_DELAY_MS,
  MAX_ROOM_PLAYERS,
  NEXT_ROUND_DELAY_MS,
  PLAYER_COLOR_COUNT,
  SNAPSHOT_EVERY_TICKS,
  TICK_RATE,
  buildSnapshot,
  createMatch,
  matchInfo,
  randomSeed,
  sanitizeName,
  startNextRound,
  stepMatch,
  type ClientMessage,
  type Direction,
  type MatchState,
  type PlayerInput,
  type PlayerSetup,
  type RoomStatus,
  type ServerMessage,
  type Tile,
} from '@bomba/shared';

const STEP_MS = 1000 / TICK_RATE;
const LOOP_INTERVAL_MS = 4;
const STALE_MS = 10_000;
const MAX_BUFFERED_BYTES = 512 * 1024;

export interface InviteInfo {
  url: string | null;
  hint: string | null;
}

export interface Member {
  id: string;
  name: string;
  color: number;
  ready: boolean;
  socket: WebSocket;
  dir: Direction | null;
  bombQueued: boolean;
  ping: number | null;
  lastSeen: number;
}

export class Room {
  private readonly members: Member[] = [];
  private status: RoomStatus = 'lobby';
  private hostId: string | null = null;
  private match: MatchState | null = null;
  private sentTiles: Tile[] = [];
  private loop: NodeJS.Timeout | null = null;
  private countdown: NodeJS.Timeout | null = null;
  private pendingStart: NodeJS.Timeout | null = null;
  private startAt: number | null = null;
  private lastTime = 0;
  private accumulator = 0;
  private sinceSnapshot = 0;
  private joined = 0;

  constructor(
    readonly code: string,
    private readonly invite: () => InviteInfo,
    private readonly onEmpty: (room: Room) => void,
  ) {}

  get size(): number {
    return this.members.length;
  }

  join(socket: WebSocket): Member | null {
    if (this.members.length >= MAX_ROOM_PLAYERS) return null;
    this.joined++;
    const used = new Set(this.members.map((member) => member.color));
    let color = 0;
    while (used.has(color) && color < PLAYER_COLOR_COUNT - 1) color++;
    const member: Member = {
      id: `${this.code}-${this.joined}`,
      name: `Jogador ${this.joined}`,
      color,
      ready: false,
      socket,
      dir: null,
      bombQueued: false,
      ping: null,
      lastSeen: performance.now(),
    };
    this.members.push(member);
    this.hostId ??= member.id;
    this.send(member, { type: 'welcome', you: member.id, room: this.code });
    if (this.match && this.status !== 'lobby') {
      this.send(member, { type: 'round', match: matchInfo(this.match), game: this.match.game, countdownMs: 0 });
    }
    this.evaluateStart();
    this.broadcastLobby();
    return member;
  }

  leave(member: Member): void {
    const index = this.members.indexOf(member);
    if (index < 0) return;
    this.members.splice(index, 1);
    if (this.hostId === member.id) this.hostId = this.members[0]?.id ?? null;
    const player = this.match?.game.players.find((candidate) => candidate.id === member.id);
    if (player && (this.status === 'playing' || this.status === 'countdown')) player.alive = false;
    if (this.members.length === 0) {
      this.stop();
      this.onEmpty(this);
      return;
    }
    this.evaluateStart();
    this.broadcastLobby();
  }

  handle(member: Member, message: ClientMessage): void {
    member.lastSeen = performance.now();
    switch (message.type) {
      case 'input':
        member.dir = message.dir;
        break;
      case 'bomb':
        if (this.status === 'playing') member.bombQueued = true;
        break;
      case 'ready':
        if (!this.waiting()) break;
        member.ready = message.ready;
        this.evaluateStart();
        this.broadcastLobby();
        break;
      case 'profile':
        this.updateProfile(member, message.color, message.name);
        break;
      case 'pong': {
        const rtt = performance.now() - message.sent;
        if (rtt >= 0 && rtt < STALE_MS) member.ping = member.ping === null ? rtt : member.ping * 0.7 + rtt * 0.3;
        break;
      }
      default:
        break;
    }
  }

  heartbeat(now: number): void {
    for (const member of [...this.members]) {
      if (now - member.lastSeen > STALE_MS) {
        member.socket.terminate();
        continue;
      }
      this.send(member, { type: 'ping', sent: now });
    }
    if (this.waiting()) this.broadcastLobby();
  }

  broadcastLobby(): void {
    const now = performance.now();
    const invite = this.invite();
    this.broadcast({
      type: 'lobby',
      room: this.code,
      host: this.hostId,
      status: this.status,
      players: this.members.map((member) => ({
        id: member.id,
        name: member.name,
        color: member.color,
        ready: member.ready,
        ping: member.ping === null ? null : Math.round(member.ping),
      })),
      inMatch: this.match && this.status !== 'lobby' ? this.match.players.map((player) => player.id) : [],
      publicUrl: invite.url,
      inviteHint: invite.hint,
      startsInMs: this.startAt === null ? null : Math.max(0, Math.round(this.startAt - now)),
    });
  }

  stop(): void {
    if (this.loop) clearInterval(this.loop);
    if (this.countdown) clearTimeout(this.countdown);
    if (this.pendingStart) clearTimeout(this.pendingStart);
    this.loop = null;
    this.countdown = null;
    this.pendingStart = null;
    this.startAt = null;
  }

  private waiting(): boolean {
    return this.status === 'lobby' || this.status === 'roundOver';
  }

  private updateProfile(member: Member, color: number | undefined, name: string | undefined): void {
    if (this.status !== 'lobby') return;
    let changed = false;
    if (color !== undefined && color !== member.color && !this.members.some((other) => other !== member && other.color === color)) {
      member.color = color;
      changed = true;
    }
    if (name !== undefined) {
      const clean = sanitizeName(name);
      if (clean && clean !== member.name) {
        member.name = clean;
        changed = true;
      }
    }
    if (changed) this.broadcastLobby();
  }

  private roster(): PlayerSetup[] {
    return this.members.map((member) => ({ id: member.id, name: member.name, color: member.color }));
  }

  private sameRoster(setups: PlayerSetup[]): boolean {
    const current = this.match;
    if (!current || current.players.length !== setups.length) return false;
    return setups.every((setup, index) => {
      const player = current.players[index];
      return player.id === setup.id && player.name === setup.name && player.color === setup.color;
    });
  }

  private startsNewMatch(): boolean {
    return !this.match || this.match.champion !== null || !this.sameRoster(this.roster());
  }

  private evaluateStart(): void {
    const everyoneReady = this.waiting() && this.members.length >= 2 && this.members.every((member) => member.ready);
    if (everyoneReady && !this.pendingStart) {
      const delay = this.startsNewMatch() ? MATCH_START_DELAY_MS : NEXT_ROUND_DELAY_MS;
      this.startAt = performance.now() + delay;
      this.pendingStart = setTimeout(() => {
        this.pendingStart = null;
        this.startAt = null;
        this.start();
      }, delay);
    } else if (!everyoneReady && this.pendingStart) {
      clearTimeout(this.pendingStart);
      this.pendingStart = null;
      this.startAt = null;
    }
  }

  private start(): void {
    if (!this.waiting() || this.members.length < 2) return;
    const setups = this.roster();
    if (this.match && this.sameRoster(setups)) startNextRound(this.match);
    else this.match = createMatch(setups, randomSeed());
    const match = this.match;
    for (const member of this.members) {
      member.dir = null;
      member.bombQueued = false;
      member.ready = false;
    }
    this.sentTiles = [...match.game.tiles];
    this.status = 'countdown';
    this.broadcast({ type: 'round', match: matchInfo(match), game: match.game, countdownMs: COUNTDOWN_MS });
    this.broadcastLobby();
    this.countdown = setTimeout(() => this.begin(), COUNTDOWN_MS);
  }

  private begin(): void {
    this.countdown = null;
    if (!this.match) return;
    this.status = 'playing';
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.sinceSnapshot = 0;
    this.loop = setInterval(() => this.update(), LOOP_INTERVAL_MS);
    this.broadcastLobby();
  }

  private update(): void {
    const now = performance.now();
    this.accumulator += Math.min(250, now - this.lastTime);
    this.lastTime = now;
    while (this.accumulator >= STEP_MS && this.status === 'playing') {
      this.accumulator -= STEP_MS;
      this.step();
    }
  }

  private step(): void {
    const match = this.match;
    if (!match) return;
    const inputs: Record<string, PlayerInput> = {};
    for (const member of this.members) {
      inputs[member.id] = { dir: member.dir, bomb: member.bombQueued };
      member.bombQueued = false;
    }
    stepMatch(match, inputs);
    this.sinceSnapshot++;
    const ended = match.game.phase === 'ended';
    if (this.sinceSnapshot >= SNAPSHOT_EVERY_TICKS || ended) {
      this.sinceSnapshot = 0;
      this.broadcast({ type: 'snapshot', snapshot: buildSnapshot(match, this.sentTiles, this.pings()) });
    }
    if (ended) {
      this.stop();
      this.status = 'roundOver';
      this.broadcastLobby();
    }
  }

  private pings(): Record<string, number> {
    const pings: Record<string, number> = {};
    for (const member of this.members) if (member.ping !== null) pings[member.id] = Math.round(member.ping);
    return pings;
  }

  private send(member: Member, message: ServerMessage): void {
    if (member.socket.readyState === WebSocket.OPEN) member.socket.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    const droppable = message.type === 'snapshot';
    for (const member of this.members) {
      if (member.socket.readyState !== WebSocket.OPEN) continue;
      if (droppable && member.socket.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      member.socket.send(payload);
    }
  }
}
