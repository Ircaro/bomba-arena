import { WINS_TO_FINISH } from './constants';
import { createGame, step } from './game';
import type { MatchState, PlayerInput, PlayerSetup } from './types';

function roundSeed(seed: number, round: number): number {
  return (seed + Math.imul(round, 0x9e3779b1)) >>> 0;
}

export function createMatch(players: PlayerSetup[], seed: number, winsToFinish = WINS_TO_FINISH): MatchState {
  return {
    seed,
    round: 1,
    gamesPlayed: 1,
    players,
    wins: Object.fromEntries(players.map((player) => [player.id, 0])),
    winsToFinish,
    champion: null,
    game: createGame(players, roundSeed(seed, 1)),
  };
}

export function stepMatch(match: MatchState, inputs: Partial<Record<string, PlayerInput>>): void {
  if (match.game.phase === 'ended') return;
  const phase = step(match.game, inputs);
  const winner = match.game.winner;
  if (phase !== 'ended' || !winner) return;
  match.wins[winner] = (match.wins[winner] ?? 0) + 1;
  if (match.wins[winner] >= match.winsToFinish) match.champion = winner;
}

export function startNextRound(match: MatchState): void {
  if (match.champion) {
    match.champion = null;
    match.round = 1;
    for (const id of Object.keys(match.wins)) match.wins[id] = 0;
  } else {
    match.round++;
  }
  match.gamesPlayed++;
  match.game = createGame(match.players, roundSeed(match.seed, match.gamesPlayed));
}
