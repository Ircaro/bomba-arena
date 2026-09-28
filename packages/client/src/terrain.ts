import { nextRandom, type GameState } from '@bomba/shared';
import { TAU, circlePath, ellipsePath, linearGradient, radialGradient, roundRectPath } from './paint';
import { TILE } from './theme';

const GRASS = ['#5aab5b', '#51a154'];
const SHADOW = '10, 38, 20';
const BRICK_TONES = ['#6c748a', '#656d83', '#717a91', '#60687d', '#697188'];

const CRATE_TONES = [
  { light: '#f1ba7a', dark: '#c6803f', plankLight: '#dc9550', plankDark: '#b16a2c' },
  { light: '#ebb06e', dark: '#bd7738', plankLight: '#d48c49', plankDark: '#a96428' },
  { light: '#f4c386', dark: '#cc8845', plankLight: '#df9b57', plankDark: '#b77231' },
];

export function tileHash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function seededRandom(seed: number): () => number {
  const holder = { rngState: seed >>> 0 };
  return () => nextRandom(holder);
}

function isSolid(state: GameState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return true;
  return state.tiles[y * state.width + x] !== 'empty';
}

function isBorder(state: GameState, x: number, y: number): boolean {
  return x === 0 || y === 0 || x === state.width - 1 || y === state.height - 1;
}

export function renderFloor(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (let y = 1; y < state.height - 1; y++) {
    for (let x = 1; x < state.width - 1; x++) drawGrass(ctx, x, y);
  }
}

export function renderSolids(ctx: CanvasRenderingContext2D, state: GameState): void {
  drawShadows(ctx, state);
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const tile = state.tiles[y * state.width + x];
      if (tile === 'wall') {
        if (isBorder(state, x, y)) drawBorderTile(ctx, state, x, y);
        else drawPillar(ctx, x, y);
      } else if (tile === 'block') {
        drawCrate(ctx, x * TILE, y * TILE, TILE, tileHash(x, y, 7));
      }
    }
  }
  drawArenaRim(ctx, state);
}

function drawGrass(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const px = x * TILE;
  const py = y * TILE;
  const rand = seededRandom(tileHash(x, y, 1));
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, TILE, TILE);
  ctx.clip();

  ctx.fillStyle = GRASS[(x + y) % 2];
  ctx.fillRect(px, py, TILE, TILE);

  for (let i = 0; i < 5; i++) {
    const light = rand() < 0.5;
    ctx.fillStyle = light ? 'rgba(255, 255, 210, 0.045)' : 'rgba(20, 70, 25, 0.07)';
    ellipsePath(ctx, px + rand() * TILE, py + rand() * TILE, 5 + rand() * 10, 3 + rand() * 6, rand() * Math.PI);
    ctx.fill();
  }

  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(160, 225, 120, 0.4)' : 'rgba(35, 95, 40, 0.4)';
    const size = 0.8 + rand() * 1.1;
    ctx.fillRect(px + rand() * TILE, py + rand() * TILE, size, size);
  }

  const tufts = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < tufts; i++) drawTuft(ctx, px + 6 + rand() * (TILE - 12), py + 9 + rand() * (TILE - 14), rand);

  const decoration = rand();
  if (decoration < 0.09) drawFlower(ctx, px + 10 + rand() * (TILE - 20), py + 10 + rand() * (TILE - 20), rand);
  else if (decoration < 0.16) drawPebble(ctx, px + 10 + rand() * (TILE - 20), py + 12 + rand() * (TILE - 22), rand);
  ctx.restore();
}

function drawTuft(ctx: CanvasRenderingContext2D, bx: number, by: number, rand: () => number): void {
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = 'rgba(25, 80, 30, 0.35)';
  ctx.beginPath();
  ctx.ellipse(bx, by + 0.6, 3.2, 1, 0, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(175, 235, 130, 0.7)';
  ctx.beginPath();
  for (const lean of [-1, 0, 1]) {
    const height = 3.5 + rand() * 2.5;
    ctx.moveTo(bx + lean * 1.4, by);
    ctx.quadraticCurveTo(bx + lean * 1.8, by - height * 0.6, bx + lean * 3 + (rand() - 0.5), by - height);
  }
  ctx.stroke();
}

function drawFlower(ctx: CanvasRenderingContext2D, fx: number, fy: number, rand: () => number): void {
  const petal = rand() < 0.55 ? '#fff8e8' : '#ffc4da';
  const turn = rand() * TAU;
  ctx.fillStyle = 'rgba(20, 60, 25, 0.3)';
  ellipsePath(ctx, fx + 0.8, fy + 1.6, 3.6, 1.6);
  ctx.fill();
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    const angle = turn + (i / 5) * TAU;
    circlePath(ctx, fx + Math.cos(angle) * 2.2, fy + Math.sin(angle) * 2.2, 1.7);
    ctx.fill();
  }
  ctx.fillStyle = '#ffcf3f';
  circlePath(ctx, fx, fy, 1.4);
  ctx.fill();
}

