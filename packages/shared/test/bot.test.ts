import { describe, expect, it } from 'vitest';
import {
  blastCells,
  botInput,
  createBotMemory,
  createGame,
  nextRandom,
  step,
  type BotDifficulty,
  type GameState,
  type PlayerInput,
} from '../src';

function seeded(seed: number): () => number {
  const holder = { rngState: seed };
  return () => nextRandom(holder);
}

function emptyArena(players = 2, seed = 4): GameState {
  const setups = Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `Jogador ${i + 1}` }));
  const state = createGame(setups, seed);
  state.tiles = state.tiles.map((tile) => (tile === 'block' ? 'empty' : tile));
  return state;
}

function runUntilExplosion(state: GameState): string[] {
  for (let i = 0; i < 400 && state.bombs.length > 0; i++) step(state, {});
  return state.flames.map((flame) => `${flame.x},${flame.y}`).sort();
}

function predicted(state: GameState): string[] {
  const cells = new Set<number>();
  for (const bomb of state.bombs) for (const cell of blastCells(state, bomb)) cells.add(cell);
  return [...cells].map((cell) => `${cell % state.width},${Math.floor(cell / state.width)}`).sort();
}

describe('previsão de explosão do bot', () => {
  it('bate com a explosão real, com caixa, power-up e reação em cadeia', () => {
    const layouts: ((state: GameState) => void)[] = [
      (state) => {
        state.tiles[1 * state.width + 4] = 'block';
        state.bombs.push({ id: 1, owner: 'p2', x: 3, y: 3, ticksLeft: 5, range: 3, passable: [] });
      },
      (state) => {
        state.powerUps.push({ x: 5, y: 3, kind: 'range' });
        state.bombs.push({ id: 1, owner: 'p2', x: 3, y: 3, ticksLeft: 5, range: 4, passable: [] });
      },
      (state) => {
        state.bombs.push({ id: 1, owner: 'p2', x: 3, y: 3, ticksLeft: 5, range: 2, passable: [] });
        state.bombs.push({ id: 2, owner: 'p2', x: 5, y: 3, ticksLeft: 100, range: 2, passable: [] });
      },
    ];
    for (const layout of layouts) {
      const state = emptyArena();
      state.players[0].x = 13.5;
      state.players[0].y = 1.5;
      state.players[1].x = 13.5;
      state.players[1].y = 11.5;
      layout(state);
      const expected = predicted(state);
      expect(runUntilExplosion(state)).toEqual(expected);
    }
  });
});

describe('comportamento do bot', () => {
  it('foge de uma bomba prestes a explodir', () => {
    const state = emptyArena();
    const random = seeded(1);
    const memory = createBotMemory(random);
    state.bombs.push({ id: 9, owner: 'p2', x: 1, y: 1, ticksLeft: 60, range: 3, passable: ['p1'] });
    for (let i = 0; i < 100; i++) step(state, { p1: botInput(state, 'p1', memory, random) });
    expect(state.players[0].alive).toBe(true);
  });

  it('sobrevive sozinho enquanto abre caminho pelas caixas', () => {
    for (const seed of [1, 2, 3]) {
      const state = createGame([{ id: 'bot', name: 'Bot' }], seed);
      const blocksBefore = state.tiles.filter((tile) => tile === 'block').length;
      const random = seeded(seed);
      const memory = createBotMemory(random);
      for (let i = 0; i < 60 * 60; i++) step(state, { bot: botInput(state, 'bot', memory, random) });
      const blocksAfter = state.tiles.filter((tile) => tile === 'block').length;
      expect(state.players[0].alive).toBe(true);
      expect(blocksBefore - blocksAfter).toBeGreaterThanOrEqual(8);
    }
  });

  it('derrota um adversário parado', () => {
    for (const seed of [5, 6, 7]) {
      const state = createGame(
        [
          { id: 'bot', name: 'Bot' },
          { id: 'alvo', name: 'Alvo' },
        ],
        seed,
      );
      const random = seeded(seed);
      const memory = createBotMemory(random);
      const idle: PlayerInput = { dir: null, bomb: false };
      for (let i = 0; i < 60 * 180 && state.phase !== 'ended'; i++) {
        step(state, { bot: botInput(state, 'bot', memory, random), alvo: idle });
      }
      expect(state.players[1].alive).toBe(false);
      expect(state.winner).toBe('bot');
    }
  });

  it('sobrevive sozinho em qualquer dificuldade', () => {
    const levels: BotDifficulty[] = ['facil', 'medio', 'dificil'];
    for (const level of levels) {
      for (const seed of [11, 12]) {
        const state = createGame([{ id: 'bot', name: 'Bot' }], seed);
        const random = seeded(seed);
        const memory = createBotMemory(random, level);
        for (let i = 0; i < 60 * 45; i++) step(state, { bot: botInput(state, 'bot', memory, random) });
        expect(state.players[0].alive).toBe(true);
      }
    }
  });

  it('no fácil, demora a reagir à bomba de outro jogador', () => {
    const reactions: Record<string, number> = {};
    for (const level of ['facil', 'dificil'] as BotDifficulty[]) {
      const state = emptyArena(1);
      const random = seeded(3);
      const memory = createBotMemory(random, level);
      state.bombs.push({ id: 9, owner: 'p2', x: 2, y: 1, ticksLeft: 150, range: 2, passable: [] });
      let tick = 0;
      for (; tick < 150 && state.players[0].x === 1.5 && state.players[0].y === 1.5; tick++) {
        step(state, { p1: botInput(state, 'p1', memory, random) });
      }
      reactions[level] = tick;
    }
    expect(reactions.dificil).toBeLessThanOrEqual(15);
    expect(reactions.facil).toBeGreaterThanOrEqual(50);
  });

  it('no fácil, nunca tem mais de uma bomba no campo', () => {
    const state = createGame([{ id: 'bot', name: 'Bot' }], 8);
    state.players[0].maxBombs = 4;
    const random = seeded(8);
    const memory = createBotMemory(random, 'facil');
    let most = 0;
    for (let i = 0; i < 60 * 60; i++) {
      step(state, { bot: botInput(state, 'bot', memory, random) });
      most = Math.max(most, state.bombs.length);
    }
    expect(most).toBe(1);
  });

  it('no fácil, poupa um adversário parado', () => {
    for (const seed of [5, 6]) {
      const state = createGame(
        [
          { id: 'bot', name: 'Bot' },
          { id: 'alvo', name: 'Alvo' },
        ],
        seed,
      );
      const random = seeded(seed);
      const memory = createBotMemory(random, 'facil');
      for (let i = 0; i < 60 * 90 && state.phase !== 'ended'; i++) {
        step(state, { bot: botInput(state, 'bot', memory, random), alvo: { dir: null, bomb: false } });
      }
      expect(state.players[1].alive).toBe(true);
    }
  });

  it('no difícil, derrota um adversário parado', () => {
    for (const seed of [5, 6]) {
      const state = createGame(
        [
          { id: 'bot', name: 'Bot' },
          { id: 'alvo', name: 'Alvo' },
        ],
        seed,
      );
      const random = seeded(seed);
      const memory = createBotMemory(random, 'dificil');
      for (let i = 0; i < 60 * 150 && state.phase !== 'ended'; i++) {
        step(state, { bot: botInput(state, 'bot', memory, random), alvo: { dir: null, bomb: false } });
      }
      expect(state.winner).toBe('bot');
    }
  });
});
