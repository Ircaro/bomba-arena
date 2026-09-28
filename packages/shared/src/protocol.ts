import type { Bomb, Direction, Flame, GameState, MatchState, Phase, PlayerSetup, PowerUp, Tile } from './types';

export const MAX_ROOM_PLAYERS = 4;
export const SNAPSHOT_EVERY_TICKS = 2;
export const COUNTDOWN_MS = 1300;
export const MATCH_START_DELAY_MS = 5000;
export const NEXT_ROUND_DELAY_MS = 3000;
export const ROOM_CODE_LENGTH = 6;
export const PLAYER_COLOR_COUNT = 4;
export const NAME_MAX_LENGTH = 16;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type RoomStatus = 'lobby' | 'countdown' | 'playing' | 'roundOver';

export interface LobbyPlayer {
  id: string;
  name: string;
  color: number;
  ready: boolean;
  ping: number | null;
}

export interface PlayerFrame {
  id: string;
  x: number;
  y: number;
  alive: boolean;
  speed: number;
  range: number;
  maxBombs: number;
  facing: Direction;
}

export interface Snapshot {
  tick: number;
  phase: Phase;
  endTicks: number;
  winner: string | null;
  players: PlayerFrame[];
  bombs: Bomb[];
  flames: Flame[];
  powerUps: PowerUp[];
  tiles: [number, Tile][];
  wins: Record<string, number>;
  champion: string | null;
  pings: Record<string, number>;
}

export interface MatchInfo {
  round: number;
  winsToFinish: number;
  wins: Record<string, number>;
  champion: string | null;
  players: PlayerSetup[];
}

export type ClientMessage =
  | { type: 'join'; room: string | null }
  | { type: 'input'; dir: Direction | null }
  | { type: 'bomb' }
  | { type: 'ready'; ready: boolean }
  | { type: 'profile'; color?: number; name?: string }
  | { type: 'pong'; sent: number };

export type ErrorCode = 'room-not-found' | 'room-full' | 'server-full' | 'too-many-attempts';

export type ServerMessage =
  | { type: 'welcome'; you: string; room: string }
  | {
      type: 'lobby';
      room: string;
      host: string | null;
      status: RoomStatus;
      players: LobbyPlayer[];
      inMatch: string[];
      publicUrl: string | null;
      inviteHint: string | null;
      startsInMs: number | null;
    }
  | { type: 'round'; match: MatchInfo; game: GameState; countdownMs: number }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'ping'; sent: number }
  | { type: 'error'; code: ErrorCode; message: string };

const DIRECTIONS: readonly (Direction | null)[] = ['up', 'down', 'left', 'right', null];
const ROOM_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function isRoomCode(value: unknown): value is string {
  return typeof value === 'string' && ROOM_PATTERN.test(value);
}

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase();
}

export function sanitizeName(raw: string): string | null {
  const cleaned = raw.replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim();
  const limited = [...cleaned].slice(0, NAME_MAX_LENGTH).join('').trim();
  return limited.length > 0 ? limited : null;
}

function parseProfile(message: Record<string, unknown>): ClientMessage | null {
  const profile: { type: 'profile'; color?: number; name?: string } = { type: 'profile' };
  if (message.color !== undefined) {
    const color = message.color;
    if (typeof color !== 'number' || !Number.isInteger(color) || color < 0 || color >= PLAYER_COLOR_COUNT) return null;
    profile.color = color;
  }
  if (message.name !== undefined) {
    if (typeof message.name !== 'string' || message.name.length > 64) return null;
    profile.name = message.name;
  }
  return profile.color === undefined && profile.name === undefined ? null : profile;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case 'join':
      if (message.room === null || message.room === undefined) return { type: 'join', room: null };
      return isRoomCode(message.room) ? { type: 'join', room: message.room } : null;
    case 'input':
      return DIRECTIONS.includes(message.dir as Direction | null) ? { type: 'input', dir: message.dir as Direction | null } : null;
    case 'bomb':
      return { type: 'bomb' };
    case 'ready':
      return typeof message.ready === 'boolean' ? { type: 'ready', ready: message.ready } : null;
    case 'profile':
      return parseProfile(message);
    case 'pong':
      return typeof message.sent === 'number' && Number.isFinite(message.sent) ? { type: 'pong', sent: message.sent } : null;
    default:
      return null;
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function matchInfo(match: MatchState): MatchInfo {
  return {
    round: match.round,
    winsToFinish: match.winsToFinish,
    wins: { ...match.wins },
    champion: match.champion,
    players: match.players.map((player) => ({ ...player })),
  };
}

export function buildSnapshot(
  match: MatchState,
  sentTiles: Tile[],
  pings: Record<string, number>,
): Snapshot {
  const game = match.game;
  const tiles: [number, Tile][] = [];
  for (let index = 0; index < game.tiles.length; index++) {
    if (sentTiles[index] !== game.tiles[index]) {
      tiles.push([index, game.tiles[index]]);
      sentTiles[index] = game.tiles[index];
    }
  }
  return {
    tick: game.tick,
    phase: game.phase,
    endTicks: game.endTicks,
    winner: game.winner,
    players: game.players.map((player) => ({
      id: player.id,
      x: round3(player.x),
      y: round3(player.y),
      alive: player.alive,
      speed: player.speed,
      range: player.range,
      maxBombs: player.maxBombs,
      facing: player.facing,
    })),
    bombs: game.bombs.map((bomb) => ({ ...bomb, passable: [...bomb.passable] })),
    flames: game.flames.map((flame) => ({ ...flame })),
    powerUps: game.powerUps.map((item) => ({ ...item })),
    tiles,
    wins: { ...match.wins },
    champion: match.champion,
    pings: { ...pings },
  };
}

export function applySnapshot(game: GameState, snapshot: Snapshot): void {
  game.tick = snapshot.tick;
  game.phase = snapshot.phase;
  game.endTicks = snapshot.endTicks;
  game.winner = snapshot.winner;
  for (const frame of snapshot.players) {
    const player = game.players.find((candidate) => candidate.id === frame.id);
    if (!player) continue;
    player.x = frame.x;
    player.y = frame.y;
    player.alive = frame.alive;
    player.speed = frame.speed;
    player.range = frame.range;
    player.maxBombs = frame.maxBombs;
    player.facing = frame.facing;
  }
  game.bombs = snapshot.bombs.map((bomb) => ({ ...bomb, passable: [...bomb.passable] }));
  game.flames = snapshot.flames.map((flame) => ({ ...flame }));
  game.powerUps = snapshot.powerUps.map((item) => ({ ...item }));
  for (const [index, tile] of snapshot.tiles) {
    if (index >= 0 && index < game.tiles.length) game.tiles[index] = tile;
  }
}
