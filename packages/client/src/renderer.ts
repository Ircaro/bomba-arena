import {
  BOMB_FUSE_TICKS,
  DIRECTIONS,
  FLAME_TICKS,
  type Bomb,
  type GameEvent,
  type GameState,
  type Player,
  type PowerUp,
  type PowerUpKind,
} from '@bomba/shared';
import { drawCharacter, type Expression } from './character';
import { Effects } from './effects';
import {
  TAU,
  circlePath,
  clamp01,
  easeOutBack,
  easeOutBounce,
  ellipsePath,
  linearGradient,
  radialGradient,
  roundRectPath,
} from './paint';
import { renderFloor, renderSolids, tileHash } from './terrain';
import { ICON_FILL_RULE, ICON_PATHS, POWERUP_THEME, TILE, font, paletteFor } from './theme';

export interface Banner {
  title: string;
  subtitle?: string;
  start: number;
  duration: number;
}

export interface FrameInfo {
  now: number;
  positions: ReadonlyMap<string, { x: number; y: number }>;
  banner: Banner | null;
  events: readonly GameEvent[];
}

interface PlayerVisual {
  x: number;
  y: number;
  walk: number;
  moving: boolean;
  moveTimer: number;
  dust: number;
  landed: boolean;
}

interface PlayerDraw {
  player: Player;
  visual: PlayerVisual;
  lift: number;
  dying: number | null;
  cheering: boolean;
  entrance: number;
}

const DEATH_MS = 950;
const ENTRANCE_MS = 560;
const ENTRANCE_STAGGER_MS = 110;
const FLAME_LAYERS: [string, number][] = [
  ['#ff4a1f', 0.9],
  ['#ff9321', 0.68],
  ['#ffd84a', 0.46],
  ['#fffbe6', 0.22],
];

function flameScale(ticksLeft: number): number {
  const elapsed = 1 - ticksLeft / FLAME_TICKS;
  if (elapsed < 0.12) return 0.55 + 0.45 * (elapsed / 0.12);
  return 1 - Math.pow((elapsed - 0.12) / 0.88, 1.5) * 0.72;
}

