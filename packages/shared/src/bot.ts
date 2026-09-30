import { BOMB_FUSE_TICKS, FLAME_TICKS, TICK_RATE } from './constants';
import { DIRECTIONS, playerCell, tileAt } from './game';
import type { Bomb, Direction, GameState, Player, PlayerInput } from './types';

const ORDER: Direction[] = ['up', 'down', 'left', 'right'];
const IDLE: PlayerInput = { dir: null, bomb: false };

export type BotDifficulty = 'facil' | 'medio' | 'dificil';

interface BotProfile {
  aggression: [number, number];
  thinkEvery: number;
  powerUpReach: number;
  cooldown: [number, number];
  trapChance: number;
  reaction: [number, number];
  hunts: boolean;
  foeBias: number;
  bombCap: number;
  spares: boolean;
  hesitate: number;
}

const PROFILES: Record<BotDifficulty, BotProfile> = {
  facil: { aggression: [0, 0], thinkEvery: 10, powerUpReach: 0, cooldown: [1.6, 2.6], trapChance: 0, reaction: [1.4, 1.8], hunts: false, foeBias: 0, bombCap: 1, spares: true, hesitate: 0.35 },
  medio: { aggression: [0.04, 0.08], thinkEvery: 0, powerUpReach: 6, cooldown: [0.45, 0.85], trapChance: 0.05, reaction: [0.3, 0.45], hunts: true, foeBias: 2, bombCap: 2, spares: false, hesitate: 0 },
  dificil: { aggression: [0.2, 0.3], thinkEvery: 0, powerUpReach: 10, cooldown: [0.25, 0.5], trapChance: 0.5, reaction: [0.08, 0.15], hunts: true, foeBias: 2, bombCap: 3, spares: false, hesitate: 0 },
};

export interface BotMemory {
  cooldown: number;
  aggression: number;
  thinkEvery: number;
  thinkIn: number;
  lastDir: Direction | null;
  powerUpReach: number;
  cooldownRange: [number, number];
  trapChance: number;
  reaction: number;
  hunts: boolean;
  foeBias: number;
  bombCap: number;
  spares: boolean;
  hesitate: number;
}

export function createBotMemory(random: () => number, difficulty: BotDifficulty = 'medio'): BotMemory {
  const profile = PROFILES[difficulty];
  const [low, high] = profile.aggression;
  return {
    cooldown: 0,
    aggression: low + random() * (high - low),
    thinkEvery: profile.thinkEvery,
    thinkIn: 0,
    lastDir: null,
    powerUpReach: profile.powerUpReach,
    cooldownRange: profile.cooldown,
    trapChance: profile.trapChance,
    reaction: Math.round(TICK_RATE * (profile.reaction[0] + random() * (profile.reaction[1] - profile.reaction[0]))),
    hunts: profile.hunts,
    foeBias: profile.foeBias,
    bombCap: profile.bombCap,
    spares: profile.spares,
    hesitate: profile.hesitate,
  };
}

interface Danger {
  explodeAt: number[];
  burningUntil: number[];
}

function index(state: GameState, x: number, y: number): number {
  return y * state.width + x;
}

export function blastCells(
  state: GameState,
  bomb: Pick<Bomb, 'x' | 'y' | 'range'>,
  bombs: readonly Bomb[] = state.bombs,
  powerUpsStop = true,
): number[] {
  const cells = [index(state, bomb.x, bomb.y)];
  for (const dir of ORDER) {
    const { dx, dy } = DIRECTIONS[dir];
    for (let distance = 1; distance <= bomb.range; distance++) {
      const x = bomb.x + dx * distance;
      const y = bomb.y + dy * distance;
      const tile = tileAt(state, x, y);
      if (tile === 'wall') break;
      cells.push(index(state, x, y));
      if (tile === 'block') break;
      if (bombs.some((other) => other.x === x && other.y === y)) break;
      if (powerUpsStop && state.powerUps.some((item) => item.x === x && item.y === y)) break;
    }
  }
  return cells;
}