function drawPebble(ctx: CanvasRenderingContext2D, px: number, py: number, rand: () => number): void {
  const width = 2.4 + rand() * 1.4;
  ctx.fillStyle = 'rgba(15, 50, 20, 0.3)';
  ellipsePath(ctx, px + 0.8, py + 1.3, width, width * 0.6);
  ctx.fill();
  ctx.fillStyle = '#b9c2af';
  ellipsePath(ctx, px, py, width, width * 0.68);
  ctx.fill();
  ctx.fillStyle = '#e2e8da';
  ellipsePath(ctx, px - width * 0.3, py - width * 0.25, width * 0.4, width * 0.25);
  ctx.fill();
}

function drawShadows(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (let y = 1; y < state.height - 1; y++) {
    for (let x = 1; x < state.width - 1; x++) {
      if (isSolid(state, x, y)) continue;
      const px = x * TILE;
      const py = y * TILE;
      const north = isSolid(state, x, y - 1);
      const west = isSolid(state, x - 1, y);
      if (north) {
        ctx.fillStyle = linearGradient(ctx, 0, py, 0, py + TILE * 0.46, [
          [0, `rgba(${SHADOW}, 0.46)`],
          [0.45, `rgba(${SHADOW}, 0.16)`],
          [1, `rgba(${SHADOW}, 0)`],
        ]);
        ctx.fillRect(px, py, TILE, TILE * 0.46);
      }
      if (west) {
        ctx.fillStyle = linearGradient(ctx, px, 0, px + TILE * 0.3, 0, [
          [0, `rgba(${SHADOW}, 0.3)`],
          [1, `rgba(${SHADOW}, 0)`],
        ]);
        ctx.fillRect(px, py, TILE * 0.3, TILE);
      }
      if (!north && !west && isSolid(state, x - 1, y - 1)) {
        ctx.fillStyle = radialGradient(ctx, px, py, 0, TILE * 0.42, [
          [0, `rgba(${SHADOW}, 0.32)`],
          [1, `rgba(${SHADOW}, 0)`],
        ]);
        ctx.fillRect(px, py, TILE * 0.42, TILE * 0.42);
      }
    }
  }
}

function drawBorderTile(ctx: CanvasRenderingContext2D, state: GameState, x: number, y: number): void {
  const px = x * TILE;
  const py = y * TILE;
  const brickH = TILE / 3;
  const brickW = TILE / 2;
  const gap = 1.8;
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, TILE, TILE);
  ctx.clip();
  ctx.fillStyle = '#3a404f';
  ctx.fillRect(px, py, TILE, TILE);

  for (let row = 0; row < 3; row++) {
    const globalRow = y * 3 + row;
    const offset = (globalRow % 2) * (brickW / 2);
    const top = py + row * brickH;
    for (let k = Math.floor((px + offset) / brickW); k * brickW - offset < px + TILE; k++) {
      const left = k * brickW - offset;
      const tone = BRICK_TONES[tileHash(k, globalRow, 5) % BRICK_TONES.length];
      ctx.fillStyle = tone;
      ctx.fillRect(left + gap / 2, top + gap / 2, brickW - gap, brickH - gap);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(left + gap / 2, top + gap / 2, brickW - gap, 1.4);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(left + gap / 2, top + brickH - gap / 2 - 1.4, brickW - gap, 1.4);
    }
  }

  const facesArena = y === 0 && x > 0 && x < state.width - 1;
  if (facesArena) {
    const depth = TILE * 0.22;
    ctx.fillStyle = linearGradient(ctx, 0, py + TILE - depth, 0, py + TILE, [
      [0, '#4d5467'],
      [1, '#2f3441'],
    ]);
    ctx.fillRect(px, py + TILE - depth, TILE, depth);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.fillRect(px, py + TILE - depth, TILE, 1.2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    for (let k = 0; k < 2; k++) ctx.fillRect(px + brickW * k + brickW / 2, py + TILE - depth + 2, 1.2, depth - 3);
  }

  ctx.fillStyle = 'rgba(8, 10, 18, 0.18)';
  ctx.fillRect(px, py, TILE, TILE);
  ctx.restore();
}

