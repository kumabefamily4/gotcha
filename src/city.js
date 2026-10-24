// Procedural city: pure data (no Three.js) so it can be generated identically on every
// client from a shared seed, and tested in Node.
import { makeRng } from './rng.js';

export const SIZE = 480; // metres, square map centred on the origin
export const HALF = SIZE / 2;

export const T = {
  GRASS: 0, ROAD: 1, SIDEWALK: 2, WATER: 3, BUILDING: 4, PATH: 5, PLAZA: 6, BRIDGE: 7, YARD: 8,
};

export const SOLID = 99; // obstacle height for things you cannot climb
const ROAD_W = 10;
const WALK_W = 3;

export const PALETTE = {
  babyBlue: 0xa9d6f5, teal: 0x5fbfb4, deepTeal: 0x3c9d97, sun: 0xffd98a, orange: 0xffa66b,
  coral: 0xff8f7a, cream: 0xfff3dc, lilac: 0xc9c2f0, mint: 0xbde8d3, peach: 0xffc9a8,
  sky: 0xbfe3fa, white: 0xfafafa,
};

const BUILDING_COLORS = [0xa9d6f5, 0x8fd0c8, 0xfff0d0, 0xffd9a8, 0xffbf99, 0xf7e3c4, 0xc9e6f2, 0xd8f0e6, 0xffe6b8, 0xc9c2f0];
const ROOF_COLORS = [0xff9a6b, 0x5fbfb4, 0xf2a65a, 0x6fb3d9, 0xe8846b];