function dangerMap(state: GameState, bombs: readonly Bomb[]): Danger {
  const size = state.width * state.height;
  const explodeAt = new Array<number>(size).fill(Infinity);
  const burningUntil = new Array<number>(size).fill(-1);
  for (const flame of state.flames) burningUntil[index(state, flame.x, flame.y)] = flame.ticksLeft;

  const times = bombs.map((bomb) => bomb.ticksLeft);
  const blasts = bombs.map((bomb) => blastCells(state, bomb, bombs, false));
  let changed = true;
  while (changed) {
    changed = false;
    blasts.forEach((cells, i) => {
      for (const cell of cells) {
        bombs.forEach((other, j) => {
          if (j !== i && index(state, other.x, other.y) === cell && times[j] > times[i]) {
            times[j] = times[i];
            changed = true;
          }
        });
      }
    });
  }
  blasts.forEach((cells, i) => {
    for (const cell of cells) explodeAt[cell] = Math.min(explodeAt[cell], times[i]);
  });
  return { explodeAt, burningUntil };
}

function threatened(danger: Danger, cell: number): boolean {
  return danger.explodeAt[cell] !== Infinity || danger.burningUntil[cell] > 0;
}

const SAFETY_TICKS = 3;

function deadlyDuring(danger: Danger, cell: number, enter: number, leave: number): boolean {
  if (danger.burningUntil[cell] > enter) return true;
  const at = danger.explodeAt[cell];
  return at !== Infinity && leave + SAFETY_TICKS >= at && enter <= at + FLAME_TICKS;
}

function blocked(state: GameState, bombs: readonly Bomb[], x: number, y: number): boolean {
  return tileAt(state, x, y) !== 'empty' || bombs.some((bomb) => bomb.x === x && bomb.y === y);
}

interface Search {
  firstStep: Direction | null;
  steps: number;
  cell: number;
  path: number[];
}

function search(
  state: GameState,
  bot: Player,
  bombs: readonly Bomb[],
  isGoal: (cell: number, steps: number) => boolean,
  passable: (cell: number, distance: number) => boolean,
  onlyFirst: Direction | null = null,
): Search | null {
  const [sx, sy] = playerCell(bot);
  const start = index(state, sx, sy);
  const visited = new Set<number>([start]);
  const parents = new Map<number, number>();
  const pathTo = (cell: number): number[] => {
    const cells: number[] = [];
    for (let current: number | undefined = cell; current !== undefined && current !== start; current = parents.get(current)) cells.unshift(current);
    return cells;
  };
  const queue: { cell: number; x: number; y: number; steps: number; distance: number; first: Direction | null }[] = [
    { cell: start, x: sx, y: sy, steps: 0, distance: 0, first: null },
  ];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break;
    if (isGoal(node.cell, node.steps)) return { firstStep: node.first, steps: node.steps, cell: node.cell, path: pathTo(node.cell) };
    for (const dir of ORDER) {
      if (node.steps === 0 && onlyFirst && dir !== onlyFirst) continue;
      const { dx, dy } = DIRECTIONS[dir];
      const x = node.x + dx;
      const y = node.y + dy;
      const cell = index(state, x, y);
      if (visited.has(cell) || blocked(state, bombs, x, y)) continue;
      const distance = node.steps === 0 ? Math.abs(x + 0.5 - bot.x) + Math.abs(y + 0.5 - bot.y) : node.distance + 1;
      if (!passable(cell, distance)) continue;
      visited.add(cell);
      parents.set(cell, node.cell);
      queue.push({ cell, x, y, steps: node.steps + 1, distance, first: node.first ?? dir });
    }
  }
  return null;
}

function escape(state: GameState, bot: Player, bombs: readonly Bomb[], danger: Danger): Search | null {
  const ticksPerCell = TICK_RATE / bot.speed;
  return search(
    state,
    bot,
    bombs,
    (cell) => !threatened(danger, cell),
    (cell, distance) => !deadlyDuring(danger, cell, (distance - 0.5) * ticksPerCell, (distance + 0.7) * ticksPerCell),
  );
}

function enemies(state: GameState, bot: Player): Player[] {
  return state.players.filter((player) => player.alive && player.id !== bot.id);
}

function bombValue(state: GameState, bot: Player, x: number, y: number): number {
  let value = 0;
  const cells = blastCells(state, { x, y, range: bot.range });
  for (const cell of cells) {
    if (state.tiles[cell] === 'block') value += 1;
  }
  for (const enemy of enemies(state, bot)) {
    const [ex, ey] = playerCell(enemy);
    if (cells.includes(index(state, ex, ey))) value += 4;
  }
  return value;
}