function sameTiles(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível neste navegador');
  return ctx;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly floorLayer = document.createElement('canvas');
  private readonly terrainLayer = document.createElement('canvas');
  private readonly floorCtx: CanvasRenderingContext2D;
  private readonly terrainCtx: CanvasRenderingContext2D;
  private readonly effects: Effects;
  private readonly visuals = new Map<string, PlayerVisual>();
  private readonly icons = new Map<PowerUpKind, Path2D>();
  private readonly motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private scale = 1;
  private state: GameState | null = null;
  private floorFor: GameState | null = null;
  private terrainTiles: string[] = [];
  private vignette: CanvasGradient | null = null;
  private grade: CanvasGradient | null = null;
  private entranceStart = -Infinity;
  private lastNow = 0;
  private frameDt = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cols: number,
    private readonly rows: number,
  ) {
    this.ctx = context(canvas);
    this.floorCtx = context(this.floorLayer);
    this.terrainCtx = context(this.terrainLayer);
    for (const kind of Object.keys(ICON_PATHS) as PowerUpKind[]) this.icons.set(kind, new Path2D(ICON_PATHS[kind]));
    canvas.style.aspectRatio = `${cols} / ${rows}`;
    this.effects = new Effects(() => this.motionQuery.matches);
    new ResizeObserver(() => this.resize()).observe(canvas);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  beginEntrance(now: number): void {
    this.entranceStart = now;
    for (const visual of this.visuals.values()) visual.landed = false;
  }

  draw(state: GameState, frame: FrameInfo): void {
    const { now } = frame;
    this.frameDt = this.lastNow ? Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000)) : 0;
    this.lastNow = now;
    if (state !== this.state) {
      this.state = state;
      this.effects.reset();
      this.visuals.clear();
    }
    this.ensureLayers(state);
    this.effects.apply(frame.events, state, now);
    this.updateVisuals(state, frame, now);
    this.effects.update(this.frameDt, now);

    const ctx = this.ctx;
    const scale = this.scale;
    const [shakeX, shakeY] = this.effects.shakeOffset(now);
    const offsetX = Math.round(shakeX * scale);
    const offsetY = Math.round(shakeY * scale);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#161a23';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.terrainLayer, offsetX, offsetY);
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    this.effects.drawDecals(ctx, now);
    for (const item of state.powerUps) this.drawPowerUp(ctx, item, now);
    for (const bomb of state.bombs) this.drawBomb(ctx, bomb, now);
    this.effects.drawBurning(ctx, now);
    this.drawFlames(ctx, state, now);
    this.drawPlayers(ctx, state, now);
    this.effects.drawParticles(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawGrading(ctx);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (frame.banner) this.drawBanner(ctx, frame.banner, now);
  }

  private resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = this.canvas.getBoundingClientRect().width || this.cols * TILE;
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round((width * this.rows) / this.cols));
    if (width === this.canvas.width && height === this.canvas.height) return;
    for (const layer of [this.canvas, this.floorLayer, this.terrainLayer]) {
      layer.width = width;
      layer.height = height;
    }
    this.scale = width / (this.cols * TILE);
    this.floorFor = null;
    this.terrainTiles = [];
    this.vignette = null;
    this.grade = null;
  }

  private ensureLayers(state: GameState): void {
    if (this.floorFor !== state) {
      const ctx = this.floorCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.floorLayer.width, this.floorLayer.height);
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      renderFloor(ctx, state);
      this.floorFor = state;
      this.terrainTiles = [];
    }
    if (sameTiles(this.terrainTiles, state.tiles)) return;
    const ctx = this.terrainCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.terrainLayer.width, this.terrainLayer.height);
    ctx.drawImage(this.floorLayer, 0, 0);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    renderSolids(ctx, state);
    this.terrainTiles = [...state.tiles];
  }

  private updateVisuals(state: GameState, frame: FrameInfo, now: number): void {
    for (const player of state.players) {
      const position = frame.positions.get(player.id);
      const x = position?.x ?? player.x;
      const y = position?.y ?? player.y;
      let visual = this.visuals.get(player.id);
      if (!visual) {
        visual = { x, y, walk: 0, moving: false, moveTimer: 0, dust: 0, landed: this.entranceProgress(player.slot, now) >= 1 };
        this.visuals.set(player.id, visual);
      }
      const distance = Math.hypot(x - visual.x, y - visual.y);
      if (player.alive && distance > 0.0004) visual.moveTimer = 0.09;
      else visual.moveTimer -= this.frameDt;
      visual.moving = player.alive && visual.moveTimer > 0;
      if (player.alive && distance > 0) {
        visual.walk += distance / 0.9;
        visual.dust += distance;
        if (visual.dust > 0.6) {
          visual.dust = 0;
          this.effects.footstep(x, y);
        }
      }
      visual.x = x;
      visual.y = y;
      if (!visual.landed && this.entranceProgress(player.slot, now) >= 1) {
        visual.landed = true;
        if (player.alive) this.effects.landing(x, y);
      }
    }
  }

  private entranceProgress(slot: number, now: number): number {
    return clamp01((now - this.entranceStart - slot * ENTRANCE_STAGGER_MS) / ENTRANCE_MS);
  }

  private drawPlayers(ctx: CanvasRenderingContext2D, state: GameState, now: number): void {
    const survivors = state.players.filter((player) => player.alive);
    const celebrating = state.phase !== 'playing' && state.players.length > 1 && survivors.length === 1;
    const draws: PlayerDraw[] = [];
    for (const player of state.players) {
      const visual = this.visuals.get(player.id);
      if (!visual) continue;
      let dying: number | null = null;
      if (!player.alive) {
        const diedAt = this.effects.deathTime(player.id);
        if (diedAt === undefined) continue;
        dying = (now - diedAt) / DEATH_MS;
        if (dying >= 1) continue;
      }
      const cheering = celebrating && player.alive;
      const entrance = this.entranceProgress(player.slot, now);
      const drop = entrance < 1 ? (1 - easeOutBounce(entrance)) * TILE * 3.2 : 0;
      const hop = cheering ? Math.abs(Math.sin(now / 165)) * TILE * 0.22 : 0;
      draws.push({ player, visual, lift: drop + hop, dying, cheering, entrance });
    }
    draws.sort((a, b) => a.visual.y - b.visual.y);
    for (const entry of draws) this.drawPlayerShadow(ctx, entry);
    for (const entry of draws) this.drawPlayer(ctx, entry, now);
    for (const entry of draws) if (entry.dying === null) this.drawTag(ctx, entry);
  }

  private drawPlayerShadow(ctx: CanvasRenderingContext2D, entry: PlayerDraw): void {
    const palette = paletteFor(entry.player.color);
    const gx = entry.visual.x * TILE;
    const gy = entry.visual.y * TILE + TILE * 0.3;
    const height = clamp01(entry.lift / (TILE * 3));
    const shrink = entry.dying === null ? 1 : Math.max(0, 1 - entry.dying);
    const spread = (1 - height * 0.65) * shrink;
    ctx.fillStyle = `rgba(0, 0, 0, ${0.3 * (1 - height * 0.5)})`;
    ellipsePath(ctx, gx, gy, TILE * 0.27 * spread, TILE * 0.085 * spread);
    ctx.fill();
    if (entry.dying === null && entry.entrance >= 1) {
      ctx.strokeStyle = palette.base;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 2;
      ellipsePath(ctx, gx, gy, TILE * 0.31, TILE * 0.105);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, entry: PlayerDraw, now: number): void {
    const { player, visual, dying } = entry;
    const palette = paletteFor(player.color);
    const gx = visual.x * TILE;
    const gy = visual.y * TILE + TILE * 0.3;
    ctx.save();
    ctx.translate(gx, gy - entry.lift);
    let expression: Expression = entry.cheering ? 'happy' : 'normal';
    let flash = 0;
    let charred = 0;
    if (dying !== null) {
      expression = 'dead';
      const pivot = -TILE * 0.3;
      const pop = dying < 0.18 ? 1 + 0.22 * Math.sin((dying / 0.18) * Math.PI * 0.5) : 1.22 * (1 - (dying - 0.18) / 0.82);
      const spin = dying < 0.18 ? Math.sin(now / 22) * 0.1 : Math.pow((dying - 0.18) / 0.82, 1.4) * TAU * 1.5;
      ctx.translate(0, pivot);
      ctx.rotate(spin);
      ctx.scale(Math.max(0.001, pop), Math.max(0.001, pop));
      ctx.translate(0, -pivot);
      ctx.globalAlpha = dying > 0.7 ? 1 - (dying - 0.7) / 0.3 : 1;
      flash = dying < 0.22 ? 1 - dying / 0.22 : 0;
      charred = clamp01((dying - 0.12) * 2.4);
    } else if (entry.entrance < 1) {
      const squash = entry.entrance > 0.36 ? Math.sin(((entry.entrance - 0.36) / 0.64) * Math.PI * 3) * 0.08 * (1 - entry.entrance) : 0;
      ctx.scale(1 + squash, 1 - squash);
    }
    drawCharacter(ctx, {
      palette,
      facing: entry.cheering ? 'down' : player.facing,
      walk: visual.walk,
      moving: visual.moving && !entry.cheering,
      time: now,
      seed: player.slot * 1.7 + 0.4,
      expression,
      flash,
      char: charred,
      cheer: entry.cheering ? 1 : 0,
    });
    ctx.restore();
  }

  private drawTag(ctx: CanvasRenderingContext2D, entry: PlayerDraw): void {
    const palette = paletteFor(entry.player.color);
    const x = entry.visual.x * TILE;
    const y = entry.visual.y * TILE + TILE * 0.3 - entry.lift - TILE * 0.93;
    const width = 18;
    const height = 13;
    ctx.beginPath();
    ctx.moveTo(x - 3.5, y + height / 2 - 0.5);
    ctx.lineTo(x, y + height / 2 + 4);
    ctx.lineTo(x + 3.5, y + height / 2 - 0.5);
    ctx.closePath();
    ctx.fillStyle = palette.outline;
    ctx.fill();
    roundRectPath(ctx, x - width / 2, y - height / 2, width, height, 6.5);
    ctx.fillStyle = palette.base;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = palette.outline;
    ctx.stroke();
    ctx.font = font(700, 10);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = palette.outline;
    ctx.fillText(String(entry.player.slot + 1), x, y + 0.8);
  }

  private drawBomb(ctx: CanvasRenderingContext2D, bomb: Bomb, now: number): void {
    const age = BOMB_FUSE_TICKS - bomb.ticksLeft;
    const progress = clamp01(age / BOMB_FUSE_TICKS);
    const cx = (bomb.x + 0.5) * TILE;
    const ground = (bomb.y + 0.5) * TILE + TILE * 0.3;
    const radius = TILE * 0.3;
    const plop = age < 14 ? Math.max(0.05, easeOutBack(age / 14)) : 1;
    const pulse = Math.sin(age * 0.13 + age * age * 0.0011);
    const scaleX = plop * (1 + 0.055 * pulse);
    const scaleY = plop * (1 - 0.045 * pulse);
    const cy = ground - radius * scaleY * 0.98;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ellipsePath(ctx, cx, ground - 1, radius * 1.02 * scaleX, radius * 0.3 * scaleX);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scaleX, scaleY);
    ctx.fillStyle = radialGradient(ctx, -radius * 0.38, -radius * 0.42, radius * 0.08, radius * 1.1, [
      [0, '#858da0'],
      [0.35, '#363b48'],
      [1, '#0a0b0f'],
    ]);
    circlePath(ctx, 0, 0, radius);
    ctx.fill();
    if (progress > 0.66) {
      const warning = (progress - 0.66) / 0.34;
      ctx.fillStyle = `rgba(255, 58, 40, ${warning * (0.22 + 0.34 * Math.max(0, pulse))})`;
      circlePath(ctx, 0, 0, radius);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(150, 170, 210, 0.4)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.8, Math.PI * 0.08, Math.PI * 0.55);
    ctx.stroke();
    ctx.strokeStyle = '#07080a';
    ctx.lineWidth = 1.6;
    circlePath(ctx, 0, 0, radius);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ellipsePath(ctx, -radius * 0.38, -radius * 0.45, radius * 0.2, radius * 0.12, -0.7);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    circlePath(ctx, -radius * 0.1, -radius * 0.66, radius * 0.055);
    ctx.fill();
    ctx.save();
    ctx.translate(radius * 0.55, -radius * 0.72);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = linearGradient(ctx, -radius * 0.24, 0, radius * 0.24, 0, [
      [0, '#cfd4de'],
      [1, '#6d7480'],
    ]);
    roundRectPath(ctx, -radius * 0.24, -radius * 0.17, radius * 0.48, radius * 0.34, 2);
    ctx.fill();
    ctx.strokeStyle = '#1f2228';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    const baseX = cx + radius * 0.72 * scaleX;
    const baseY = cy - radius * 0.9 * scaleY;
    const length = TILE * (0.05 + 0.2 * (1 - progress));
    const endX = baseX + length * 0.55;
    const endY = baseY - length * 0.85;
    const controlX = baseX + length * 0.78;
    const controlY = baseY - length * 0.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(controlX, controlY, endX, endY);
    ctx.strokeStyle = '#3a2d1c';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#e8d3a6';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    const flicker = 0.8 + 0.2 * Math.sin(now / 31 + bomb.id) + 0.12 * Math.sin(now / 13 + bomb.id * 3);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = radialGradient(ctx, endX, endY, 0, TILE * 0.22 * flicker, [
      [0, 'rgba(255, 238, 180, 0.95)'],
      [0.35, 'rgba(255, 170, 60, 0.5)'],
      [1, 'rgba(255, 110, 20, 0)'],
    ]);
    circlePath(ctx, endX, endY, TILE * 0.22 * flicker);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 242, 205, 0.9)';
    ctx.lineWidth = 1.2;
    const turn = now / 90 + bomb.id;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const angle = turn + (i * Math.PI) / 2;
      const reach = TILE * 0.1 * flicker;
      ctx.moveTo(endX + Math.cos(angle) * 2.5, endY + Math.sin(angle) * 2.5);
      ctx.lineTo(endX + Math.cos(angle) * reach, endY + Math.sin(angle) * reach);
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fffbea';
    circlePath(ctx, endX, endY, 1.9);
    ctx.fill();
    this.effects.fuseSpark(endX, endY, this.frameDt);
  }

  private drawFlames(ctx: CanvasRenderingContext2D, state: GameState, now: number): void {
    if (state.flames.length === 0) return;
    const sizes = new Map(state.flames.map((flame) => [`${flame.x},${flame.y}`, flameScale(flame.ticksLeft)]));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const flame of state.flames) {
      const cx = (flame.x + 0.5) * TILE;
      const cy = (flame.y + 0.5) * TILE;
      const radius = TILE * (sizes.get(`${flame.x},${flame.y}`) ?? 1);
      ctx.fillStyle = radialGradient(ctx, cx, cy, 0, radius, [
        [0, 'rgba(255, 150, 60, 0.3)'],
        [1, 'rgba(255, 80, 20, 0)'],
      ]);
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
    ctx.restore();

    FLAME_LAYERS.forEach(([color, width], layer) => {
      const thickness = (x: number, y: number): number | null => {
        const size = sizes.get(`${x},${y}`);
        if (size === undefined) return null;
        const flicker =
          1 +
          0.08 * Math.sin(now / 37 + x * 2.1 + y * 1.3 + layer * 1.9) +
          0.05 * Math.sin(now / 19 + x * 3.7 - y * 2.2 + layer);
        return TILE * width * size * flicker;
      };
      ctx.fillStyle = color;
      for (const flame of state.flames) this.drawFlameCell(ctx, flame.x, flame.y, thickness);
    });
  }

  private drawFlameCell(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    thickness: (x: number, y: number) => number | null,
  ): void {
    const own = thickness(x, y);
    if (own === null) return;
    const cx = (x + 0.5) * TILE;
    const cy = (y + 0.5) * TILE;
    const half = own / 2;
    roundRectPath(ctx, cx - half, cy - half, own, own, half * 0.95);
    ctx.fill();
    for (const { dx, dy } of Object.values(DIRECTIONS)) {
      const neighbor = thickness(x + dx, y + dy);
      if (neighbor === null) continue;
      const edge = (own + neighbor) / 4;
      const ex = cx + (dx * TILE) / 2;
      const ey = cy + (dy * TILE) / 2;
      ctx.beginPath();
      if (dx !== 0) {
        ctx.moveTo(cx, cy - half);
        ctx.lineTo(ex, ey - edge);
        ctx.lineTo(ex, ey + edge);
        ctx.lineTo(cx, cy + half);
      } else {
        ctx.moveTo(cx - half, cy);
        ctx.lineTo(ex - edge, ey);
        ctx.lineTo(ex + edge, ey);
        ctx.lineTo(cx + half, cy);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawPowerUp(ctx: CanvasRenderingContext2D, item: PowerUp, now: number): void {
    const appear = this.effects.powerUpAppear(`${item.x},${item.y}`, now);
    if (appear <= 0) return;
    const theme = POWERUP_THEME[item.kind];
    const seed = (tileHash(item.x, item.y, 11) % 1000) / 159;
    const cx = (item.x + 0.5) * TILE;
    const ground = (item.y + 0.5) * TILE + TILE * 0.3;
    const bob = Math.sin(now / 380 + seed) * TILE * 0.035;
    const cy = (item.y + 0.5) * TILE - TILE * 0.03 + bob;
    const size = TILE * 0.6 * appear;
    const half = size / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ellipsePath(ctx, cx, ground, half * 0.85 * (1 - bob / TILE), half * 0.26);
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.65 + 0.35 * Math.sin(now / 260 + seed);
    const glow = TILE * 0.62 * appear;
    ctx.fillStyle = radialGradient(ctx, cx, cy, 0, glow, [
      [0, theme.glow],
      [1, 'rgba(0, 0, 0, 0)'],
    ]);
    ctx.fillRect(cx - glow, cy - glow, glow * 2, glow * 2);
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(now / 620 + seed) * 0.06);
    const radius = size * 0.27;
    roundRectPath(ctx, -half, -half, size, size, radius);
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = '#161a24';
    ctx.stroke();
    ctx.fillStyle = linearGradient(ctx, 0, -half, 0, half, [
      [0, theme.light],
      [0.5, theme.base],
      [1, theme.dark],
    ]);
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ellipsePath(ctx, 0, -half * 0.62, half * 1.15, half * 0.58);
    ctx.fill();
    const sweep = (now / 2600 + seed) % 1;
    if (sweep < 0.32) {
      const bandX = -size + (sweep / 0.32) * size * 2;
      ctx.rotate(0.45);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillRect(bandX, -size, size * 0.2, size * 2);
    }
    ctx.restore();

    roundRectPath(ctx, -half + 2.2, -half + 2.2, size - 4.4, size - 4.4, radius - 2);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.stroke();

    const icon = this.icons.get(item.kind);
    if (icon) {
      const iconScale = (size * 0.64) / 24;
      ctx.save();
      ctx.translate(-12 * iconScale, -12 * iconScale + 0.3);
      ctx.scale(iconScale, iconScale);
      ctx.translate(0, 1.3 / Math.max(0.01, iconScale));
      ctx.fillStyle = 'rgba(20, 10, 40, 0.35)';
      ctx.fill(icon, ICON_FILL_RULE[item.kind]);
      ctx.translate(0, -1.3 / Math.max(0.01, iconScale));
      ctx.fillStyle = '#ffffff';
      ctx.fill(icon, ICON_FILL_RULE[item.kind]);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawGrading(ctx: CanvasRenderingContext2D): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (!this.grade) {
      this.grade = linearGradient(ctx, 0, 0, width, height, [
        [0, 'rgba(255, 226, 170, 0.28)'],
        [1, 'rgba(60, 80, 170, 0.3)'],
      ]);
    }
    if (!this.vignette) {
      this.vignette = radialGradient(ctx, width / 2, height / 2, Math.min(width, height) * 0.38, Math.max(width, height) * 0.74, [
        [0, 'rgba(8, 10, 20, 0)'],
        [1, 'rgba(8, 10, 20, 0.42)'],
      ]);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = this.grade;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, width, height);
  }

  private drawBanner(ctx: CanvasRenderingContext2D, banner: Banner, now: number): void {
    const t = (now - banner.start) / banner.duration;
    if (t < 0 || t > 1) return;
    const width = this.cols * TILE;
    const cx = width / 2;
    const cy = (this.rows * TILE) / 2;
    const enter = clamp01(t / 0.2);
    const exit = t > 0.78 ? (t - 0.78) / 0.22 : 0;
    const alpha = 1 - exit;
    const ribbon = 118 * easeOutBack(enter) * (1 - exit * 0.4);

    ctx.save();
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = linearGradient(ctx, 0, 0, width, 0, [
      [0, 'rgba(12, 14, 24, 0)'],
      [0.2, 'rgba(12, 14, 24, 0.7)'],
      [0.8, 'rgba(12, 14, 24, 0.7)'],
      [1, 'rgba(12, 14, 24, 0)'],
    ]);
    ctx.fillRect(0, cy - ribbon / 2, width, ribbon);
    ctx.fillStyle = 'rgba(255, 197, 61, 0.6)';
    ctx.fillRect(width * 0.15, cy - ribbon / 2, width * 0.7, 2);
    ctx.fillRect(width * 0.15, cy + ribbon / 2 - 2, width * 0.7, 2);
    ctx.restore();

    const titleScale = easeOutBack(enter) * (1 + exit * 0.25);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy - (banner.subtitle ? 12 : 0));
    ctx.scale(titleScale, titleScale);
    ctx.font = font(700, 60);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 11;
    ctx.strokeStyle = '#1b1022';
    ctx.strokeText(banner.title, 0, 3);
    ctx.strokeText(banner.title, 0, 0);
    ctx.fillStyle = linearGradient(ctx, 0, -26, 0, 26, [
      [0, '#fff6c2'],
      [0.45, '#ffc53d'],
      [1, '#ff7a1a'],
    ]);
    ctx.fillText(banner.title, 0, 0);
    ctx.restore();

    if (banner.subtitle) {
      ctx.save();
      ctx.globalAlpha = alpha * clamp01((t - 0.08) / 0.2);
      ctx.font = font(600, 19);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#1b1022';
      ctx.strokeText(banner.subtitle, cx, cy + 34);
      ctx.fillStyle = '#f3f4f8';
      ctx.fillText(banner.subtitle, cx, cy + 34);
      ctx.restore();
    }
  }
}
