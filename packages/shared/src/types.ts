export type Tile = 'empty' | 'wall' | 'block';
export type Direction = 'up' | 'down' | 'left' | 'right';
export type PowerUpKind = 'bomb' | 'range' | 'speed';
export type Phase = 'playing' | 'ending' | 'ended';

export interface PlayerSetup {
  id: string;
  name: string;
  color?: number;
}

export interface PlayerInput {
  dir: Direction | null;
  bomb: boolean;
}

export interface Player {
  id: string;
  name: string;
  slot: number;
  color: number;
  x: number;
  y: number;
  alive: boolean;
  speed: number;
  range: number;
  maxBombs: number;
  facing: Direction;
}

export interface Bomb {
  id: number;
  owner: string;
  x: number;
  y: number;
  ticksLeft: number;
  range: number;
  passable: string[];
}

export interface Flame {
  x: number;
  y: number;
  ticksLeft: number;
}

export interface PowerUp {
  x: number;
  y: number;
  kind: PowerUpKind;
}

export interface GameState {
  tick: number;
  width: number;
  height: number;
  tiles: Tile[];
  players: Player[];
  bombs: Bomb[];
  flames: Flame[];
  powerUps: PowerUp[];
  phase: Phase;
  winner: string | null;
  endTicks: number;
  rngState: number;
  nextBombId: number;
}

export interface MatchState {
  seed: number;
  round: number;
  gamesPlayed: number;
  players: PlayerSetup[];
  wins: Record<string, number>;
  winsToFinish: number;
  champion: string | null;
  game: GameState;
}
