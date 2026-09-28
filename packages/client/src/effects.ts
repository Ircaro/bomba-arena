import type { GameEvent, GameState, PowerUpKind } from '@bomba/shared';
import {
  TAU,
  circlePath,
  clamp01,
  easeOutBack,
  easeOutCubic,
  ellipsePath,
  radialGradient,
  roundRectPath,
  starPath,
} from './paint';
import { drawCrate, tileHash } from './terrain';
import { POWERUP_THEME, TILE, font, paletteFor, type PlayerPalette } from './theme';

type ParticleKind =
  | 'ember'
  | 'spark'
  | 'debris'
  | 'smoke'
  | 'dust'
  | 'sparkle'
  | 'ring'
  | 'flash'
  | 'ghost'
  | 'confetti'
  | 'text';

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  rotation: number;
  spin: number;
  color: string;
  text?: string;
  palette?: PlayerPalette;
}

interface Burning {
  x: number;
  y: number;
  start: number;
  variant: number;
}

interface Scorch {
  x: number;
  y: number;
  start: number;
  seed: number;
}

const MAX_PARTICLES = 700;
const BURN_MS = 420;
const SCORCH_MS = 7000;
const POWERUP_DELAY_MS = 230;
const POWERUP_POP_MS = 380;
const DEBRIS_COLORS = ['#eaae6c', '#c6803f', '#9c5a25', '#f4c386', '#7a4217'];
const CONFETTI_COLORS = ['#ffd23f', '#ff5c8a', '#47b4f2', '#7fd858', '#ffffff', '#a65cff', '#ff8b3d'];
const ADDITIVE: ReadonlySet<ParticleKind> = new Set(['ember', 'spark', 'sparkle', 'ring', 'flash']);

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export class Effects {
  private particles: Particle[] = [];
  private shakeAmount = 0;
  private readonly burning = new Map<string, Burning>();
  private readonly scorches = new Map<string, Scorch>();
  private readonly powerUpBorn = new Map<string, number>();
  private readonly deaths = new Map<string, number>();

  constructor(private readonly reducedMotion: () => boolean) {}

  reset(): void {
    this.particles = [];
    this.burning.clear();
    this.scorches.clear();
    this.powerUpBorn.clear();
    this.deaths.clear();
    this.shakeAmount = 0;
  }

  deathTime(id: string): number | undefined {
    return this.deaths.get(id);
  }

  powerUpAppear(key: string, now: number): number {
    const born = this.powerUpBorn.get(key);
    if (born === undefined) return 1;
    const t = (now - born - POWERUP_DELAY_MS) / POWERUP_POP_MS;
    if (t <= 0) return 0;
    if (t >= 1) {
      this.powerUpBorn.delete(key);
      return 1;
    }
    return easeOutBack(t);
  }

  shakeOffset(now: number): [number, number] {
    if (this.reducedMotion() || this.shakeAmount < 0.05) return [0, 0];
    const amount = this.shakeAmount;
    return [
      amount * (Math.sin(now / 19) * 0.7 + Math.sin(now / 7.3) * 0.3),
      amount * (Math.cos(now / 17) * 0.7 + Math.sin(now / 9.1) * 0.3),
    ];
  }

  apply(events: readonly GameEvent[], state: GameState, now: number): void {
    let blasts = 0;
    for (const event of events) {
      switch (event.type) {
        case 'blockDestroyed':
          this.burning.set(keyOf(event.x, event.y), { x: event.x, y: event.y, start: now, variant: tileHash(event.x, event.y, 7) });
          this.emitDebris(event.x, event.y);
          break;
        case 'bombExploded':
          blasts++;
          this.emitBlast(event.x, event.y);
          break;
        case 'flameStarted':
          this.emitEmbers(event.x, event.y, 3);
          this.scorches.set(keyOf(event.x, event.y), { x: event.x, y: event.y, start: now, seed: tileHash(event.x, event.y, 13) });
          break;
        case 'flameEnded':
          this.emitSmoke(event.x, event.y);
          break;
        case 'bombPlaced':
          this.emitDust((event.x + 0.5) * TILE, (event.y + 0.5) * TILE + TILE * 0.28, 6);
          break;
        case 'powerUpSpawned':
          this.powerUpBorn.set(keyOf(event.x, event.y), now);
          break;
        case 'powerUpCollected':
          this.powerUpBorn.delete(keyOf(event.x, event.y));
          this.emitPickup(event.x, event.y, event.kind);
          break;
        case 'powerUpDestroyed':
          this.powerUpBorn.delete(keyOf(event.x, event.y));
          this.emitSmoke(event.x, event.y);
          break;
        case 'playerDied': {
          const player = state.players.find((candidate) => candidate.id === event.playerId);
          this.deaths.set(event.playerId, now);
          this.emitDeath(event.x * TILE, event.y * TILE, paletteFor(player?.color ?? 0));
          this.addShake(5);
          break;
        }
        case 'roundDecided': {
          const winner = state.players.find((candidate) => candidate.id === event.winner);
          if (winner) this.emitConfetti(winner.x * TILE, winner.y * TILE);
          break;
        }
        default:
          break;
      }
    }
    if (blasts > 0) this.addShake(Math.min(9, 3.5 + blasts * 2));
  }

  update(dt: number, now: number): void {
    for (const particle of this.particles) this.integrate(particle, dt);
    this.particles = this.particles.filter((particle) => particle.age < particle.life);
    this.shakeAmount *= Math.exp(-dt * 9);
    for (const [key, burn] of this.burning) if (now - burn.start > BURN_MS) this.burning.delete(key);
    for (const [key, scorch] of this.scorches) if (now - scorch.start > SCORCH_MS) this.scorches.delete(key);
  }

  fuseSpark(x: number, y: number, dt: number): void {
    if (Math.random() > dt * 38) return;
    this.push({
      kind: 'spark',
      x,
      y: y + 4,
      z: 4,
      vx: random(-45, 45),
      vy: random(-20, 20),
      vz: random(50, 140),
      life: random(0.25, 0.45),
      size: random(0.9, 1.7),
      color: pick(['#ffe9a3', '#ffc857', '#fff6d6']),
    });
  }

  footstep(x: number, y: number): void {
    for (let i = 0; i < 2; i++) {
      this.push({
        kind: 'dust',
        x: x * TILE + random(-5, 5),
        y: y * TILE + TILE * 0.3 + random(-1, 2),
        vx: random(-10, 10),
        vy: random(-6, 2),
        life: random(0.3, 0.45),
        size: random(2, 3.4),
        color: 'rgba(236, 226, 190, 0.42)',
      });
    }
  }

  landing(x: number, y: number): void {
    this.emitDust(x * TILE, y * TILE + TILE * 0.3, 10);
    this.push({ kind: 'ring', x: x * TILE, y: y * TILE + TILE * 0.3, life: 0.3, size: TILE * 0.45, color: 'rgba(255, 250, 230, 0.5)' });
  }

  drawDecals(ctx: CanvasRenderingContext2D, now: number): void {
    for (const scorch of this.scorches.values()) {
      const t = (now - scorch.start) / SCORCH_MS;
      const alpha = 0.34 * (1 - t) * clamp01((now - scorch.start) / 250);
      if (alpha <= 0) continue;
      const cx = (scorch.x + 0.5) * TILE + ((scorch.seed % 7) - 3);
      const cy = (scorch.y + 0.5) * TILE + (((scorch.seed >> 3) % 7) - 3);
      ctx.fillStyle = radialGradient(ctx, cx, cy, 0, TILE * 0.48, [
        [0, `rgba(30, 20, 10, ${alpha})`],
        [0.6, `rgba(30, 20, 10, ${alpha * 0.55})`],
        [1, 'rgba(30, 20, 10, 0)'],
      ]);
      ellipsePath(ctx, cx, cy, TILE * 0.48, TILE * 0.42, (scorch.seed % 100) / 30);
      ctx.fill();
    }
  }

  drawBurning(ctx: CanvasRenderingContext2D, now: number): void {
    for (const burn of this.burning.values()) {
      const t = clamp01((now - burn.start) / BURN_MS);
      const cx = (burn.x + 0.5) * TILE;
      const cy = (burn.y + 0.5) * TILE;
      ctx.save();
      ctx.globalAlpha = 1 - easeOutCubic(t);
      ctx.translate(cx, cy + t * 4);
      ctx.rotate((burn.variant % 2 === 0 ? 1 : -1) * t * 0.15);
      ctx.scale(1 - t * 0.28, 1 - t * 0.35);
      drawCrate(ctx, -TILE / 2, -TILE / 2, TILE, burn.variant);
      roundRectPath(ctx, -TILE / 2 + 2, -TILE / 2 + 1, TILE - 4, TILE - 3, 4);
      ctx.fillStyle = `rgba(40, 18, 6, ${Math.min(1, t * 2.2) * 0.75})`;
      ctx.fill();
      ctx.restore();
    }
  }

  drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const particle of this.particles) {
      if (!ADDITIVE.has(particle.kind) && particle.kind !== 'text') this.drawParticle(ctx, particle);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of this.particles) {
      if (ADDITIVE.has(particle.kind)) this.drawParticle(ctx, particle);
    }
    ctx.restore();
    for (const particle of this.particles) {
      if (particle.kind === 'text') this.drawParticle(ctx, particle);
    }
  }

  private addShake(amount: number): void {
    this.shakeAmount = Math.min(10, this.shakeAmount + amount);
  }

  private push(partial: Partial<Particle> & Pick<Particle, 'kind' | 'x' | 'y' | 'life' | 'size' | 'color'>): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ z: 0, vx: 0, vy: 0, vz: 0, age: 0, rotation: 0, spin: 0, ...partial });
  }

  private emitBlast(x: number, y: number): void {
    const cx = (x + 0.5) * TILE;
    const cy = (y + 0.5) * TILE;
    this.push({ kind: 'flash', x: cx, y: cy, life: 0.16, size: TILE * 1.25, color: '#fff3c4' });
    this.push({ kind: 'ring', x: cx, y: cy, life: 0.32, size: TILE * 1.35, color: 'rgba(255, 214, 140, 0.85)' });
    for (let i = 0; i < 14; i++) {
      const angle = random(0, TAU);
      const speed = random(70, 190);
      this.push({
        kind: 'ember',
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: random(0.35, 0.8),
        size: random(1.4, 2.8),
        color: pick(['#ffd35a', '#ff9a2e', '#fff1b8']),
      });
    }
  }

  private emitEmbers(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.push({
        kind: 'ember',
        x: (x + random(0.2, 0.8)) * TILE,
        y: (y + random(0.2, 0.8)) * TILE,
        vx: random(-35, 35),
        vy: random(-60, -10),
        life: random(0.4, 0.95),
        size: random(1.1, 2.4),
        color: pick(['#ffcf5a', '#ff8a2a', '#ffe7a0']),
      });
    }
  }

  private emitSmoke(x: number, y: number): void {
    const puffs = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < puffs; i++) {
      this.push({
        kind: 'smoke',
        x: (x + 0.5) * TILE + random(-8, 8),
        y: (y + 0.5) * TILE + random(-6, 6),
        vx: random(-8, 8),
        vy: random(-26, -12),
        life: random(0.9, 1.5),
        size: random(7, 11),
        color: pick(['112, 108, 104', '138, 132, 126', '92, 88, 86']),
      });
    }
  }

  private emitDust(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = random(0, TAU);
      const speed = random(15, 45);
      this.push({
        kind: 'dust',
        x: x + Math.cos(angle) * 4,
        y: y + Math.sin(angle) * 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.45,
        life: random(0.35, 0.6),
        size: random(2.5, 4.5),
        color: 'rgba(240, 230, 196, 0.55)',
      });
    }
  }

  private emitDebris(x: number, y: number): void {
    const cx = (x + 0.5) * TILE;
    const cy = (y + 0.5) * TILE;
    for (let i = 0; i < 9; i++) {
      const angle = random(0, TAU);
      const speed = random(50, 150);
      this.push({
        kind: 'debris',
        x: cx + random(-8, 8),
        y: cy + random(-6, 8),
        z: random(4, 14),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.7,
        vz: random(140, 280),
        life: random(0.7, 1.1),
        size: random(3, 6.5),
        rotation: random(0, TAU),
        spin: random(-14, 14),
        color: pick(DEBRIS_COLORS),
      });
    }
    this.emitDust(cx, cy + TILE * 0.2, 5);
  }

  private emitPickup(x: number, y: number, kind: PowerUpKind): void {
    const theme = POWERUP_THEME[kind];
    const cx = (x + 0.5) * TILE;
    const cy = (y + 0.5) * TILE;
    this.push({ kind: 'ring', x: cx, y: cy, life: 0.35, size: TILE * 0.75, color: theme.light });
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * TAU + random(-0.2, 0.2);
      const speed = random(50, 110);
      this.push({
        kind: 'sparkle',
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: random(0.4, 0.7),
        size: random(2.5, 4.5),
        rotation: random(0, TAU),
        spin: random(-6, 6),
        color: pick([theme.light, theme.base, '#ffffff']),
      });
    }
    this.push({ kind: 'text', x: cx, y: cy - TILE * 0.35, vy: -38, life: 1.1, size: 13, color: theme.light, text: theme.label });
  }

  private emitDeath(x: number, y: number, palette: PlayerPalette): void {
    this.push({ kind: 'ghost', x, y: y - TILE * 0.2, vy: -34, life: 1.6, size: TILE * 0.26, color: '#ffffff', palette });
    this.push({ kind: 'ring', x, y: y - TILE * 0.1, life: 0.4, size: TILE * 0.9, color: palette.light });
    for (let i = 0; i < 16; i++) {
      const angle = random(0, TAU);
      const speed = random(60, 150);
      this.push({
        kind: 'sparkle',
        x,
        y: y - TILE * 0.15,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: random(0.45, 0.8),
        size: random(2.5, 5),
        rotation: random(0, TAU),
        spin: random(-8, 8),
        color: pick([palette.light, palette.base, '#ffffff']),
      });
    }
  }

  private emitConfetti(x: number, y: number): void {
    for (let i = 0; i < 70; i++) {
      const angle = random(0, TAU);
      const speed = random(30, 150);
      this.push({
        kind: 'confetti',
        x: x + random(-10, 10),
        y: y + random(-6, 6),
        z: random(10, 30),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.6,
        vz: random(260, 460),
        life: random(1.8, 2.8),
        size: random(3.5, 6),
        rotation: random(0, TAU),
        spin: random(-12, 12),
        color: pick(CONFETTI_COLORS),
      });
    }
  }

  private integrate(p: Particle, dt: number): void {
    p.age += dt;
    p.rotation += p.spin * dt;
    switch (p.kind) {
      case 'ember': {
        const drag = Math.exp(-dt * 2.6);
        p.vx *= drag;
        p.vy = p.vy * drag - 24 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        break;
      }
      case 'spark':
      case 'debris':
      case 'confetti': {
        const gravity = p.kind === 'confetti' ? 520 : p.kind === 'spark' ? 420 : 900;
        const drag = Math.exp(-dt * (p.kind === 'confetti' ? 1.8 : 1.2));
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vz -= gravity * dt;
        if (p.kind === 'confetti' && p.vz < -60) p.vz = -60;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          if (p.kind === 'spark') p.age = p.life;
          else if (p.kind === 'debris') {
            p.vz = Math.abs(p.vz) * 0.32;
            p.vx *= 0.55;
            p.vy *= 0.55;
            p.spin *= 0.5;
          } else {
            p.vz = 0;
            p.vx *= 0.9;
            p.vy *= 0.9;
            p.spin *= 0.9;
          }
        }
        break;
      }
      case 'smoke':
      case 'dust': {
        const drag = Math.exp(-dt * 3);
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.size += dt * (p.kind === 'smoke' ? 13 : 7);
        break;
      }
      case 'sparkle': {
        const drag = Math.exp(-dt * 4);
        p.vx *= drag;
        p.vy = p.vy * drag - 12 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        break;
      }
      case 'ghost':
        p.x += Math.cos(p.age * 5) * 14 * dt;
        p.y += p.vy * dt;
        break;
      case 'text':
        p.vy *= Math.exp(-dt * 2.5);
        p.y += p.vy * dt;
        break;
      default:
        break;
    }
  }

  private drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
    const t = clamp01(p.age / p.life);
    switch (p.kind) {
      case 'ember': {
        const alpha = 1 - t;
        const radius = p.size * (1 - t * 0.5);
        ctx.globalAlpha = alpha * 0.35;
        ctx.fillStyle = p.color;
        circlePath(ctx, p.x, p.y, radius * 2.6);
        ctx.fill();
        ctx.globalAlpha = alpha;
        circlePath(ctx, p.x, p.y, radius);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'spark': {
        ctx.globalAlpha = 1 - t * 0.6;
        ctx.fillStyle = p.color;
        circlePath(ctx, p.x, p.y - p.z, p.size);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'debris': {
        const alpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
        if (p.z > 0.5) {
          ctx.globalAlpha = alpha * 0.25;
          ctx.fillStyle = '#000000';
          ellipsePath(ctx, p.x, p.y + 2, p.size * 0.6, p.size * 0.25);
          ctx.fill();
        }
        ctx.globalAlpha = alpha;
        ctx.save();
        ctx.translate(p.x, p.y - p.z);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size * 0.32, p.size, p.size * 0.64);
        ctx.strokeStyle = 'rgba(60, 28, 8, 0.7)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(-p.size / 2, -p.size * 0.32, p.size, p.size * 0.64);
        ctx.restore();
        ctx.globalAlpha = 1;
        break;
      }
      case 'smoke': {
        const alpha = 0.34 * Math.pow(1 - t, 1.3) * clamp01(p.age / 0.12);
        ctx.fillStyle = radialGradient(ctx, p.x, p.y, 0, p.size, [
          [0, `rgba(${p.color}, ${alpha})`],
          [0.7, `rgba(${p.color}, ${alpha * 0.6})`],
          [1, `rgba(${p.color}, 0)`],
        ]);
        circlePath(ctx, p.x, p.y, p.size);
        ctx.fill();
        break;
      }
      case 'dust': {
        ctx.globalAlpha = (1 - t) * clamp01(p.age / 0.06);
        ctx.fillStyle = p.color;
        circlePath(ctx, p.x, p.y, p.size);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'sparkle': {
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = p.color;
        starPath(ctx, p.x, p.y, p.size * (1 - t * 0.4), p.rotation);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'ring': {
        const eased = easeOutCubic(t);
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 4 * (1 - t) + 0.6;
        circlePath(ctx, p.x, p.y, p.size * (0.25 + eased * 0.75));
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'flash': {
        const alpha = Math.pow(1 - t, 2);
        const radius = p.size * (0.6 + t * 0.6);
        ctx.fillStyle = radialGradient(ctx, p.x, p.y, 0, radius, [
          [0, `rgba(255, 252, 235, ${alpha})`],
          [0.35, `rgba(255, 210, 120, ${alpha * 0.7})`],
          [1, 'rgba(255, 140, 40, 0)'],
        ]);
        circlePath(ctx, p.x, p.y, radius);
        ctx.fill();
        break;
      }
      case 'ghost':
        this.drawGhost(ctx, p, t);
        break;
      case 'confetti': {
        const alpha = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
        ctx.globalAlpha = alpha;
        ctx.save();
        ctx.translate(p.x, p.y - p.z);
        ctx.rotate(p.rotation);
        ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(p.rotation * 1.7))));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        ctx.restore();
        ctx.globalAlpha = 1;
        break;
      }
      case 'text': {
        const pop = t < 0.18 ? easeOutBack(t / 0.18) : 1;
        const alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.scale(pop, pop);
        ctx.font = font(700, p.size);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(16, 18, 28, 0.9)';
        ctx.strokeText(p.text ?? '', 0, 0);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text ?? '', 0, 0);
        ctx.restore();
        break;
      }
    }
  }

  private drawGhost(ctx: CanvasRenderingContext2D, p: Particle, t: number): void {
    const palette = p.palette;
    if (!palette) return;
    const alpha = (t < 0.15 ? t / 0.15 : 1) * (t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1);
    const size = p.size * (0.8 + easeOutBack(Math.min(1, t * 4)) * 0.2);
    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    ctx.translate(p.x, p.y);
    ctx.beginPath();
    ctx.arc(0, 0, size, Math.PI, 0);
    const waves = 3;
    const bottom = size * 1.1;
    ctx.lineTo(size, bottom);
    for (let i = waves; i > 0; i--) {
      const x0 = size - ((waves - i + 0.5) * 2 * size) / waves;
      const x1 = size - ((waves - i + 1) * 2 * size) / waves;
      const lift = Math.sin(p.age * 10 + i) * 1.5;
      ctx.quadraticCurveTo(x0, bottom - size * 0.35 + lift, x1, bottom);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(245, 250, 255, 0.95)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = palette.light;
    ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.fillStyle = palette.outline;
      ellipsePath(ctx, side * size * 0.34, -size * 0.08, size * 0.17, size * 0.24);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      circlePath(ctx, side * size * 0.34 - size * 0.06, -size * 0.16, size * 0.07);
      ctx.fill();
    }
    ctx.strokeStyle = palette.outline;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, size * 0.25, size * 0.12, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 120, 150, 0.5)';
    for (const side of [-1, 1]) {
      ellipsePath(ctx, side * size * 0.62, size * 0.2, size * 0.14, size * 0.08);
      ctx.fill();
    }
    ctx.restore();
  }
}