function withBomb(state: GameState, bot: Player): { bombs: Bomb[]; danger: Danger } | null {
  const [x, y] = playerCell(bot);
  if (state.bombs.some((bomb) => bomb.x === x && bomb.y === y)) return null;
  const passable = state.players
    .filter((player) => player.alive && playerCell(player)[0] === x && playerCell(player)[1] === y)
    .map((player) => player.id);
  const bombs: Bomb[] = [
    ...state.bombs,
    { id: -1, owner: bot.id, x, y, ticksLeft: BOMB_FUSE_TICKS, range: bot.range, passable },
  ];
  return { bombs, danger: dangerMap(state, bombs) };
}

const CROWDED_DISTANCE = 5;

function routesByDirection(state: GameState, bot: Player, bombs: readonly Bomb[], danger: Danger): Search[] {
  const ticksPerCell = TICK_RATE / bot.speed;
  const routes: Search[] = [];
  for (const dir of ORDER) {
    const found = search(
      state,
      bot,
      bombs,
      (cell, steps) => steps > 0 && !threatened(danger, cell),
      (cell, distance) => !deadlyDuring(danger, cell, (distance - 0.5) * ticksPerCell, (distance + 0.7) * ticksPerCell),
      dir,
    );
    if (found) routes.push(found);
  }
  return routes.sort((a, b) => a.steps - b.steps);
}

function crowded(state: GameState, bot: Player): boolean {
  const [x, y] = playerCell(bot);
  return enemies(state, bot).some((enemy) => {
    const [ex, ey] = playerCell(enemy);
    return Math.abs(ex - x) + Math.abs(ey - y) <= CROWDED_DISTANCE;
  });
}

function stepsFrom(state: GameState, player: Player, bombs: readonly Bomb[]): Map<number, number> {
  const [sx, sy] = playerCell(player);
  const start = index(state, sx, sy);
  const distances = new Map<number, number>([[start, 0]]);
  const queue: [number, number, number][] = [[sx, sy, 0]];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break;
    const [x, y, steps] = node;
    for (const dir of ORDER) {
      const { dx, dy } = DIRECTIONS[dir];
      const nx = x + dx;
      const ny = y + dy;
      const cell = index(state, nx, ny);
      if (distances.has(cell) || blocked(state, bombs, nx, ny)) continue;
      distances.set(cell, steps + 1);
      queue.push([nx, ny, steps + 1]);
    }
  }
  return distances;
}

function blockable(state: GameState, bot: Player, bombs: readonly Bomb[], route: Search): boolean {
  const ticksPerCell = TICK_RATE / bot.speed;
  return enemies(state, bot).some((enemy) => {
    const enemyTicks = TICK_RATE / enemy.speed;
    const distances = stepsFrom(state, enemy, bombs);
    return route.path.some((cell, k) => {
      const reach = distances.get(cell);
      return reach !== undefined && reach * enemyTicks <= (k + 2) * ticksPerCell;
    });
  });
}

function bestEscape(state: GameState, bot: Player, bombs: readonly Bomb[], danger: Danger): Search | null {
  if (!crowded(state, bot)) return escape(state, bot, bombs, danger);
  const routes = routesByDirection(state, bot, bombs, danger);
  return routes.find((route) => !blockable(state, bot, bombs, route)) ?? routes[0] ?? null;
}

function canEscapeFrom(state: GameState, bot: Player, bombs: readonly Bomb[], danger: Danger): boolean {
  if (!crowded(state, bot)) return escape(state, bot, bombs, danger) !== null;
  const routes = routesByDirection(state, bot, bombs, danger);
  return routes.length >= 2 || routes.some((route) => !blockable(state, bot, bombs, route));
}

function safeToBomb(state: GameState, bot: Player): boolean {
  const planned = withBomb(state, bot);
  return planned !== null && canEscapeFrom(state, bot, planned.bombs, planned.danger);
}

function trapsEnemy(state: GameState, bot: Player): boolean {
  const planned = withBomb(state, bot);
  if (!planned || !canEscapeFrom(state, bot, planned.bombs, planned.danger)) return false;
  return enemies(state, bot).some((enemy) => {
    const [ex, ey] = playerCell(enemy);
    if (!threatened(planned.danger, index(state, ex, ey))) return false;
    return escape(state, enemy, planned.bombs, planned.danger) === null;
  });
}

