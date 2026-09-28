import { drawCharacter, type Expression } from './character';
import { TILE, paletteFor } from './theme';

export class Portrait {
  readonly element: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly color: number,
    private readonly size: number,
  ) {
    this.element = document.createElement('canvas');
    this.element.className = 'portrait';
    this.element.style.width = `${size}px`;
    this.element.style.height = `${size}px`;
    this.element.style.setProperty('--player', paletteFor(color).base);
    this.element.setAttribute('aria-hidden', 'true');
    const ctx = this.element.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível neste navegador');
    this.ctx = ctx;
  }

  draw(now: number, expression: Expression): void {
    const ratio = window.devicePixelRatio || 1;
    const pixels = Math.max(1, Math.round(this.size * ratio));
    if (this.element.width !== pixels) {
      this.element.width = pixels;
      this.element.height = pixels;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixels, pixels);
    const zoom = pixels / (TILE * 0.9);
    ctx.setTransform(zoom, 0, 0, zoom, pixels / 2, pixels * 0.86);
    drawCharacter(ctx, {
      palette: paletteFor(this.color),
      facing: 'down',
      walk: 0,
      moving: false,
      time: now,
      seed: this.color * 1.7 + 0.4,
      expression,
      cheer: expression === 'happy' ? 1 : 0,
    });
  }
}
