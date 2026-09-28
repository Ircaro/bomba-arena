import type { GameState, Phase, PowerUpKind, Tile } from './types';

export type GameEvent =
  | { type: 'bombPlaced'; x: number; y: number; owner: string }
  | { type: 'bombExploded'; x: number; y: number; owner: string }
  | { type: 'blockDestroyed'; x: number; y: number }
  | { type: 'flameStarted'; x: number; y: number }
  | { type: 'flameEnded'; x: number; y: number }
  | { type: 'powerUpSpawned'; x: number; y: number; kind: PowerUpKind }
  | { type: 'powerUpCollected'; x: number; y: number; kind: PowerUpKind; playerId: string | null }
  | { type: 'powerUpDestroyed'; x: number; y: number; kind: PowerUpKind }
  | { type: 'playerDied'; playerId: string; x: number; y: number }
  | { type: 'roundDecided'; winner: string | null }
  | { type: 'roundEnded'; winner: string | null };

export interface StateSnapshot {
  width: number;
  tiles: Tile[];
  flames: Set<string>;
  bombs: Map<number, { x: number; y: number; owner: string }>;
  powerUps: Map<string, PowerUpKind>;
  players: Map<string, { x: number; y: number; alive: boolean }>;
  phase: Phase;
  winner: string | null;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function parseCell(key: string): [number, number] {
  const [x, y] = key.split(',').map(Number);
  return [x, y];
}

export function snapshotState(state: GameState): StateSnapshot {
  return {
    width: state.width,
    tiles: [...state.tiles],
    flames: new Set(state.flames.map((flame) => cellKey(flame.x, flame.y))),
    bombs: new Map(state.bombs.map((bomb) => [bomb.id, { x: bomb.x, y: bomb.y, owner: bomb.owner }])),
    powerUps: new Map(state.powerUps.map((item) => [cellKey(item.x, item.y), item.kind])),
    players: new Map(state.players.map((player) => [player.id, { x: player.x, y: player.y, alive: player.alive }])),
    phase: state.phase,
    winner: state.winner,
  };
}

function soleSurvivor(snapshot: StateSnapshot): string | null {
  if (snapshot.players.size < 2) return null;
  const alive = [...snapshot.players].filter(([, player]) => player.alive);
  return alive.length === 1 ? alive[0][0] : null;
}

export function diffEvents(previous: StateSnapshot, next: StateSnapshot): GameEvent[] {
  const events: GameEvent[] = [];

  for (const [id, bomb] of next.bombs) {
    if (!previous.bombs.has(id)) events.push({ type: 'bombPlaced', ...bomb });
  }
  for (const [id, bomb] of previous.bombs) {
    if (!next.bombs.has(id)) events.push({ type: 'bombExploded', ...bomb });
  }

  for (let index = 0; index < next.tiles.length; index++) {
    if (previous.tiles[index] === 'block' && next.tiles[index] === 'empty') {
      events.push({ type: 'blockDestroyed', x: index % next.width, y: Math.floor(index / next.width) });
    }
  }

  for (const key of next.flames) {
    if (previous.flames.has(key)) continue;
    const [x, y] = parseCell(key);
    events.push({ type: 'flameStarted', x, y });
  }
  for (const key of previous.flames) {
    if (next.flames.has(key)) continue;
    const [x, y] = parseCell(key);
    events.push({ type: 'flameEnded', x, y });
  }

  for (const [key, kind] of next.powerUps) {
    if (previous.powerUps.has(key)) continue;
    const [x, y] = parseCell(key);
    events.push({ type: 'powerUpSpawned', x, y, kind });
  }
  for (const [key, kind] of previous.powerUps) {
    if (next.powerUps.has(key)) continue;
    const [x, y] = parseCell(key);
    if (next.flames.has(key)) {
      events.push({ type: 'powerUpDestroyed', x, y, kind });
      continue;
    }
    const collector = [...next.players].find(
      ([, player]) => player.alive && Math.floor(player.x) === x && Math.floor(player.y) === y,
    );
    events.push({ type: 'powerUpCollected', x, y, kind, playerId: collector ? collector[0] : null });
  }

  for (const [id, player] of next.players) {
    if (previous.players.get(id)?.alive && !player.alive) {
      events.push({ type: 'playerDied', playerId: id, x: player.x, y: player.y });
    }
  }

  if (previous.phase === 'playing' && next.phase !== 'playing') {
    events.push({ type: 'roundDecided', winner: soleSurvivor(next) });
  }
  if (previous.phase !== 'ended' && next.phase === 'ended') {
    events.push({ type: 'roundEnded', winner: next.winner });
  }
  return events;
}

export class EventTracker {
  private state: GameState | null = null;
  private snapshot: StateSnapshot | null = null;

  update(state: GameState): GameEvent[] {
    const next = snapshotState(state);
    const previous = this.state === state ? this.snapshot : null;
    this.state = state;
    this.snapshot = next;
    return previous ? diffEvents(previous, next) : [];
  }
}