function drawArenaRim(ctx: CanvasRenderingContext2D, state: GameState): void {
  const left = TILE;
  const top = TILE;
  const right = (state.width - 1) * TILE;
  const bottom = (state.height - 1) * TILE;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fillRect(left, bottom, right - left, 1.6);
  ctx.fillRect(right, top, 1.4, bottom - top);
  ctx.fillStyle = 'rgba(8, 10, 18, 0.45)';
  ctx.fillRect(left - 1.6, top, 1.6, bottom - top);
}

function drawPillar(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const px = x * TILE;
  const py = y * TILE;
  const rand = seededRandom(tileHash(x, y, 3));
  const left = px + 2;
  const top = py + 1;
  const width = TILE - 4;
  const height = TILE - 2;
  const depth = TILE * 0.22;
  const radius = 7;
  const topHeight = height - depth;

  ctx.fillStyle = linearGradient(ctx, 0, top + topHeight - radius, 0, top + height, [
    [0, '#5b6376'],
    [1, '#363c4b'],
  ]);
  roundRectPath(ctx, left, top, width, height, radius);
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.fillRect(left + width * 0.34, top + topHeight + 2, 1.2, depth - 4);
  ctx.fillRect(left + width * 0.7, top + topHeight + 2, 1.2, depth - 4);

  ctx.fillStyle = linearGradient(ctx, left, top, left + width, top + topHeight, [
    [0, '#bac3d3'],
    [1, '#848da3'],
  ]);
  roundRectPath(ctx, left, top, width, topHeight, radius);
  ctx.fill();

  roundRectPath(ctx, left + 7, top + 6, width - 14, topHeight - 12, 4);
  ctx.strokeStyle = 'rgba(66, 73, 92, 0.5)';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  roundRectPath(ctx, left + 8.2, top + 7.2, width - 14, topHeight - 12, 4);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.stroke();

  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = rand() < 0.6 ? 'rgba(66, 73, 92, 0.38)' : 'rgba(255, 255, 255, 0.28)';
    circlePath(ctx, left + 4 + rand() * (width - 8), top + 3 + rand() * (topHeight - 6), 0.5 + rand() * 1.1);
    ctx.fill();
  }
  if (rand() < 0.45) {
    ctx.strokeStyle = 'rgba(60, 66, 84, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let cx = left + 3 + rand() * 6;
    let cy = top + 4 + rand() * (topHeight - 8);
    ctx.moveTo(cx, cy);
    for (let i = 0; i < 3; i++) {
      cx += 3 + rand() * 4;
      cy += (rand() - 0.5) * 6;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = linearGradient(ctx, left, top, left + width * 0.7, top + topHeight * 0.7, [
    [0, 'rgba(255, 255, 255, 0.6)'],
    [1, 'rgba(255, 255, 255, 0)'],
  ]);
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, left + 1.2, top + 1.2, width - 2.4, topHeight - 2.4, radius - 1);
  ctx.stroke();

  ctx.fillStyle = 'rgba(28, 32, 42, 0.4)';
  ctx.fillRect(left + radius * 0.6, top + topHeight - 0.8, width - radius * 1.2, 1.6);
  ctx.strokeStyle = '#242934';
  ctx.lineWidth = 1.4;
  roundRectPath(ctx, left, top, width, height, radius);
  ctx.stroke();
}

