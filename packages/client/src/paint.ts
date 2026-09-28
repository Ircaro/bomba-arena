export const TAU = Math.PI * 2;

export type ColorStop = [offset: number, color: string];

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function easeOutBack(t: number): number {
  const u = clamp01(t) - 1;
  return 1 + 2.70158 * u * u * u + 1.70158 * u * u;
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

export function easeOutBounce(t: number): number {
  const u = clamp01(t);
  if (u < 1 / 2.75) return 7.5625 * u * u;
  if (u < 2 / 2.75) return 7.5625 * (u - 1.5 / 2.75) ** 2 + 0.75;
  if (u < 2.5 / 2.75) return 7.5625 * (u - 2.25 / 2.75) ** 2 + 0.9375;
  return 7.5625 * (u - 2.625 / 2.75) ** 2 + 0.984375;
}

export function circlePath(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, radius), 0, TAU);
}

export function ellipsePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation = 0,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0, radiusX), Math.max(0, radiusY), rotation, 0, TAU);
}

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2)));
}

export function radialGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  inner: number,
  outer: number,
  stops: ColorStop[],
): CanvasGradient {
  const gradient = ctx.createRadialGradient(x, y, Math.max(0, inner), x, y, Math.max(0.001, outer));
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

export function linearGradient(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: ColorStop[],
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

export function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, rotation: number): void {
  const inner = radius * 0.32;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = rotation + (i * Math.PI) / 4;
    const r = i % 2 === 0 ? radius : inner;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