export function generateCity(seed) {
  const rng = makeRng(seed);
  const N = SIZE; // 1 m cells
  const type = new Uint8Array(N * N); // T.*
  const height = new Float32Array(N * N); // obstacle height above ground (0 = free)
  const idx = (cx, cz) => cz * N + cx;
  const toCell = (v) => Math.floor(v + HALF);

  const fillRect = (x0, z0, x1, z1, t, h) => {
    const cx0 = Math.max(0, toCell(Math.min(x0, x1))), cx1 = Math.min(N - 1, toCell(Math.max(x0, x1)) - 1);
    const cz0 = Math.max(0, toCell(Math.min(z0, z1))), cz1 = Math.min(N - 1, toCell(Math.max(z0, z1)) - 1);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const i = idx(cx, cz);
      if (t !== null) type[i] = t;
      if (h !== null) height[i] = Math.max(height[i], h);
    }
  };

  // --- River: sinuous, roughly east-west, sitting in an extra-wide gap between road rows.
  const riverZ = rng.range(-60, 60);
  const riverAmp = rng.range(5, 11);
  const riverK = rng.range(0.012, 0.022);
  const riverPhi = rng.range(0, Math.PI * 2);
  const riverHalfW = 8;
  const riverCenter = (x) => riverZ + riverAmp * Math.sin(x * riverK + riverPhi);

  // --- Road grid
  const xs = [];
  for (let x = -HALF + rng.range(18, 30); x < HALF - 20; x += rng.range(52, 78)) xs.push(x);
  const zs = [];
  {
    let z = -HALF + rng.range(18, 30);
    while (z < HALF - 20) {
      // keep road rows clear of the river band
      if (Math.abs(z - riverZ) < riverAmp + riverHalfW + ROAD_W / 2 + WALK_W + 14) {
        z = riverZ + riverAmp + riverHalfW + ROAD_W / 2 + WALK_W + 16;
        continue;
      }
      zs.push(z);
      z += rng.range(52, 78);
    }
  }

  // base: grass everywhere
  type.fill(T.GRASS);

  const rw = ROAD_W / 2, sw = ROAD_W / 2 + WALK_W;
  for (const x of xs) {
    fillRect(x - sw, -HALF, x + sw, HALF, T.SIDEWALK, null);
  }
  for (const z of zs) {
    fillRect(-HALF, z - sw, HALF, z + sw, T.SIDEWALK, null);
  }
  for (const x of xs) fillRect(x - rw, -HALF, x + rw, HALF, T.ROAD, null);
  for (const z of zs) fillRect(-HALF, z - rw, HALF, z + rw, T.ROAD, null);

  // River cells (override); where a north-south road crosses, it becomes a bridge.
  const bridges = [];
  for (let cx = 0; cx < N; cx++) {
    const x = cx - HALF + 0.5;
    const c = riverCenter(x);
    for (let cz = 0; cz < N; cz++) {
      const z = cz - HALF + 0.5;
      const d = Math.abs(z - c);
      if (d < riverHalfW) {
        const i = idx(cx, cz);
        if (type[i] === T.ROAD || type[i] === T.SIDEWALK) {
          type[i] = T.BRIDGE;
        } else {
          type[i] = T.WATER;
          height[i] = SOLID;
        }
      }
    }
  }
  for (const x of xs) {
    const c = riverCenter(x);
    bridges.push({ x, z: c, w: ROAD_W + WALK_W * 2, d: riverHalfW * 2 + 4 });
    // railings along both edges of the bridge: low, but solid enough to keep you out of the water
    const z0 = c - riverHalfW - 1, z1 = c + riverHalfW + 1;
    fillRect(x - sw - 0.6, z0, x - sw, z1, null, SOLID);
    fillRect(x + sw, z0, x + sw + 0.6, z1, null, SOLID);
  }

  // --- Blocks
  const edgesX = [-HALF, ...xs, HALF];
  const edgesZ = [-HALF, ...zs, HALF];
  const buildings = [], trees = [], hedges = [], benches = [], lamps = [], fountains = [];
  const blocks = [];
  for (let i = 0; i < edgesX.length - 1; i++) {
    for (let j = 0; j < edgesZ.length - 1; j++) {
      const x0 = edgesX[i] + (i === 0 ? 0 : sw), x1 = edgesX[i + 1] - (i + 1 === edgesX.length - 1 ? 0 : sw);
      const z0 = edgesZ[j] + (j === 0 ? 0 : sw), z1 = edgesZ[j + 1] - (j + 1 === edgesZ.length - 1 ? 0 : sw);
      if (x1 - x0 < 8 || z1 - z0 < 8) continue;
      blocks.push({ x0, x1, z0, z1 });
    }
  }

  const touchesRiver = (b) => {
    for (let x = b.x0; x <= b.x1; x += 4) {
      const c = riverCenter(x);
      if (c + riverHalfW + 6 > b.z0 && c - riverHalfW - 6 < b.z1) return true;
    }
    return false;
  };

  const placeTree = (x, z, s = 1) => {
    if (!inBounds(x, z)) return;
    const i = idx(toCell(x), toCell(z));
    if (height[i] > 0 || type[i] === T.WATER || type[i] === T.ROAD) return;
    trees.push({ x, z, s, kind: rng.chance(0.25) ? 'cone' : 'round', hue: rng.int(0, 2) });
    fillRect(x - 0.4, z - 0.4, x + 0.4, z + 0.4, null, SOLID);
  };

  const makePark = (b, riverside) => {
    fillRect(b.x0, b.z0, b.x1, b.z1, T.GRASS, null);
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    // cross paths
    fillRect(cx - 1.5, b.z0, cx + 1.5, b.z1, T.PATH, null);
    fillRect(b.x0, cz - 1.5, b.x1, cz + 1.5, T.PATH, null);
    if (!riverside && rng.chance(0.5) && b.x1 - b.x0 > 30 && b.z1 - b.z0 > 30) {
      fountains.push({ x: cx, z: cz, r: 4 });
      fillRect(cx - 7, cz - 7, cx + 7, cz + 7, T.PLAZA, null);
      fillRect(cx - 4, cz - 4, cx + 4, cz + 4, null, 0.7);
    }
    // perimeter hedges with gaps at the paths (low: you can jump over)
    const hh = 0.8;
    const hedgeSeg = (ax, az, bx, bz) => {
      if (Math.abs(bx - ax) < 1 && Math.abs(bz - az) < 1) return;
      hedges.push({ x: (ax + bx) / 2, z: (az + bz) / 2, w: Math.max(0.8, Math.abs(bx - ax)), d: Math.max(0.8, Math.abs(bz - az)), h: hh });
      fillRect(Math.min(ax, bx) - 0.4, Math.min(az, bz) - 0.4, Math.max(ax, bx) + 0.4, Math.max(az, bz) + 0.4, null, hh);
    };
    if (!riverside) {
      const g = 3;
      const ix0 = b.x0 + 1, ix1 = b.x1 - 1, iz0 = b.z0 + 1, iz1 = b.z1 - 1;
      hedgeSeg(ix0, iz0, cx - g, iz0); hedgeSeg(cx + g, iz0, ix1, iz0);
      hedgeSeg(ix0, iz1, cx - g, iz1); hedgeSeg(cx + g, iz1, ix1, iz1);
      hedgeSeg(ix0, iz0, ix0, cz - g); hedgeSeg(ix0, cz + g, ix0, iz1);
      hedgeSeg(ix1, iz0, ix1, cz - g); hedgeSeg(ix1, cz + g, ix1, iz1);
    }
    // trees
    const n = Math.floor(((b.x1 - b.x0) * (b.z1 - b.z0)) / 140);
    for (let k = 0; k < n; k++) {
      const x = rng.range(b.x0 + 3, b.x1 - 3), z = rng.range(b.z0 + 3, b.z1 - 3);
      if (Math.abs(x - cx) < 3.5 || Math.abs(z - cz) < 3.5) continue;
      placeTree(x, z, rng.range(0.8, 1.4));
    }
    // benches along the paths
    for (let k = 0; k < 4; k++) {
      const along = rng.chance(0.5);
      const t = rng.range(0.2, 0.8);
      const x = along ? b.x0 + (b.x1 - b.x0) * t : cx + (rng.chance(0.5) ? 2.6 : -2.6);
      const z = along ? cz + (rng.chance(0.5) ? 2.6 : -2.6) : b.z0 + (b.z1 - b.z0) * t;
      const i = idx(toCell(x), toCell(z));
      if (!inBounds(x, z) || height[i] > 0 || type[i] === T.WATER) continue;
      benches.push({ x, z, rot: along ? 0 : Math.PI / 2 });
      fillRect(x - (along ? 1 : 0.35), z - (along ? 0.35 : 1), x + (along ? 1 : 0.35), z + (along ? 0.35 : 1), null, 0.5);
    }
  };

  const addBuilding = (bx0, bz0, bx1, bz1, h, kind) => {
    const w = bx1 - bx0, d = bz1 - bz0;
    if (w < 4 || d < 4) return;
    const color = rng.pick(BUILDING_COLORS);
    const b = { x: (bx0 + bx1) / 2, z: (bz0 + bz1) / 2, w, d, h, kind, color, roof: rng.pick(ROOF_COLORS), roofAxis: w > d ? 'x' : 'z' };
    // tall towers sometimes get a setback top tier
    if (kind === 'tower' && h > 35 && rng.chance(0.5)) b.tier = { w: w * 0.65, d: d * 0.65, h: h * rng.range(0.15, 0.3) };
    buildings.push(b);
    fillRect(bx0, bz0, bx1, bz1, T.BUILDING, SOLID);
  };

  const splitLots = (a0, a1, minL, maxL) => {
    const out = [];
    let a = a0;
    while (a1 - a > minL) {
      let l = rng.range(minL, maxL);
      if (a1 - (a + l) < minL) l = a1 - a;
      out.push([a, a + l]);
      a += l;
    }
    return out;
  };

  for (const b of blocks) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const r = Math.hypot(cx, cz);
    const riverside = touchesRiver(b);
    if (riverside || rng.chance(0.14)) {
      makePark(b, riverside);
      b.kind = 'park';
      continue;
    }
    if (r < 110) {
      b.kind = 'downtown';
      fillRect(b.x0, b.z0, b.x1, b.z1, T.PLAZA, null);
      const lotsX = splitLots(b.x0, b.x1, 16, 30);
      const lotsZ = splitLots(b.z0, b.z1, 16, 30);
      for (const [lx0, lx1] of lotsX) for (const [lz0, lz1] of lotsZ) {
        if (rng.chance(0.12)) { placeTree((lx0 + lx1) / 2, (lz0 + lz1) / 2, 1.2); continue; }
        const h = rng.range(18, 34) + (110 - r) * rng.range(0.1, 0.45);
        addBuilding(lx0 + 1.5, lz0 + 1.5, lx1 - 1.5, lz1 - 1.5, h, 'tower');
      }
    } else if (r < 175) {
      b.kind = 'mid';
      fillRect(b.x0, b.z0, b.x1, b.z1, T.PLAZA, null);
      const lotsX = splitLots(b.x0, b.x1, 14, 24);
      const lotsZ = splitLots(b.z0, b.z1, 14, 24);
      for (const [lx0, lx1] of lotsX) for (const [lz0, lz1] of lotsZ) {
        if (rng.chance(0.15)) { placeTree((lx0 + lx1) / 2, (lz0 + lz1) / 2, 1.1); continue; }
        addBuilding(lx0 + 2, lz0 + 2, lx1 - 2, lz1 - 2, rng.range(8, 20), 'apt');
      }
    } else {
      b.kind = 'houses';
      // houses face the long sides of the block, back yards meet in the middle
      const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
      const lots = alongX ? splitLots(b.x0, b.x1, 13, 18) : splitLots(b.z0, b.z1, 13, 18);
      for (const side of [0, 1]) {
        for (const [a0, a1] of lots) {
          let lx0, lx1, lz0, lz1;
          if (alongX) {
            lx0 = a0; lx1 = a1;
            if (side === 0) { lz0 = b.z0; lz1 = cz; } else { lz0 = cz; lz1 = b.z1; }
          } else {
            lz0 = a0; lz1 = a1;
            if (side === 0) { lx0 = b.x0; lx1 = cx; } else { lx0 = cx; lx1 = b.x1; }
          }
          fillRect(lx0, lz0, lx1, lz1, T.YARD, null);
          const hw = Math.min(10, (lx1 - lx0) - 4), hd = Math.min(10, (lz1 - lz0) - 4);
          if (hw < 5 || hd < 5) continue;
          // house near the street edge
          let hx, hz;
          if (alongX) { hx = (lx0 + lx1) / 2; hz = side === 0 ? lz0 + 3 + hd / 2 : lz1 - 3 - hd / 2; }
          else { hz = (lz0 + lz1) / 2; hx = side === 0 ? lx0 + 3 + hw / 2 : lx1 - 3 - hw / 2; }
          addBuilding(hx - hw / 2, hz - hd / 2, hx + hw / 2, hz + hd / 2, rng.range(3.5, 6.5), 'house');
          if (rng.chance(0.7)) {
            const tx = alongX ? rng.range(lx0 + 2, lx1 - 2) : (side === 0 ? lx1 - 3 : lx0 + 3);
            const tz = alongX ? (side === 0 ? lz1 - 3 : lz0 + 3) : rng.range(lz0 + 2, lz1 - 2);
            placeTree(tx, tz, rng.range(0.7, 1.1));
          }
        }
      }
      // low back fence along the middle line (jumpable)
      if (alongX) {
        hedges.push({ x: cx, z: cz, w: b.x1 - b.x0 - 2, d: 0.4, h: 0.9, fence: true });
        fillRect(b.x0 + 1, cz - 0.3, b.x1 - 1, cz + 0.3, null, 0.9);
      } else {
        hedges.push({ x: cx, z: cz, w: 0.4, d: b.z1 - b.z0 - 2, h: 0.9, fence: true });
        fillRect(cx - 0.3, b.z0 + 1, cx + 0.3, b.z1 - 1, null, 0.9);
      }
    }
  }

  // street lamps at intersections (corners of the sidewalks)
  for (const x of xs) for (const z of zs) {
    lamps.push({ x: x + sw - 0.8, z: z + sw - 0.8 });
    lamps.push({ x: x - sw + 0.8, z: z - sw + 0.8 });
  }
  // street trees along sidewalks of north-south roads
  for (const x of xs) {
    for (let z = -HALF + 6; z < HALF - 6; z += 14) {
      if (rng.chance(0.45)) {
        for (const s of [-1, 1]) {
          const tx = x + s * (rw + 1.6);
          const c = idx(toCell(tx), toCell(z));
          if (type[c] === T.SIDEWALK && height[c] === 0 && !nearRoadRow(z)) placeTree(tx, z, 0.8);
        }
      }
    }
  }
  function nearRoadRow(z) { return zs.some((zz) => Math.abs(zz - z) < sw + 2); }

  // map boundary walls
  fillRect(-HALF, -HALF, HALF, -HALF + 1, null, SOLID);
  fillRect(-HALF, HALF - 1, HALF, HALF, null, SOLID);
  fillRect(-HALF, -HALF, -HALF + 1, HALF, null, SOLID);
  fillRect(HALF - 1, -HALF, HALF, HALF, null, SOLID);

  function inBounds(x, z) { return x > -HALF + 1 && x < HALF - 1 && z > -HALF + 1 && z < HALF - 1; }

  // Start: a road intersection near one corner; goal: a park or plaza far away.
  const corner = rng.int(0, 3);
  const sx = corner & 1 ? xs[xs.length - 1] : xs[0];
  const sz = corner & 2 ? zs[zs.length - 1] : zs[0];
  const start = { x: sx, z: sz };
  const parks = blocks.filter((b) => b.kind === 'park');
  let goalBlock = null, best = -1;
  for (const b of parks) {
    const d = Math.hypot((b.x0 + b.x1) / 2 - sx, (b.z0 + b.z1) / 2 - sz);
    const score = d * rng.range(0.75, 1);
    if (d > SIZE * 0.45 && score > best) { best = score; goalBlock = b; }
  }
  let goal;
  if (goalBlock) {
    // a free spot on the park's path near its centre
    goal = { x: (goalBlock.x0 + goalBlock.x1) / 2 + 9, z: (goalBlock.z0 + goalBlock.z1) / 2 };
  } else {
    goal = { x: corner & 1 ? xs[0] : xs[xs.length - 1], z: corner & 2 ? zs[0] : zs[zs.length - 1] };
  }
  goal = nearestFree(goal.x, goal.z);

  function nearestFree(x, z) {
    for (let r = 0; r < 40; r++) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r, pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
        if (!inBounds(px, pz)) continue;
        const i = idx(toCell(px), toCell(pz));
        if (height[i] === 0 && type[i] !== T.WATER) return { x: Math.floor(px) + 0.5, z: Math.floor(pz) + 0.5 };
      }
    }
    return { x, z };
  }

  return {
    seed, N, type, height, xs, zs, riverCenter, riverHalfW, buildings, trees, hedges, benches, lamps,
    fountains, bridges, blocks, start, goal, roadW: ROAD_W, walkW: WALK_W,
    cellAt(x, z) {
      const cx = toCell(x), cz = toCell(z);
      if (cx < 0 || cz < 0 || cx >= N || cz >= N) return -1;
      return idx(cx, cz);
    },
    obstacleAt(x, z) {
      const i = this.cellAt(x, z);
      return i < 0 ? SOLID : height[i];
    },
    nearestFree,
  };
}
