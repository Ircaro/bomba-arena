import { DIRECTIONS, type Direction } from '@bomba/shared';
import { TAU, circlePath, ellipsePath, radialGradient } from './paint';
import { TILE, type PlayerPalette } from './theme';

export type Expression = 'normal' | 'dead' | 'happy';

export interface CharacterPose {
  palette: PlayerPalette;
  facing: Direction;
  walk: number;
  moving: boolean;
  time: number;
  seed: number;
  expression: Expression;
  flash?: number;
  char?: number;
  cheer?: number;
}

interface Body {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

const T = TILE;
const EYE_WHITE = '#ffffff';
const PUPIL = '#1b1e27';

export function drawCharacter(ctx: CanvasRenderingContext2D, pose: CharacterPose): void {
  const { dx } = DIRECTIONS[pose.facing];
  const side = dx !== 0;
  const wave = Math.sin(pose.walk * TAU);
  const bob = pose.moving ? Math.abs(wave) * T * 0.05 : 0;
  const squash = pose.moving
    ? Math.cos(pose.walk * TAU * 2) * 0.035
    : Math.sin(pose.time / 480 + pose.seed) * 0.018;
  const body: Body = {
    cx: 0,
    cy: -T * 0.31 - bob,
    rx: T * 0.29 * (1 + squash),
    ry: T * 0.28 * (1 - squash),
  };

  if (pose.facing !== 'up') drawTails(ctx, pose, body);
  if (side) drawHand(ctx, pose, body, 'back', wave);
  else drawRaisedArms(ctx, pose, body, wave);
  drawFeet(ctx, pose, wave);
  drawBody(ctx, pose, body);
  drawBand(ctx, pose, body);
  strokeBody(ctx, pose, body);
  drawFace(ctx, pose, body);
  if (side) drawHand(ctx, pose, body, 'front', wave);
  else {
    drawHand(ctx, pose, body, 'left', wave);
    drawHand(ctx, pose, body, 'right', wave);
  }
  if (pose.facing === 'up') drawTails(ctx, pose, body);
  drawOverlays(ctx, pose, body);
}

function drawFeet(ctx: CanvasRenderingContext2D, pose: CharacterPose, wave: number): void {
  const { dx } = DIRECTIONS[pose.facing];
  const side = dx !== 0;
  const lift = (value: number) => (pose.moving ? Math.max(0, value) * T * 0.05 : 0);
  const feet = side
    ? [
        { x: wave * T * 0.08 + dx * T * 0.02, y: -T * 0.035 - lift(wave) },
        { x: -wave * T * 0.08 + dx * T * 0.02, y: -T * 0.035 - lift(-wave) },
      ]
    : [
        { x: -T * 0.11, y: -T * 0.035 - lift(wave) },
        { x: T * 0.11, y: -T * 0.035 - lift(-wave) },
      ];
  for (const foot of feet) {
    ellipsePath(ctx, foot.x, foot.y, T * (side ? 0.095 : 0.085), T * 0.058);
    ctx.fillStyle = pose.palette.dark;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = pose.palette.outline;
    ctx.stroke();
    ellipsePath(ctx, foot.x - T * 0.02, foot.y - T * 0.02, T * 0.035, T * 0.018);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fill();
  }
}

function drawBody(ctx: CanvasRenderingContext2D, pose: CharacterPose, body: Body): void {
  const { cx, cy, rx, ry } = body;
  ctx.fillStyle = radialGradient(ctx, cx - rx * 0.35, cy - ry * 0.45, T * 0.02, rx * 1.3, [
    [0, pose.palette.light],
    [0.42, pose.palette.base],
    [1, pose.palette.dark],
  ]);
  ellipsePath(ctx, cx, cy, rx, ry);
  ctx.fill();
  ctx.save();
  ellipsePath(ctx, cx, cy, rx, ry);
  ctx.clip();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  ellipsePath(ctx, cx + rx * 0.2, cy + ry * 0.95, rx * 1.1, ry * 0.45);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0, rx * 0.8), Math.max(0, ry * 0.8), 0, Math.PI * 1.1, Math.PI * 1.45);
  ctx.stroke();
}

function strokeBody(ctx: CanvasRenderingContext2D, pose: CharacterPose, body: Body): void {
  ellipsePath(ctx, body.cx, body.cy, body.rx, body.ry);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = pose.palette.outline;
  ctx.stroke();
}

function bandCenter(body: Body): number {
  return body.cy - body.ry * 0.42;
}

