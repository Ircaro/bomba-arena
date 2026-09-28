import {
  BASE_BOMBS,
  BASE_RANGE,
  BASE_SPEED,
  BLOCK_DENSITY,
  BOMB_FUSE_TICKS,
  CORNER_ASSIST,
  FLAME_TICKS,
  GRID_HEIGHT,
  GRID_WIDTH,
  MAX_BOMBS,
  MAX_PLAYERS,
  MAX_RANGE,
  MAX_SPEED,
  POWERUP_CHANCE,
  ROUND_END_TICKS,
  SPEED_STEP,
  TICK_RATE,
} from './constants';
import { nextRandom } from './rng';
import type {
  Bomb,
  Direction,
  GameState,
  Phase,
  Player,
  PlayerInput,
  PlayerSetup,
  PowerUpKind,
  Tile,
} from './types';

const EPSILON = 1e-9;
const POWERUP_KINDS: PowerUpKind[] = ['bomb', 'range', 'speed'];

export const DIRECTIONS: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export function spawnPoint(width: number, height: number, slot: number): [number, number] {
  const spawns: [number, number][] = [
    [1, 1],
    [width - 2, height - 2],
    [width - 2, 1],
    [1, height - 2],
  ];
  return spawns[slot % spawns.length];
}

export function createGame(setups: PlayerSetup[], seed: number): GameState {
  if (setups.length < 1 || setups.length > MAX_PLAYERS) {
    throw new Error(`Uma partida precisa de 1 a ${MAX_PLAYERS} jogadores`);
  }
  const state: GameState = {
    tick: 0,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    tiles: [],
    players: [],
    bombs: [],
    flames: [],
    powerUps: [],
    phase: 'playing',
    winner: null,
    endTicks: 0,
    rngState: seed >>> 0,
    nextBombId: 1,
  };
  state.tiles = generateTiles(state);
  state.players = setups.map((setup, slot) => {
    const [sx, sy] = spawnPoint(state.width, state.height, slot);
    return {
      id: setup.id,
      name: setup.name,
      slot,
      color: setup.color ?? slot,
      x: sx + 0.5,
      y: sy + 0.5,
      alive: true,
      speed: BASE_SPEED,
      range: BASE_RANGE,
      maxBombs: BASE_BOMBS,
      facing: 'down',
    };
  });
  return state;
}

function generateTiles(state: GameState): Tile[] {
  const { width, height } = state;
  const safe = new Set<number>();
  for (let slot = 0; slot < MAX_PLAYERS; slot++) {
    const [sx, sy] = spawnPoint(width, height, slot);
    for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      safe.add((sy + oy) * width + sx + ox);
    }
  }
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      if (border || pillar) tiles.push('wall');
      else if (safe.has(y * width + x)) tiles.push('empty');
      else tiles.push(nextRandom(state) < BLOCK_DENSITY ? 'block' : 'empty');
    }
  }
  return tiles;
}

export function tileAt(state: GameState, x: number, y: number): Tile {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return 'wall';
  return state.tiles[y * state.width + x];
}

export function bombAt(state: GameState, x: number, y: number): Bomb | undefined {
  return state.bombs.find((bomb) => bomb.x === x && bomb.y === y);
}

export function flameAt(state: GameState, x: number, y: number): boolean {
  return state.flames.some((flame) => flame.x === x && flame.y === y);
}

export function playerCell(player: Player): [number, number] {
  return [Math.floor(player.x), Math.floor(player.y)];
}

function isWalkable(state: GameState, x: number, y: number, playerId: string): boolean {
  if (tileAt(state, x, y) !== 'empty') return false;
  const bomb = bombAt(state, x, y);
  return !bomb || bomb.passable.includes(playerId);
}

export function step(state: GameState, inputs: Partial<Record<string, PlayerInput>>): Phase {
  if (state.phase === 'ended') return state.phase;
  state.tick++;
  for (const player of state.players) {
    const input = inputs[player.id];
    if (!player.alive || !input) continue;
    if (input.bomb) placeBomb(state, player);
    if (input.dir) movePlayer(state, player, input.dir);
  }
  refreshBombPassage(state);
  tickFlames(state);
  tickBombs(state);
  collectPowerUps(state);
  applyFlameDamage(state);
  updatePhase(state);
  return state.phase;
}

function placeBomb(state: GameState, player: Player): void {
  const [x, y] = playerCell(player);
  const active = state.bombs.filter((bomb) => bomb.owner === player.id).length;
  if (active >= player.maxBombs || bombAt(state, x, y)) return;
  const passable = state.players
    .filter((other) => other.alive && playerCell(other)[0] === x && playerCell(other)[1] === y)
    .map((other) => other.id);
  state.bombs.push({
    id: state.nextBombId++,
    owner: player.id,
    x,
    y,
    ticksLeft: BOMB_FUSE_TICKS,
    range: player.range,
    passable,
  });
}

