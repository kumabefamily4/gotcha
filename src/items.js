// Fair item placement: every player gets their own items, and the shortest walking route
// start -> (all items, best order) -> goal is within a few percent for every player.
import { HALF, SIZE, T } from './city.js';
import { makeRng } from './rng.js';

const CELL = 2; // metres per coarse navigation cell
const GN = SIZE / CELL;

export function buildNavGrid(city) {
  const pass = new Uint8Array(GN * GN);
  for (let gz = 0; gz < GN; gz++) for (let gx = 0; gx < GN; gx++) {
    let ok = 1;
    for (let dz = 0; dz < CELL && ok; dz++) for (let dx = 0; dx < CELL; dx++) {
      const i = (gz * CELL + dz) * city.N + gx * CELL + dx;
      // low hedges, fences and benches can be jumped, so they still count as passable
      if (city.height[i] > 1.0 || city.type[i] === T.WATER) { ok = 0; break; }
    }
    pass[gz * GN + gx] = ok;
  }
  return pass;
}

const toG = (v) => Math.max(0, Math.min(GN - 1, Math.floor((v + HALF) / CELL)));
const gIndex = (p) => toG(p.z) * GN + toG(p.x);

// Dijkstra over an 8-connected grid from one point. Returns Float32Array of metres.
export function distanceField(pass, from) {
  const dist = new Float64Array(GN * GN).fill(Infinity);
  const heap = new MinHeap();
  const s = gIndex(from);
  dist[s] = 0;
  heap.push(0, s);
  const D = Math.SQRT2 * CELL;
  const nbr = [[1, 0, CELL], [-1, 0, CELL], [0, 1, CELL], [0, -1, CELL], [1, 1, D], [1, -1, D], [-1, 1, D], [-1, -1, D]];
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    const x = i % GN, z = (i / GN) | 0;
    for (const [dx, dz, c] of nbr) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= GN || nz >= GN) continue;
      const j = nz * GN + nx;
      if (!pass[j]) continue;
      // no corner cutting through walls
      if (dx && dz && (!pass[z * GN + nx] || !pass[nz * GN + x])) continue;
      const nd = d + c;
      if (nd < dist[j]) { dist[j] = nd; heap.push(nd, j); }
    }
  }
  return dist;
}

// Shortest open path start -> all items (any order) -> goal, Held-Karp.
// m: matrix where index 0 = start, 1..n = items, n+1 = goal.
export function bestRoute(m, n) {
  if (n === 0) return { length: m[0][1], order: [] };
  const FULL = 1 << n;
  const dp = new Float64Array(FULL * n).fill(Infinity);
  const par = new Int8Array(FULL * n).fill(-1);
  for (let k = 0; k < n; k++) dp[(1 << k) * n + k] = m[0][k + 1];
  for (let mask = 1; mask < FULL; mask++) {
    for (let k = 0; k < n; k++) {
      const cur = dp[mask * n + k];
      if (!(mask & (1 << k)) || cur === Infinity) continue;
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        const nm = mask | (1 << j);
        const v = cur + m[k + 1][j + 1];
        if (v < dp[nm * n + j]) { dp[nm * n + j] = v; par[nm * n + j] = k; }
      }
    }
  }
  let best = Infinity, last = -1;
  for (let k = 0; k < n; k++) {
    const v = dp[(FULL - 1) * n + k] + m[k + 1][n + 1];
    if (v < best) { best = v; last = k; }
  }
  const order = [];
  let mask = FULL - 1;
  while (last >= 0) { order.unshift(last); const p = par[mask * n + last]; mask &= ~(1 << last); last = p; }
  return { length: best, order };
}

/**
 * Assign items to players.
 * @returns {{ items: Record<string, {x:number,z:number}[]>, lengths: Record<string, number> }}
 */
export function assignItems(city, playerIds, count, seed, tolerance = 0.04) {
  const rng = makeRng(seed ^ 0x9e3779b9);
  const pass = buildNavGrid(city);
  const startField = distanceField(pass, city.start);
  const goalField = distanceField(pass, city.goal);
  const startG = gIndex(city.start), goalG = gIndex(city.goal);
  const startToGoal = startField[goalG];

  // candidate spots: passable, reachable, not too close to start/goal
  const randomSpot = () => {
    for (let t = 0; t < 2000; t++) {
      const x = rng.range(-HALF + 6, HALF - 6), z = rng.range(-HALF + 6, HALF - 6);
      const g = gIndex({ x, z });
      if (!pass[g] || !isFinite(startField[g]) || !isFinite(goalField[g])) continue;
      const ci = city.cellAt(x, z);
      if (city.height[ci] > 0) continue;
      if (Math.hypot(x - city.start.x, z - city.start.z) < 25) continue;
      if (Math.hypot(x - city.goal.x, z - city.goal.z) < 25) continue;
      return { x: Math.round(x * 2) / 2, z: Math.round(z * 2) / 2 };
    }
    return { x: city.start.x + 10, z: city.start.z };
  };

  const fieldCache = new Map();
  const fieldFor = (p) => {
    const k = gIndex(p);
    if (!fieldCache.has(k)) {
      if (fieldCache.size > 40) fieldCache.delete(fieldCache.keys().next().value);
      fieldCache.set(k, distanceField(pass, p));
    }
    return fieldCache.get(k);
  };

  const routeLength = (pts) => {
    const n = pts.length;
    const m = Array.from({ length: n + 2 }, () => new Float64Array(n + 2));
    m[0][n + 1] = m[n + 1][0] = startToGoal;
    for (let a = 0; a < n; a++) {
      const f = fieldFor(pts[a]);
      m[0][a + 1] = m[a + 1][0] = startField[gIndex(pts[a])];
      m[n + 1][a + 1] = m[a + 1][n + 1] = goalField[gIndex(pts[a])];
      for (let b = 0; b < n; b++) m[a + 1][b + 1] = f[gIndex(pts[b])];
    }
    return bestRoute(m, n).length;
  };

  const spread = (pts, p, minD) => pts.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= minD);
  const freshSet = () => {
    const pts = [];
    for (let t = 0; pts.length < count && t < 500; t++) {
      const p = randomSpot();
      if (spread(pts, p, 40)) pts.push(p);
    }
    while (pts.length < count) pts.push(randomSpot());
    return pts;
  };

  const items = {}, lengths = {};
  let target = null;
  for (const id of playerIds) {
    let pts = freshSet();
    let len = routeLength(pts);
    for (let attempt = 0; attempt < 30 && !isFinite(len); attempt++) {
      pts = freshSet();
      len = routeLength(pts);
    }
    if (target === null) {
      target = isFinite(len) ? len : startToGoal * 2;
    } else {
      // hill-climb: swap one item at a time toward the target length
      for (let iter = 0; iter < 400 && Math.abs(len - target) / target > tolerance; iter++) {
        const k = rng.int(0, count - 1);
        const cand = pts.slice();
        const p = randomSpot();
        if (!spread(cand.filter((_, i) => i !== k), p, 25)) continue;
        cand[k] = p;
        const l2 = routeLength(cand);
        if (Math.abs(l2 - target) < Math.abs(len - target)) { pts = cand; len = l2; }
        if (iter % 80 === 79 && Math.abs(len - target) / target > 0.25) { pts = freshSet(); len = routeLength(pts); }
      }
    }
    items[id] = pts;
    lengths[id] = len;
  }
  return { items, lengths };
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const rk = k[0], rv = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return [rk, rv];
  }
}
