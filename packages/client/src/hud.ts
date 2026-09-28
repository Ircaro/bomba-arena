import { BASE_SPEED, SPEED_STEP, type PowerUpKind } from '@bomba/shared';
import type { Expression } from './character';
import { Portrait } from './portrait';
import { ICON_FILL_RULE, ICON_PATHS, POWERUP_THEME, STAR_PATH, paletteFor } from './theme';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STAT_KINDS: PowerUpKind[] = ['bomb', 'range', 'speed'];
const STAT_NAMES: Record<PowerUpKind, string> = { bomb: 'Bombas', range: 'Alcance', speed: 'Velocidade' };
const PORTRAIT_FRAME_MS = 50;
const SIGNAL_PATH = 'M3 20h3v-4H3zM9.5 20h3v-8h-3zM16 20h3V8h-3z';

export interface HudPlayer {
  id: string;
  name: string;
  color: number;
  alive: boolean;
  maxBombs: number;
  range: number;
  speed: number;
  wins: number;
  ping: number | null;
  you: boolean;
}

export interface HudView {
  chip: { strong: string; rest: string };
  winsToFinish: number;
  players: HudPlayer[];
  celebrating: boolean;
  showPing: boolean;
}

interface Card {
  root: HTMLElement;
  portrait: Portrait;
  values: Record<PowerUpKind, HTMLElement>;
  stars: SVGSVGElement[];
  ping: HTMLElement;
  pingValue: HTMLElement;
  last: { stats: Record<PowerUpKind, number>; wins: number } | null;
}

export function svgIcon(path: string, className: string, rule: CanvasFillRule = 'nonzero'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill-rule', rule);
  svg.append(shape);
  return svg;
}

export function pingQuality(ping: number | null): 'good' | 'ok' | 'bad' | 'unknown' {
  if (ping === null) return 'unknown';
  if (ping <= 60) return 'good';
  if (ping <= 120) return 'ok';
  return 'bad';
}

export function pingLabel(ping: number | null): string {
  return ping === null ? '… ms' : `${ping} ms`;
}

export function createPingPill(): { root: HTMLElement; value: HTMLElement } {
  const root = document.createElement('span');
  root.className = 'ping';
  const value = document.createElement('span');
  root.append(svgIcon(SIGNAL_PATH, 'ping-icon'), value);
  return { root, value };
}

export function updatePingPill(root: HTMLElement, value: HTMLElement, ping: number | null): void {
  root.dataset.quality = pingQuality(ping);
  const label = pingLabel(ping);
  if (value.textContent !== label) value.textContent = label;
  root.title = ping === null ? 'Medindo o ping' : `Ping: ${ping} ms`;
}

function bump(element: Element): void {
  element.classList.remove('bump');
  void (element as HTMLElement).getBoundingClientRect();
  element.classList.add('bump');
}

export class Hud {
  private cards = new Map<string, Card>();
  private rosterKey = '';
  private chipKey = '';
  private lastPortraitFrame = -Infinity;

  constructor(
    private readonly root: HTMLElement,
    private readonly chip: HTMLElement,
  ) {}

  update(view: HudView, now: number): void {
    const chipKey = `${view.chip.strong}|${view.chip.rest}`;
    if (chipKey !== this.chipKey) {
      this.chipKey = chipKey;
      const strong = document.createElement('strong');
      strong.textContent = view.chip.strong;
      const rest = document.createElement('span');
      rest.textContent = view.chip.rest;
      this.chip.replaceChildren(strong, rest);
    }

    const rosterKey = `${view.winsToFinish}|${view.players.map((player) => `${player.id}:${player.color}:${player.name}:${player.you}`).join(',')}`;
    if (rosterKey !== this.rosterKey) {
      this.rosterKey = rosterKey;
      this.cards.clear();
      this.root.replaceChildren();
      for (const player of view.players) this.cards.set(player.id, this.createCard(player, view.winsToFinish));
    }

    const redrawPortraits = now - this.lastPortraitFrame >= PORTRAIT_FRAME_MS;
    if (redrawPortraits) this.lastPortraitFrame = now;

    for (const player of view.players) {
      const card = this.cards.get(player.id);
      if (!card) continue;
      const stats: Record<PowerUpKind, number> = {
        bomb: player.maxBombs,
        range: player.range,
        speed: Math.round((player.speed - BASE_SPEED) / SPEED_STEP) + 1,
      };
      for (const kind of STAT_KINDS) {
        if (card.last?.stats[kind] === stats[kind]) continue;
        card.values[kind].textContent = String(stats[kind]);
        if (card.last && stats[kind] > card.last.stats[kind]) bump(card.values[kind].parentElement ?? card.values[kind]);
      }
      if (card.last?.wins !== player.wins) {
        card.stars.forEach((star, position) => star.classList.toggle('on', position < player.wins));
        if (card.last && player.wins > card.last.wins && card.stars[player.wins - 1]) bump(card.stars[player.wins - 1]);
        card.root.setAttribute('aria-label', `${player.name}: ${player.wins} vitórias`);
      }
      card.root.classList.toggle('dead', !player.alive);
      card.ping.hidden = !view.showPing;
      if (view.showPing) updatePingPill(card.ping, card.pingValue, player.ping);
      card.last = { stats, wins: player.wins };
      if (redrawPortraits) {
        const expression: Expression = !player.alive ? 'dead' : view.celebrating ? 'happy' : 'normal';
        card.portrait.draw(now, expression);
      }
    }
  }

  private createCard(player: HudPlayer, winsToFinish: number): Card {
    const palette = paletteFor(player.color);
    const card = document.createElement('article');
    card.className = 'card';
    card.style.setProperty('--player', palette.base);
    card.style.setProperty('--player-light', palette.light);
    card.style.setProperty('--player-dark', palette.dark);

    const portrait = new Portrait(player.color, 52);
    const frame = document.createElement('div');
    frame.className = 'portrait-frame';
    frame.append(portrait.element);

    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = player.name;
    if (player.you) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'você';
      name.append(badge);
    }
    const statsRow = document.createElement('div');
    statsRow.className = 'stats';
    const values = {} as Record<PowerUpKind, HTMLElement>;
    for (const kind of STAT_KINDS) {
      const stat = document.createElement('span');
      stat.className = 'stat';
      stat.title = STAT_NAMES[kind];
      stat.style.setProperty('--stat', POWERUP_THEME[kind].base);
      stat.style.setProperty('--stat-light', POWERUP_THEME[kind].light);
      const value = document.createElement('b');
      value.textContent = '0';
      stat.append(svgIcon(ICON_PATHS[kind], 'stat-icon', ICON_FILL_RULE[kind]), value);
      statsRow.append(stat);
      values[kind] = value;
    }
    info.append(name, statsRow);

    const side = document.createElement('div');
    side.className = 'side';
    const winsRow = document.createElement('div');
    winsRow.className = 'wins';
    const stars = Array.from({ length: winsToFinish }, () => svgIcon(STAR_PATH, 'star'));
    winsRow.append(...stars);
    const ping = createPingPill();
    ping.root.hidden = true;
    side.append(winsRow, ping.root);

    card.append(frame, info, side);
    this.root.append(card);
    return { root: card, portrait, values, stars, ping: ping.root, pingValue: ping.value, last: null };
  }
}
