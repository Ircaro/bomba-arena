import { describe, expect, it } from 'vitest';
import {
  BASE_RANGE,
  BOMB_FUSE_TICKS,
  ROUND_END_TICKS,
  createGame,
  createMatch,
  flameAt,
  spawnPoint,
  startNextRound,
  step,
  stepMatch,
  tileAt,
  type GameState,
  type PlayerInput,
} from '../src';

const setups = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `Jogador ${index + 1}` }));

function emptyArena(count = 2, seed = 1): GameState {
  const state = createGame(setups(count), seed);
  state.tiles = state.tiles.map((tile) => (tile === 'block' ? 'empty' : tile));
  return state;
}

function run(state: GameState, ticks: number, inputs: Record<string, PlayerInput> = {}): void {
  for (let i = 0; i < ticks; i++) step(state, inputs);
}

function runUntil(state: GameState, done: () => boolean, limit = 1000): void {
  for (let i = 0; i < limit && !done(); i++) step(state, {});
}

const move = (dir: PlayerInput['dir']): PlayerInput => ({ dir, bomb: false });
const bomb: PlayerInput = { dir: null, bomb: true };

describe('mapa', () => {
  it('gera bordas e pilares fixos com cantos de spawn livres', () => {
    const state = createGame(setups(4), 42);
    for (let x = 0; x < state.width; x++) {
      expect(tileAt(state, x, 0)).toBe('wall');
      expect(tileAt(state, x, state.height - 1)).toBe('wall');
    }
    expect(tileAt(state, 2, 2)).toBe('wall');
    expect(tileAt(state, 4, 6)).toBe('wall');
    for (let slot = 0; slot < 4; slot++) {
      const [sx, sy] = spawnPoint(state.width, state.height, slot);
      expect(tileAt(state, sx, sy)).toBe('empty');
      expect(tileAt(state, sx + (sx === 1 ? 1 : -1), sy)).toBe('empty');
      expect(tileAt(state, sx, sy + (sy === 1 ? 1 : -1))).toBe('empty');
    }
  });

  it('é determinístico pela semente', () => {
    expect(createGame(setups(2), 7).tiles).toEqual(createGame(setups(2), 7).tiles);
    expect(createGame(setups(2), 7).tiles).not.toEqual(createGame(setups(2), 8).tiles);
  });
});

describe('movimento', () => {
  it('para no centro da célula ao encostar numa parede', () => {
    const state = emptyArena();
    run(state, 20, { p1: move('up') });
    expect(state.players[0].x).toBe(1.5);
    expect(state.players[0].y).toBe(1.5);
  });

  it('não atravessa pilar quando está alinhado', () => {
    const state = emptyArena();
    state.players[0].y = 2.5;
    run(state, 20, { p1: move('right') });
    expect(state.players[0].x).toBe(1.5);
  });

  it('desliza pra dentro do corredor quando está perto da quina', () => {
    const state = emptyArena();
    state.players[0].y = 2.3;
    run(state, 30, { p1: move('right') });
    expect(state.players[0].y).toBeCloseTo(1.5);
    expect(state.players[0].x).toBeGreaterThan(2);
  });
});