export function botInput(state: GameState, id: string, memory: BotMemory, random: () => number): PlayerInput {
  const bot = state.players.find((player) => player.id === id);
  if (!bot || !bot.alive || state.phase === 'ended') return IDLE;
  const noticed =
    memory.reaction > 0
      ? state.bombs.filter((bomb) => bomb.owner === bot.id || BOMB_FUSE_TICKS - bomb.ticksLeft >= memory.reaction)
      : state.bombs;
  const danger = dangerMap(state, noticed);
  const [x, y] = playerCell(bot);
  const here = index(state, x, y);

  if (threatened(danger, here)) {
    const route = bestEscape(state, bot, state.bombs, danger);
    if (route?.firstStep) return { dir: route.firstStep, bomb: false };
    return IDLE;
  }

  if (memory.cooldown > 0) memory.cooldown--;
  if (state.phase !== 'playing') return IDLE;

  if (memory.thinkIn > 0) {
    memory.thinkIn--;
    return keepGoing(state, bot, danger, memory.lastDir);
  }
  const decision = memory.hesitate > 0 && random() < memory.hesitate ? IDLE : decide(state, bot, memory, random, danger);
  memory.lastDir = decision.dir;
  memory.thinkIn = memory.thinkEvery;
  return decision;
}

function keepGoing(state: GameState, bot: Player, danger: Danger, dir: Direction | null): PlayerInput {
  if (!dir) return IDLE;
  const [x, y] = playerCell(bot);
  const { dx, dy } = DIRECTIONS[dir];
  const nx = x + dx;
  const ny = y + dy;
  if (blocked(state, state.bombs, nx, ny) || threatened(danger, index(state, nx, ny))) return IDLE;
  return { dir, bomb: false };
}

function decide(state: GameState, bot: Player, memory: BotMemory, random: () => number, danger: Danger): PlayerInput {
  const [x, y] = playerCell(bot);
  const canBomb = state.bombs.filter((bomb) => bomb.owner === bot.id).length < Math.min(bot.maxBombs, memory.bombCap) && memory.cooldown === 0;
  const bomb = (): PlayerInput => {
    const [low, high] = memory.cooldownRange;
    memory.cooldown = Math.round(TICK_RATE * (low + random() * (high - low)));
    return { dir: null, bomb: true };
  };
  if (canBomb && memory.trapChance > 0 && random() < memory.trapChance && trapsEnemy(state, bot)) return bomb();
  if (canBomb && !memory.spares && bombValue(state, bot, x, y) >= 4 && random() < memory.aggression * 3 && safeToBomb(state, bot)) return bomb();

  const avoid = (cell: number) => !threatened(danger, cell);
  const powerUps = new Set(state.powerUps.map((item) => index(state, item.x, item.y)));
  const toPowerUp = search(state, bot, state.bombs, (cell, steps) => steps > 0 && powerUps.has(cell), avoid);
  if (toPowerUp?.firstStep && toPowerUp.steps <= memory.powerUpReach) return { dir: toPowerUp.firstStep, bomb: false };

  const foes = enemies(state, bot).map((enemy) => playerCell(enemy));
  const foeCells = new Set(foes.map(([ex, ey]) => index(state, ex, ey)));
  const hunt = memory.hunts ? search(state, bot, state.bombs, (cell, steps) => steps > 0 && foeCells.has(cell), avoid) : null;
  if (hunt?.firstStep) return { dir: hunt.firstStep, bomb: false };

  const nearestFoe = (cell: number) => {
    const cx = cell % state.width;
    const cy = Math.floor(cell / state.width);
    return foes.reduce((best, [ex, ey]) => Math.min(best, Math.abs(ex - cx) + Math.abs(ey - cy)), Infinity);
  };
  const bombHere = canBomb && safeToBomb(state, bot);
  let best: Search | null = null;
  let bestScore = Infinity;
  search(state, bot, state.bombs, (cell, steps) => {
    if (steps === 0 && !bombHere) return false;
    const value = bombValue(state, bot, cell % state.width, Math.floor(cell / state.width));
    if (value <= 0 || (memory.spares && value >= 4)) return false;
    const score = steps + memory.foeBias * (foes.length > 0 ? nearestFoe(cell) : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { firstStep: null, steps, cell, path: [] };
    }
    return false;
  }, avoid);
  const target = best as Search | null;
  if (target && target.steps === 0) return bomb();
  if (target) {
    const route = search(state, bot, state.bombs, (cell) => cell === target.cell, avoid);
    if (route?.firstStep) return { dir: route.firstStep, bomb: false };
  }
  return IDLE;
}