function drawBand(ctx: CanvasRenderingContext2D, pose: CharacterPose, body: Body): void {
  const { cx, rx } = body;
  const bandY = bandCenter(body);
  const half = T * 0.052;
  const sag = T * 0.045;
  ctx.save();
  ellipsePath(ctx, body.cx, body.cy, body.rx, body.ry);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(cx - rx - 2, bandY - half);
  ctx.quadraticCurveTo(cx, bandY - half + sag * 2, cx + rx + 2, bandY - half);
  ctx.lineTo(cx + rx + 2, bandY + half);
  ctx.quadraticCurveTo(cx, bandY + half + sag * 2, cx - rx - 2, bandY + half);
  ctx.closePath();
  ctx.fillStyle = pose.palette.bandana;
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = pose.palette.bandanaDark;
  ctx.beginPath();
  ctx.moveTo(cx - rx - 2, bandY + half);
  ctx.quadraticCurveTo(cx, bandY + half + sag * 2, cx + rx + 2, bandY + half);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.beginPath();
  ctx.moveTo(cx - rx, bandY - half + 1.6);
  ctx.quadraticCurveTo(cx, bandY - half + 1.6 + sag * 2, cx + rx, bandY - half + 1.6);
  ctx.stroke();
  ctx.restore();
}

function drawTails(ctx: CanvasRenderingContext2D, pose: CharacterPose, body: Body): void {
  const { dx } = DIRECTIONS[pose.facing];
  const bandY = bandCenter(body);
  const speed = pose.moving ? 85 : 260;
  const amplitude = pose.moving ? 0.38 : 0.14;
  let originX: number;
  let originY: number;
  let base: number;
  if (pose.facing === 'up') {
    originX = body.cx;
    originY = bandY + T * 0.05;
    base = Math.PI / 2;
  } else if (dx !== 0) {
    originX = body.cx - dx * body.rx * 0.9;
    originY = bandY + T * 0.02;
    base = dx > 0 ? Math.PI - 0.35 : 0.35;
  } else {
    originX = body.cx + body.rx * 0.55;
    originY = bandY;
    base = -0.15;
  }
  for (const [index, spread] of [
    [0, -0.3],
    [1, 0.3],
  ]) {
    const angle = base + spread + Math.sin(pose.time / speed + index * 1.4 + pose.seed) * amplitude;
    const length = T * (index === 0 ? 0.2 : 0.17);
    const endX = originX + Math.cos(angle) * length;
    const endY = originY + Math.sin(angle) * length;
    const bend = Math.sin(pose.time / (speed * 0.7) + index + pose.seed) * 0.5;
    const midX = originX + Math.cos(angle - bend) * length * 0.55;
    const midY = originY + Math.sin(angle - bend) * length * 0.55;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.quadraticCurveTo(midX, midY, endX, endY);
    ctx.lineWidth = T * 0.075 + 2.6;
    ctx.strokeStyle = pose.palette.outline;
    ctx.stroke();
    ctx.lineWidth = T * 0.075;
    ctx.strokeStyle = pose.palette.bandana;
    ctx.stroke();
  }
  if (pose.facing === 'up' || dx !== 0) {
    circlePath(ctx, originX, originY, T * 0.05);
    ctx.fillStyle = pose.palette.bandana;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = pose.palette.outline;
    ctx.stroke();
  }
}

function sideHandPosition(pose: CharacterPose, body: Body, sign: number, wave: number): { x: number; y: number } {
  const cheer = pose.cheer ?? 0;
  const swing = pose.moving ? wave * T * 0.04 : 0;
  const restX = body.cx + sign * body.rx * 0.98;
  const restY = body.cy + body.ry * 0.3 + sign * swing;
  const wiggle = Math.sin(pose.time / 95 + sign) * T * 0.025;
  const upX = body.cx + sign * body.rx * 1.12;
  const upY = body.cy - body.ry * 0.95 + wiggle;
  return { x: restX + (upX - restX) * cheer, y: restY + (upY - restY) * cheer };
}

function drawRaisedArms(ctx: CanvasRenderingContext2D, pose: CharacterPose, body: Body, wave: number): void {
  if ((pose.cheer ?? 0) <= 0.2) return;
  ctx.lineCap = 'round';
  for (const sign of [-1, 1]) {
    const hand = sideHandPosition(pose, body, sign, wave);
    ctx.beginPath();
    ctx.moveTo(body.cx + sign * body.rx * 0.72, body.cy - body.ry * 0.05);
    ctx.lineTo(hand.x, hand.y);
    ctx.lineWidth = T * 0.07 + 3.2;
    ctx.strokeStyle = pose.palette.outline;
    ctx.stroke();
    ctx.lineWidth = T * 0.07;
    ctx.strokeStyle = pose.palette.base;
    ctx.stroke();
  }
}

function drawHand(
  ctx: CanvasRenderingContext2D,
  pose: CharacterPose,
  body: Body,
  which: 'left' | 'right' | 'front' | 'back',
  wave: number,
): void {
  const { dx } = DIRECTIONS[pose.facing];
  let x: number;
  let y: number;
  if (which === 'left' || which === 'right') {
    const hand = sideHandPosition(pose, body, which === 'left' ? -1 : 1, wave);
    x = hand.x;
    y = hand.y;
  } else {
    const sign = which === 'front' ? 1 : -1;
    const stride = pose.moving ? wave * T * 0.08 : 0;
    x = body.cx - dx * T * 0.1 + sign * dx * stride;
    y = body.cy + body.ry * (which === 'front' ? 0.5 : 0.42);
  }
  circlePath(ctx, x, y, T * (which === 'front' || which === 'back' ? 0.056 : 0.062));
  ctx.fillStyle = which === 'back' ? pose.palette.dark : pose.palette.base;
  ctx.fill();
  ctx.lineWidth = 1.7;
  ctx.strokeStyle = pose.palette.outline;
  ctx.stroke();
  circlePath(ctx, x - T * 0.016, y - T * 0.018, T * 0.018);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fill();
}