function movePlayer(state: GameState, player: Player, dir: Direction): void {
  player.facing = dir;
  const { dx, dy } = DIRECTIONS[dir];
  const horizontal = dx !== 0;
  const sign = horizontal ? dx : dy;
  let along = horizontal ? player.x : player.y;
  let across = horizontal ? player.y : player.x;
  const cellAlong = Math.floor(along);
  const cellAcross = Math.floor(across);
  const offset = across - (cellAcross + 0.5);

  const walkable = (alongCell: number, acrossCell: number) =>
    horizontal
      ? isWalkable(state, alongCell, acrossCell, player.id)
      : isWalkable(state, acrossCell, alongCell, player.id);

  let lane: number | null = null;
  if (walkable(cellAlong + sign, cellAcross)) {
    lane = cellAcross;
  } else if (Math.abs(offset) > CORNER_ASSIST) {
    const neighbor = cellAcross + Math.sign(offset);
    if (walkable(cellAlong + sign, neighbor) && walkable(cellAlong, neighbor)) lane = neighbor;
  }

  let remaining = player.speed / TICK_RATE;
  if (lane !== null) {
    const delta = lane + 0.5 - across;
    if (Math.abs(delta) > EPSILON) {
      const slide = Math.min(remaining, Math.abs(delta));
      across += Math.sign(delta) * slide;
      remaining -= slide;
      if (Math.abs(lane + 0.5 - across) <= EPSILON) across = lane + 0.5;
    }
    if (across === lane + 0.5) along += sign * remaining;
  } else {
    const delta = cellAlong + 0.5 - along;
    if (sign * delta > 0) along += sign * Math.min(remaining, Math.abs(delta));
  }

  if (horizontal) {
    player.x = along;
    player.y = across;
  } else {
    player.x = across;
    player.y = along;
  }
}

function refreshBombPassage(state: GameState): void {
  for (const bomb of state.bombs) {
    bomb.passable = bomb.passable.filter((id) => {
      const player = state.players.find((candidate) => candidate.id === id);
      if (!player || !player.alive) return false;
      const [x, y] = playerCell(player);
      return x === bomb.x && y === bomb.y;
    });
  }
}

function tickFlames(state: GameState): void {
  for (const flame of state.flames) flame.ticksLeft--;
  state.flames = state.flames.filter((flame) => flame.ticksLeft > 0);
}

function tickBombs(state: GameState): void {
  for (const bomb of state.bombs) bomb.ticksLeft--;
  const triggered = state.bombs.filter((bomb) => bomb.ticksLeft <= 0 || flameAt(state, bomb.x, bomb.y));
  if (triggered.length > 0) explode(state, triggered);
}

function igniteCell(state: GameState, x: number, y: number): void {
  const existing = state.flames.find((flame) => flame.x === x && flame.y === y);
  if (existing) existing.ticksLeft = FLAME_TICKS;
  else state.flames.push({ x, y, ticksLeft: FLAME_TICKS });
}

function explode(state: GameState, initial: Bomb[]): void {
  const queue = [...initial];
  const exploded = new Set<number>();
  const destroyed: { x: number; y: number }[] = [];

  while (queue.length > 0) {
    const bomb = queue.shift()!;
    if (exploded.has(bomb.id)) continue;
    exploded.add(bomb.id);
    igniteCell(state, bomb.x, bomb.y);

    for (const { dx, dy } of Object.values(DIRECTIONS)) {
      for (let distance = 1; distance <= bomb.range; distance++) {
        const x = bomb.x + dx * distance;
        const y = bomb.y + dy * distance;
        const tile = tileAt(state, x, y);
        if (tile === 'wall') break;
        if (tile === 'block') {
          state.tiles[y * state.width + x] = 'empty';
          destroyed.push({ x, y });
          igniteCell(state, x, y);
          break;
        }
        igniteCell(state, x, y);
        const chained = bombAt(state, x, y);
        if (chained && !exploded.has(chained.id)) {
          queue.push(chained);
          break;
        }
        const powerUpIndex = state.powerUps.findIndex((item) => item.x === x && item.y === y);
        if (powerUpIndex >= 0) {
          state.powerUps.splice(powerUpIndex, 1);
          break;
        }
      }
    }
  }

  state.bombs = state.bombs.filter((bomb) => !exploded.has(bomb.id));
  for (const cell of destroyed) {
    if (nextRandom(state) < POWERUP_CHANCE) {
      const kind = POWERUP_KINDS[Math.floor(nextRandom(state) * POWERUP_KINDS.length)];
      state.powerUps.push({ ...cell, kind });
    }
  }
}

function collectPowerUps(state: GameState): void {
  for (const player of state.players) {
    if (!player.alive) continue;
    const [x, y] = playerCell(player);
    const index = state.powerUps.findIndex((item) => item.x === x && item.y === y);
    if (index < 0) continue;
    const [item] = state.powerUps.splice(index, 1);
    if (item.kind === 'bomb') player.maxBombs = Math.min(MAX_BOMBS, player.maxBombs + 1);
    if (item.kind === 'range') player.range = Math.min(MAX_RANGE, player.range + 1);
    if (item.kind === 'speed') player.speed = Math.min(MAX_SPEED, player.speed + SPEED_STEP);
  }
}

function applyFlameDamage(state: GameState): void {
  for (const player of state.players) {
    if (!player.alive) continue;
    const [x, y] = playerCell(player);
    if (flameAt(state, x, y)) player.alive = false;
  }
}

function updatePhase(state: GameState): void {
  const survivors = state.players.filter((player) => player.alive);
  if (state.phase === 'playing') {
    const threshold = state.players.length > 1 ? 1 : 0;
    if (survivors.length <= threshold) {
      state.phase = 'ending';
      state.endTicks = ROUND_END_TICKS;
    }
    return;
  }
  state.endTicks--;
  if (state.endTicks > 0) return;
  state.phase = 'ended';
  state.winner = state.players.length > 1 && survivors.length === 1 ? survivors[0].id : null;
}
