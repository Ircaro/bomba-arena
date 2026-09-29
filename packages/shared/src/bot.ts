import { BOMB_FUSE_TICKS, FLAME_TICKS, TICK_RATE } from './constants';
import { DIRECTIONS, playerCell, tileAt } from './game';
import type { Bomb, Direction, GameState, Player, PlayerInput } from './types';

const ORDER: Direction[] = ['up', 'down', 'left', 'right'];
const IDLE: PlayerInput = { dir: null, bomb: false };

export interface BotMemory {
  cooldown: number;
  aggression: number;
}

export function createBotMemory(random: () => number): BotMemory {
  return { cooldown: 0, aggression: 0.05 + random() * 0.05 };
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
}

function search(
  state: GameState,
  bot: Player,
  bombs: readonly Bomb[],
  isGoal: (cell: number, steps: number) => boolean,
  passable: (cell: number, distance: number) => boolean,
): Search | null {
  const [sx, sy] = playerCell(bot);
  const start = index(state, sx, sy);
  const visited = new Set<number>([start]);
  const queue: { cell: number; x: number; y: number; steps: number; distance: number; first: Direction | null }[] = [
    { cell: start, x: sx, y: sy, steps: 0, distance: 0, first: null },
  ];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break;
    if (isGoal(node.cell, node.steps)) return { firstStep: node.first, steps: node.steps, cell: node.cell };
    for (const dir of ORDER) {
      const { dx, dy } = DIRECTIONS[dir];
      const x = node.x + dx;
      const y = node.y + dy;
      const cell = index(state, x, y);
      if (visited.has(cell) || blocked(state, bombs, x, y)) continue;
      const distance = node.steps === 0 ? Math.abs(x + 0.5 - bot.x) + Math.abs(y + 0.5 - bot.y) : node.distance + 1;
      if (!passable(cell, distance)) continue;
      visited.add(cell);
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

function safeToBomb(state: GameState, bot: Player): boolean {
  const [x, y] = playerCell(bot);
  if (state.bombs.some((bomb) => bomb.x === x && bomb.y === y)) return false;
  const bombs: Bomb[] = [
    ...state.bombs,
    { id: -1, owner: bot.id, x, y, ticksLeft: BOMB_FUSE_TICKS, range: bot.range, passable: [bot.id] },
  ];
  const danger = dangerMap(state, bombs);
  return escape(state, bot, bombs, danger) !== null;
}

export function botInput(state: GameState, id: string, memory: BotMemory, random: () => number): PlayerInput {
  const bot = state.players.find((player) => player.id === id);
  if (!bot || !bot.alive || state.phase === 'ended') return IDLE;
  const danger = dangerMap(state, state.bombs);
  const [x, y] = playerCell(bot);
  const here = index(state, x, y);

  if (threatened(danger, here)) {
    const route = escape(state, bot, state.bombs, danger);
    if (route?.firstStep) return { dir: route.firstStep, bomb: false };
    return IDLE;
  }

  if (memory.cooldown > 0) memory.cooldown--;
  if (state.phase !== 'playing') return IDLE;

  const canBomb = state.bombs.filter((bomb) => bomb.owner === bot.id).length < bot.maxBombs && memory.cooldown === 0;
  const bomb = (): PlayerInput => {
    memory.cooldown = Math.round(TICK_RATE * (0.3 + random() * 0.4));
    return { dir: null, bomb: true };
  };
  if (canBomb && bombValue(state, bot, x, y) >= 4 && random() < memory.aggression * 3 && safeToBomb(state, bot)) return bomb();

  const avoid = (cell: number) => !threatened(danger, cell);
  const powerUps = new Set(state.powerUps.map((item) => index(state, item.x, item.y)));
  const toPowerUp = search(state, bot, state.bombs, (cell, steps) => steps > 0 && powerUps.has(cell), avoid);
  if (toPowerUp?.firstStep && toPowerUp.steps <= 6) return { dir: toPowerUp.firstStep, bomb: false };

  const foes = enemies(state, bot).map((enemy) => playerCell(enemy));
  const foeCells = new Set(foes.map(([ex, ey]) => index(state, ex, ey)));
  const hunt = search(state, bot, state.bombs, (cell, steps) => steps > 0 && foeCells.has(cell), avoid);
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
    if (bombValue(state, bot, cell % state.width, Math.floor(cell / state.width)) <= 0) return false;
    const score = steps + 2 * (foes.length > 0 ? nearestFoe(cell) : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { firstStep: null, steps, cell };
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