function isBlinking(pose: CharacterPose): boolean {
  const cycle = (pose.time + pose.seed * 997) % 3900;
  return cycle < 120;
}

function drawFace(ctx: CanvasRenderingContext2D, pose: CharacterPose, body: Body): void {
  if (pose.facing === 'up') return;
  const { dx, dy } = DIRECTIONS[pose.facing];
  const side = dx !== 0;
  const eyeY = body.cy + body.ry * 0.05 + dy * T * 0.01;
  const eyes = side
    ? [
        { x: body.cx + dx * T * 0.15, scale: 1 },
        { x: body.cx + dx * T * 0.035, scale: 0.8 },
      ]
    : [
        { x: body.cx - T * 0.098, scale: 1 },
        { x: body.cx + T * 0.098, scale: 1 },
      ];

  ctx.fillStyle = 'rgba(255, 105, 140, 0.45)';
  if (side) {
    ellipsePath(ctx, body.cx + dx * T * 0.13, eyeY + T * 0.085, T * 0.035, T * 0.02);
    ctx.fill();
  } else {
    for (const sign of [-1, 1]) {
      ellipsePath(ctx, body.cx + sign * T * 0.17, eyeY + T * 0.075, T * 0.038, T * 0.022);
      ctx.fill();
    }
  }

  const blinking = pose.expression === 'normal' && isBlinking(pose);
  ctx.lineCap = 'round';
  for (const eye of eyes) {
    const width = T * 0.064 * eye.scale;
    const height = T * 0.082 * eye.scale;
    ctx.strokeStyle = pose.palette.outline;
    if (pose.expression === 'dead') {
      ctx.lineWidth = 2.3;
      const size = width * 0.85;
      ctx.beginPath();
      ctx.moveTo(eye.x - size, eyeY - size);
      ctx.lineTo(eye.x + size, eyeY + size);
      ctx.moveTo(eye.x + size, eyeY - size);
      ctx.lineTo(eye.x - size, eyeY + size);
      ctx.stroke();
      continue;
    }
    if (pose.expression === 'happy') {
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(eye.x, eyeY + height * 0.35, width * 0.9, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      continue;
    }
    if (blinking) {
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(eye.x, eyeY - height * 0.25, width * 0.85, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
      continue;
    }
    ellipsePath(ctx, eye.x, eyeY, width, height);
    ctx.fillStyle = EYE_WHITE;
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.stroke();
    const pupilX = eye.x + dx * width * 0.35;
    const pupilY = eyeY + height * 0.12 + dy * height * 0.08;
    ellipsePath(ctx, pupilX, pupilY, width * 0.58, height * 0.62);
    ctx.fillStyle = PUPIL;
    ctx.fill();
    circlePath(ctx, pupilX - width * 0.22, pupilY - height * 0.28, width * 0.25);
    ctx.fillStyle = EYE_WHITE;
    ctx.fill();
    circlePath(ctx, pupilX + width * 0.2, pupilY + height * 0.25, width * 0.1);
    ctx.fill();
  }

  const mouthX = side ? body.cx + dx * T * 0.17 : body.cx;
  const mouthY = eyeY + T * 0.075;
  ctx.strokeStyle = pose.palette.outline;
  ctx.lineWidth = 1.7;
  if (pose.expression === 'happy') {
    ctx.beginPath();
    ctx.arc(mouthX, mouthY - T * 0.01, T * (side ? 0.03 : 0.045), 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = '#7a1f2e';
    ctx.fill();
    ctx.stroke();
  } else if (pose.expression === 'dead') {
    ellipsePath(ctx, mouthX, mouthY, T * 0.025, T * 0.03);
    ctx.fillStyle = '#5c1824';
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(mouthX, mouthY - T * 0.02, T * (side ? 0.022 : 0.03), Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
  }
}

function drawOverlays(ctx: CanvasRenderingContext2D, pose: CharacterPose, body: Body): void {
  const charred = pose.char ?? 0;
  const flash = pose.flash ?? 0;
  if (charred > 0) {
    ellipsePath(ctx, body.cx, body.cy, body.rx + 1, body.ry + 1);
    ctx.fillStyle = `rgba(35, 22, 22, ${charred * 0.55})`;
    ctx.fill();
  }
  if (flash > 0) {
    ellipsePath(ctx, body.cx, body.cy, body.rx + 1.5, body.ry + 1.5);
    ctx.fillStyle = `rgba(255, 255, 255, ${flash * 0.85})`;
    ctx.fill();
  }
}