export function drawCrate(ctx: CanvasRenderingContext2D, px: number, py: number, size: number, variant: number): void {
  const tone = CRATE_TONES[variant % CRATE_TONES.length];
  const rand = seededRandom(variant);
  const inset = size * 0.05;
  const left = px + inset;
  const top = py + inset * 0.5;
  const width = size - inset * 2;
  const height = size - inset * 1.3;
  const depth = size * 0.2;
  const radius = size * 0.09;
  const topHeight = height - depth;

  ctx.fillStyle = linearGradient(ctx, 0, top + topHeight - radius, 0, top + height, [
    [0, '#9c5a25'],
    [1, '#673513'],
  ]);
  roundRectPath(ctx, left, top, width, height, radius);
  ctx.fill();
  ctx.fillStyle = 'rgba(48, 22, 5, 0.45)';
  for (const fraction of [1 / 3, 2 / 3]) ctx.fillRect(left + width * fraction - 0.6, top + topHeight + 1, 1.2, depth - 3);
  ctx.fillStyle = 'rgba(255, 210, 150, 0.22)';
  ctx.fillRect(left + radius * 0.5, top + topHeight + 0.8, width - radius, 1.2);

  ctx.fillStyle = linearGradient(ctx, left, top, left + width, top + topHeight, [
    [0, tone.light],
    [1, tone.dark],
  ]);
  roundRectPath(ctx, left, top, width, topHeight, radius);
  ctx.fill();

  const frame = size * 0.12;
  const ix = left + frame;
  const iy = top + frame * 0.9;
  const iw = width - frame * 2;
  const ih = topHeight - frame * 1.8;
  ctx.fillStyle = linearGradient(ctx, ix, iy, ix, iy + ih, [
    [0, tone.plankLight],
    [1, tone.plankDark],
  ]);
  ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = 'rgba(92, 45, 12, 0.5)';
  ctx.fillRect(ix, iy + ih / 3 - 0.6, iw, 1.2);
  ctx.fillRect(ix, iy + (2 * ih) / 3 - 0.6, iw, 1.2);
  ctx.strokeStyle = 'rgba(120, 62, 20, 0.28)';
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) {
    const gx = ix + rand() * iw * 0.6;
    const gy = iy + 2 + rand() * (ih - 4);
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.quadraticCurveTo(gx + iw * 0.15, gy + (rand() - 0.5) * 2, gx + iw * (0.2 + rand() * 0.2), gy);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(70, 34, 8, 0.5)';
  ctx.fillRect(ix, iy, iw, 1.5);
  ctx.fillRect(ix, iy, 1.5, ih);
  ctx.fillStyle = 'rgba(255, 222, 172, 0.32)';
  ctx.fillRect(ix, iy + ih - 1.2, iw, 1.2);
  ctx.fillRect(ix + iw - 1.2, iy, 1.2, ih);

  ctx.save();
  ctx.beginPath();
  ctx.rect(ix, iy, iw, ih);
  ctx.clip();
  const length = Math.hypot(iw, ih);
  const nx = (-ih / length) * size * 0.045;
  const ny = (-iw / length) * size * 0.045;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(78, 36, 9, 0.6)';
  ctx.lineWidth = size * 0.16;
  ctx.beginPath();
  ctx.moveTo(ix - 2, iy + ih + 2);
  ctx.lineTo(ix + iw + 2, iy - 2);
  ctx.stroke();
  ctx.strokeStyle = tone.plankLight;
  ctx.lineWidth = size * 0.115;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 232, 192, 0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(ix - 2 + nx, iy + ih + 2 + ny);
  ctx.lineTo(ix + iw + 2 + nx, iy - 2 + ny);
  ctx.stroke();
  ctx.restore();

  const nail = size * 0.028;
  for (const [nxp, nyp] of [
    [left + frame * 0.5, top + frame * 0.48],
    [left + width - frame * 0.5, top + frame * 0.48],
    [left + frame * 0.5, top + topHeight - frame * 0.48],
    [left + width - frame * 0.5, top + topHeight - frame * 0.48],
  ]) {
    ctx.fillStyle = '#5a381c';
    circlePath(ctx, nxp, nyp, nail);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 228, 190, 0.8)';
    circlePath(ctx, nxp - nail * 0.35, nyp - nail * 0.35, nail * 0.4);
    ctx.fill();
  }

  ctx.strokeStyle = linearGradient(ctx, left, top, left + width * 0.75, top + topHeight * 0.75, [
    [0, 'rgba(255, 238, 205, 0.7)'],
    [1, 'rgba(255, 238, 205, 0)'],
  ]);
  ctx.lineWidth = 1.4;
  roundRectPath(ctx, left + 1, top + 1, width - 2, topHeight - 2, radius - 1);
  ctx.stroke();
  ctx.fillStyle = 'rgba(58, 28, 8, 0.45)';
  ctx.fillRect(left + radius * 0.4, top + topHeight - 1, width - radius * 0.8, 1.5);
  ctx.strokeStyle = '#4a2810';
  ctx.lineWidth = 1.4;
  roundRectPath(ctx, left, top, width, height, radius);
  ctx.stroke();
}
