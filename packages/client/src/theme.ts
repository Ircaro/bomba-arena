import type { PowerUpKind } from '@bomba/shared';

export const TILE = 48;
export const FONT_FAMILY = '"Fredoka Variable", "Fredoka", "Segoe UI", system-ui, sans-serif';

export function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

export interface PlayerPalette {
  label: string;
  base: string;
  light: string;
  dark: string;
  outline: string;
  bandana: string;
  bandanaDark: string;
}

export const PLAYER_PALETTES: PlayerPalette[] = [
  { label: 'Azul', base: '#47b4f2', light: '#b8e8ff', dark: '#1d6fb0', outline: '#0f2f4d', bandana: '#ff4f64', bandanaDark: '#b3243a' },
  { label: 'Rosa', base: '#ff6d9d', light: '#ffc9db', dark: '#c3366a', outline: '#4a0f27', bandana: '#ffd23f', bandanaDark: '#c29410' },
  { label: 'Amarelo', base: '#ffcd45', light: '#fff2b8', dark: '#cc910f', outline: '#4a3306', bandana: '#3d7dff', bandanaDark: '#1c4cbd' },
  { label: 'Verde', base: '#7fd858', light: '#d2f8ba', dark: '#3d9827', outline: '#163d0c', bandana: '#a65cff', bandanaDark: '#6a2dbf' },
];

export function paletteFor(slot: number): PlayerPalette {
  return PLAYER_PALETTES[slot % PLAYER_PALETTES.length];
}

export interface PowerUpTheme {
  label: string;
  light: string;
  base: string;
  dark: string;
  glow: string;
}

export const POWERUP_THEME: Record<PowerUpKind, PowerUpTheme> = {
  bomb: { label: 'Bomba +1', light: '#cdbcff', base: '#8e6ff2', dark: '#4a2db3', glow: 'rgba(150, 120, 255, 0.55)' },
  range: { label: 'Alcance +1', light: '#ffd29a', base: '#ff8b3d', dark: '#c23f0c', glow: 'rgba(255, 150, 70, 0.55)' },
  speed: { label: 'Velocidade +1', light: '#a3f7e8', base: '#2dc9ad', dark: '#0b7a69', glow: 'rgba(70, 230, 200, 0.5)' },
};

export const ICON_PATHS: Record<PowerUpKind, string> = {
  bomb: 'M17.5 14.5a7.5 7.5 0 1 1-15 0a7.5 7.5 0 1 1 15 0ZM13.4 8.2 15.4 6.2 17.8 8.6 15.8 10.6ZM19.6 0.6l1 2.4 2.4 1.2-2.4 1.2-1 2.4-1-2.4-2.4-1.2 2.4-1.2Z',
  range:
    'M12 22.5c-4.4 0-7.5-3.1-7.5-7.3 0-3.6 2.2-6 4.1-8.1.3 2.1 1.2 3.6 2.7 4.3C11 7.6 12.4 4.3 15.4 1.5c.4 3.6 1.6 5.6 3 7.7 1.2 1.8 1.1 3.6 1.1 5.9 0 4.3-3.1 7.4-7.5 7.4ZM12 20c2 0 3.4-1.4 3.4-3.3 0-1.7-.9-2.8-2-4-.3 1.3-1 2-2 2.3.2-1.2-.3-2.3-1-3.1-1 1.2-2 2.6-2 4.6C8.4 18.6 10 20 12 20Z',
  speed: 'M13.8 1.5 4.5 13.4h6.2l-1.6 9.1 9.5-12.4h-6.3l1.5-8.6Z',
};

export const ICON_FILL_RULE: Record<PowerUpKind, CanvasFillRule> = {
  bomb: 'nonzero',
  range: 'evenodd',
  speed: 'nonzero',
};

export const STAR_PATH = 'M12 2.2l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.1l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9Z';
