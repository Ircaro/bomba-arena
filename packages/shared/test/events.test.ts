import { describe, expect, it } from 'vitest';
import {
  BOMB_FUSE_TICKS,
  EventTracker,
  FLAME_TICKS,
  ROUND_END_TICKS,
  createGame,
  step,
  type GameEvent,
  type GameState,
  type PlayerInput,
} from '../src';

const setups = [
  { id: 'p1', name: 'Jogador 1' },
  { id: 'p2', name: 'Jogador 2' },
];

function emptyArena(): GameState {
  const state = createGame(setups, 3);
  state.tiles = state.tiles.map((tile) => (tile === 'block' ? 'empty' : tile));
  return state;
}

function collect(state: GameState, tracker: EventTracker, ticks: number, inputs: Record<string, PlayerInput> = {}): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    step(state, inputs);
    events.push(...tracker.update(state));
  }
  return events;
}

const cells = (events: GameEvent[], type: 'flameStarted' | 'flameEnded') =>
  events
    .filter((event): event is Extract<GameEvent, { type: typeof type }> => event.type === type)
    .map((event) => `${event.x},${event.y}`)
    .sort();

describe('eventos da partida', () => {
  it('não emite nada na primeira leitura nem quando o estado é trocado', () => {
    const tracker = new EventTracker();
    const state = emptyArena();
    expect(tracker.update(state)).toEqual([]);
    step(state, { p1: { dir: null, bomb: true } });
    expect(tracker.update(state)).toEqual([{ type: 'bombPlaced', x: 1, y: 1, owner: 'p1' }]);
    expect(tracker.update(emptyArena())).toEqual([]);
  });

  it('descreve explosão, chamas, caixa destruída, nocaute e fim de rodada', () => {
    const state = emptyArena();
    state.tiles[1 * state.width + 3] = 'block';
    const tracker = new EventTracker();
    tracker.update(state);

    const blast = collect(state, tracker, BOMB_FUSE_TICKS, { p1: { dir: null, bomb: true } });
    expect(blast.filter((event) => event.type === 'bombExploded')).toEqual([
      { type: 'bombExploded', x: 1, y: 1, owner: 'p1' },
    ]);
    expect(blast).toContainEqual({ type: 'blockDestroyed', x: 3, y: 1 });
    expect(cells(blast, 'flameStarted')).toEqual(['1,1', '1,2', '1,3', '2,1', '3,1']);
    expect(blast).toContainEqual({ type: 'playerDied', playerId: 'p1', x: 1.5, y: 1.5 });
    expect(blast).toContainEqual({ type: 'roundDecided', winner: 'p2' });

    const after = collect(state, tracker, Math.max(FLAME_TICKS, ROUND_END_TICKS));
    expect(cells(after, 'flameEnded')).toEqual(['1,1', '1,2', '1,3', '2,1', '3,1']);
    expect(after).toContainEqual({ type: 'roundEnded', winner: 'p2' });
  });

  it('diferencia power-up coletado de power-up queimado', () => {
    const state = emptyArena();
    state.powerUps.push({ x: 2, y: 1, kind: 'range' }, { x: 1, y: 3, kind: 'bomb' });
    const tracker = new EventTracker();
    tracker.update(state);

    const walk = collect(state, tracker, 25, { p1: { dir: 'right', bomb: false } });
    expect(walk).toContainEqual({ type: 'powerUpCollected', x: 2, y: 1, kind: 'range', playerId: 'p1' });

    state.bombs.push({ id: 99, owner: 'p2', x: 1, y: 5, ticksLeft: 1, range: 2, passable: [] });
    const burn = collect(state, tracker, 1);
    expect(burn).toContainEqual({ type: 'powerUpDestroyed', x: 1, y: 3, kind: 'bomb' });
    expect(burn.some((event) => event.type === 'powerUpCollected')).toBe(false);
  });
});
