import {
  TICK_RATE,
  applySnapshot,
  type ClientMessage,
  type Direction,
  type ErrorCode,
  type LobbyPlayer,
  type MatchState,
  type PlayerInput,
  type RoomStatus,
  type ServerMessage,
  type Snapshot,
} from '@bomba/shared';
import type { Channel } from './net';
import type { Connection } from './p2p';

const TICK_MS = 1000 / TICK_RATE;
const RENDER_DELAY_TICKS = 4;
const RESYNC_TICKS = 20;

export type FailureCode = ErrorCode | 'unreachable' | 'lost';

export interface Position {
  x: number;
  y: number;
}

export interface OnlineEvents {
  lobby(): void;
  round(countdownMs: number): void;
  failure(code: FailureCode, message: string): void;
}

export class OnlineClient {
  you: string | null = null;
  room: string | null = null;
  host: string | null = null;
  status: RoomStatus = 'lobby';
  players: LobbyPlayer[] = [];
  inMatch: string[] = [];
  publicUrl: string | null = null;
  inviteHint: string | null = null;
  startsAt: number | null = null;
  match: MatchState | null = null;
  pings: Record<string, number> = {};
  private channel: Channel | null = null;
  private queue: Snapshot[] = [];
  private offset: number | null = null;
  private appliedTick = 0;
  private sentDir: Direction | null | undefined = undefined;
  private finished = false;

  constructor(
    private readonly connection: Connection,
    room: string | null,
    private readonly events: OnlineEvents,
  ) {
    connection.channel.then(
      (channel) => {
        if (this.finished) {
          channel.close();
          return;
        }
        this.channel = channel;
        channel.onMessage((data) => this.receive(data));
        channel.onClose((reason) => {
          if (this.finished) return;
          this.finished = true;
          this.events.failure('lost', reason ?? 'A conexão com a sala caiu.');
        });
        channel.onOpen(() => this.send({ type: 'join', room }));
      },
      (error: unknown) => {
        if (this.finished) return;
        this.finished = true;
        this.events.failure('unreachable', error instanceof Error ? error.message : 'Não consegui falar com o servidor do jogo.');
      },
    );
  }

  get joined(): boolean {
    return this.you !== null;
  }

  get isHost(): boolean {
    return this.you !== null && this.you === this.host;
  }

  get inCurrentMatch(): boolean {
    return this.you !== null && this.inMatch.includes(this.you);
  }

  get me(): LobbyPlayer | null {
    return this.players.find((player) => player.id === this.you) ?? null;
  }

  setReady(ready: boolean): void {
    this.send({ type: 'ready', ready });
  }

  setProfile(profile: { color?: number; name?: string }): void {
    this.send({ type: 'profile', ...profile });
  }

  sendInput(input: PlayerInput): void {
    if (this.status !== 'playing' || !this.inCurrentMatch) return;
    if (input.dir !== this.sentDir) {
      this.sentDir = input.dir;
      this.send({ type: 'input', dir: input.dir });
    }
    if (input.bomb) this.send({ type: 'bomb' });
  }

  close(): void {
    this.finished = true;
    this.channel?.close();
    this.connection.close();
  }

  frame(now: number): Map<string, Position> {
    const positions = new Map<string, Position>();
    const match = this.match;
    if (!match || this.offset === null) return positions;
    const game = match.game;
    const renderTick = now / TICK_MS + this.offset - RENDER_DELAY_TICKS;
    while (this.queue.length > 0 && this.queue[0].tick <= renderTick) {
      const snapshot = this.queue.shift();
      if (!snapshot) break;
      applySnapshot(game, snapshot);
      match.wins = { ...snapshot.wins };
      match.champion = snapshot.champion;
      this.pings = { ...this.pings, ...snapshot.pings };
      this.appliedTick = snapshot.tick;
    }
    const next = this.queue[0];
    if (!next || next.tick <= this.appliedTick) return positions;
    const t = Math.min(1, Math.max(0, (renderTick - this.appliedTick) / (next.tick - this.appliedTick)));
    for (const frame of next.players) {
      const player = game.players.find((candidate) => candidate.id === frame.id);
      if (!player) continue;
      const jump = Math.abs(frame.x - player.x) + Math.abs(frame.y - player.y);
      positions.set(frame.id, jump > 1.5 ? { x: player.x, y: player.y } : {
        x: player.x + (frame.x - player.x) * t,
        y: player.y + (frame.y - player.y) * t,
      });
    }
    return positions;
  }

  private receive(raw: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case 'welcome':
        this.you = message.you;
        this.room = message.room;
        break;
      case 'lobby':
        this.room = message.room;
        this.host = message.host;
        this.status = message.status;
        this.players = message.players;
        this.inMatch = message.inMatch;
        this.publicUrl = message.publicUrl;
        this.inviteHint = message.inviteHint;
        this.startsAt = message.startsInMs === null ? null : performance.now() + message.startsInMs;
        for (const player of message.players) if (player.ping !== null) this.pings[player.id] = player.ping;
        this.events.lobby();
        break;
      case 'round':
        this.match = {
          seed: 0,
          round: message.match.round,
          gamesPlayed: 0,
          players: message.match.players,
          wins: message.match.wins,
          winsToFinish: message.match.winsToFinish,
          champion: message.match.champion,
          game: message.game,
        };
        this.queue = [];
        this.offset = null;
        this.appliedTick = message.game.tick;
        this.sentDir = undefined;
        this.inMatch = message.match.players.map((player) => player.id);
        this.events.round(message.countdownMs);
        break;
      case 'snapshot':
        this.enqueue(message.snapshot);
        break;
      case 'ping':
        this.send({ type: 'pong', sent: message.sent });
        break;
      case 'error':
        this.finished = true;
        this.events.failure(message.code, message.message);
        break;
      default:
        break;
    }
  }

  private enqueue(snapshot: Snapshot): void {
    this.queue.push(snapshot);
    const target = snapshot.tick - performance.now() / TICK_MS;
    if (this.offset === null || Math.abs(target - this.offset) > RESYNC_TICKS) this.offset = target;
    else this.offset += (target - this.offset) * 0.05;
  }

  private send(message: ClientMessage): void {
    if (this.channel?.open) this.channel.send(JSON.stringify(message));
  }
}
