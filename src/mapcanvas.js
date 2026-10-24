// Draws the city plan to a canvas. Used for the ground texture and the mini-map.
import { HALF, SIZE, T } from './city.js';

const COLORS = {
  [T.GRASS]: [168, 220, 176],
  [T.ROAD]: [122, 134, 150],
  [T.SIDEWALK]: [232, 226, 214],
  [T.WATER]: [92, 192, 214],
  [T.BUILDING]: [206, 198, 188],
  [T.PATH]: [242, 222, 186],
  [T.PLAZA]: [238, 230, 216],
  [T.BRIDGE]: [214, 196, 170],
  [T.YARD]: [184, 226, 178],
};

// Returns a canvas with 1 pixel per metre. waterAlpha 0 punches the river out (ground cut-out).
export function drawPlan(city, { waterAlpha = 255, buildings = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < city.N * city.N; i++) {
    let t = city.type[i];
    if (!buildings && t === T.BUILDING) t = T.PLAZA;
    const col = COLORS[t] || COLORS[T.GRASS];
    img.data[i * 4] = col[0];
    img.data[i * 4 + 1] = col[1];
    img.data[i * 4 + 2] = col[2];
    img.data[i * 4 + 3] = t === T.WATER ? waterAlpha : 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// High-resolution ground texture with lane markings and crossings.
export function drawGround(city, px = 2048) {
  const base = drawPlan(city, { waterAlpha: 0, buildings: false });
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(base, 0, 0, px, px);
  const s = px / SIZE;
  const X = (x) => (x + HALF) * s;
  const rw = city.roadW / 2;

  // subtle grass speckle so large lawns aren't flat
  const rngSeed = city.seed;
  let r = rngSeed >>> 0;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 9000; k++) {
    const x = rnd() * SIZE - HALF, z = rnd() * SIZE - HALF;
    const t = city.type[city.cellAt(x, z)];
    if (t !== T.GRASS && t !== T.YARD) continue;
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(120,196,150,0.35)' : 'rgba(210,240,190,0.35)';
    ctx.fillRect(X(x), X(z), s * 0.8, s * 0.8);
  }

  // dashed centre lines
  ctx.strokeStyle = 'rgba(255,240,200,0.9)';
  ctx.lineWidth = Math.max(1, s * 0.18);
  ctx.setLineDash([s * 3, s * 3]);
  for (const x of city.xs) {
    ctx.beginPath(); ctx.moveTo(X(x), 0); ctx.lineTo(X(x), px); ctx.stroke();
  }
  for (const z of city.zs) {
    ctx.beginPath(); ctx.moveTo(0, X(z)); ctx.lineTo(px, X(z)); ctx.stroke();
  }
  ctx.setLineDash([]);
  // intersections: clear the centre lines, paint zebra crossings
  for (const x of city.xs) for (const z of city.zs) {
    ctx.fillStyle = 'rgb(122,134,150)';
    ctx.fillRect(X(x - rw), X(z - rw), city.roadW * s, city.roadW * s);
    ctx.fillStyle = 'rgba(250,250,245,0.85)';
    for (let k = -rw + 1; k < rw - 0.5; k += 1.6) {
      ctx.fillRect(X(x + k), X(z - rw - 2.6), 0.8 * s, 2.2 * s);
      ctx.fillRect(X(x + k), X(z + rw + 0.4), 0.8 * s, 2.2 * s);
      ctx.fillRect(X(x - rw - 2.6), X(z + k), 2.2 * s, 0.8 * s);
      ctx.fillRect(X(x + rw + 0.4), X(z + k), 2.2 * s, 0.8 * s);
    }
  }
  // kerb lines
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, s * 0.25);
  return c;
}

// Mini-map base image (1 px per metre, buildings shown).
export function drawMiniBase(city) {
  const c = drawPlan(city, { waterAlpha: 255, buildings: true });
  const ctx = c.getContext('2d');
  // darken buildings a bit for contrast
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(150,140,170,0.55)';
  for (const b of city.buildings) ctx.fillRect(b.x - b.w / 2 + HALF, b.z - b.d / 2 + HALF, b.w, b.d);
  return c;
}