describe('bombas', () => {
  it('respeita o limite de bombas e não empilha na mesma célula', () => {
    const state = emptyArena();
    const player = state.players[0];
    player.maxBombs = 3;
    step(state, { p1: bomb });
    step(state, { p1: bomb });
    expect(state.bombs).toHaveLength(1);

    player.maxBombs = 1;
    run(state, 25, { p1: move('right') });
    step(state, { p1: bomb });
    expect(state.bombs).toHaveLength(1);
  });

  it('deixa o dono sair da própria bomba mas não voltar', () => {
    const state = emptyArena();
    step(state, { p1: bomb });
    run(state, 25, { p1: move('right') });
    expect(state.bombs[0].passable).toEqual([]);
    run(state, 20, { p1: move('left') });
    expect(state.players[0].x).toBeCloseTo(2.5);
  });

  it('explode em cruz respeitando alcance e paredes', () => {
    const state = emptyArena();
    step(state, { p1: bomb });
    runUntil(state, () => state.bombs.length === 0);
    expect(state.tick).toBe(BOMB_FUSE_TICKS);
    const cells = state.flames.map((flame) => `${flame.x},${flame.y}`).sort();
    expect(cells).toEqual(['1,1', '1,2', '1,3', '2,1', '3,1'].sort());
    expect(BASE_RANGE).toBe(2);
  });

  it('destrói só o primeiro bloco no caminho', () => {
    const state = emptyArena();
    state.players[0].range = 4;
    state.tiles[1 * state.width + 3] = 'block';
    state.tiles[1 * state.width + 4] = 'block';
    step(state, { p1: bomb });
    runUntil(state, () => state.bombs.length === 0);
    expect(tileAt(state, 3, 1)).toBe('empty');
    expect(tileAt(state, 4, 1)).toBe('block');
    expect(flameAt(state, 3, 1)).toBe(true);
    expect(flameAt(state, 4, 1)).toBe(false);
  });

  it('detona outras bombas em cadeia', () => {
    const state = emptyArena();
    state.bombs.push({ id: 99, owner: 'p2', x: 3, y: 1, ticksLeft: 10_000, range: 1, passable: [] });
    step(state, { p1: bomb });
    runUntil(state, () => state.bombs.length === 0);
    expect(state.tick).toBe(BOMB_FUSE_TICKS);
    expect(flameAt(state, 4, 1)).toBe(true);
    expect(flameAt(state, 3, 2)).toBe(true);
  });
});

describe('power-ups', () => {
  it('coleta e aplica o bônus', () => {
    const state = emptyArena();
    state.powerUps.push({ x: 2, y: 1, kind: 'range' });
    state.powerUps.push({ x: 3, y: 1, kind: 'bomb' });
    state.powerUps.push({ x: 4, y: 1, kind: 'speed' });
    const before = state.players[0].speed;
    run(state, 60, { p1: move('right') });
    expect(state.players[0].range).toBe(3);
    expect(state.players[0].maxBombs).toBe(2);
    expect(state.players[0].speed).toBeGreaterThan(before);
    expect(state.powerUps).toEqual([]);
  });
});

describe('fim de rodada', () => {
  it('mata quem está na chama e declara o sobrevivente vencedor', () => {
    const state = emptyArena();
    step(state, { p1: bomb });
    runUntil(state, () => state.bombs.length === 0);
    expect(state.players[0].alive).toBe(false);
    expect(state.phase).toBe('ending');
    run(state, ROUND_END_TICKS);
    expect(state.phase).toBe('ended');
    expect(state.winner).toBe('p2');
  });

  it('declara empate quando ninguém sobrevive', () => {
    const state = emptyArena();
    state.players[1].x = 2.5;
    state.players[1].y = 1.5;
    step(state, { p1: bomb });
    runUntil(state, () => state.phase === 'ended');
    expect(state.winner).toBeNull();
  });
});

describe('partida', () => {
  it('conta vitórias até definir o campeão e reinicia o placar', () => {
    const match = createMatch(setups(2), 5, 2);
    for (let round = 0; round < 2; round++) {
      match.game.players[0].alive = false;
      for (let i = 0; i < ROUND_END_TICKS + 5; i++) stepMatch(match, {});
      expect(match.game.phase).toBe('ended');
      if (round === 0) {
        expect(match.champion).toBeNull();
        const previous = match.game.tiles;
        startNextRound(match);
        expect(match.round).toBe(2);
        expect(match.game.tiles).not.toEqual(previous);
      }
    }
    expect(match.wins.p2).toBe(2);
    expect(match.champion).toBe('p2');
    startNextRound(match);
    expect(match.round).toBe(1);
    expect(match.wins).toEqual({ p1: 0, p2: 0 });
    expect(match.champion).toBeNull();
  });
});
