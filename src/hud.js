// HUD: player list chips, banner notifications, and the heading-up mini-map.
import { HALF } from './city.js';
import { drawMiniBase } from './mapcanvas.js';

const hex = (c) => '#' + c.toString(16).padStart(6, '0');

export function statusText(p) {
  if (p.status === 'left') return 'left game';
  if (p.status === 'done') return p.rank ? `finished #${p.rank}` : 'at the goal';
  if (p.status === 'goal') return 'heading to goal';
  return `${p.found} of ${p.total} found`;
}

export class Hud {
  constructor() {
    this.playersEl = document.getElementById('hud-players');
    this.banner = document.getElementById('banner');
    this.meStatus = document.getElementById('me-status');
    this.mini = document.getElementById('minimap');
    this.ctx = this.mini.getContext('2d');
    this.queue = [];
    this.showing = false;
  }

  setCity(city) { this.base = drawMiniBase(city); }

  renderPlayers(list, myId) {
    const html = list.map((p) => `<div class="chip ${p.status} ${p.talking ? 'talking' : ''}">
      <span class="dot" style="background:${hex(p.color)}"></span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}
      <span class="st">${statusText(p)}</span><span class="spk"></span></div>`).join('');
    if (html !== this._last) { this.playersEl.innerHTML = html; this._last = html; }
  }

  setMe(text) { if (this.meStatus.textContent !== text) this.meStatus.textContent = text; }

  notify(text, ms = 3200) {
    this.queue.push({ text, ms });
    if (!this.showing) this._next();
  }

  _next() {
    const n = this.queue.shift();
    if (!n) { this.showing = false; return; }
    this.showing = true;
    this.banner.textContent = n.text;
    this.banner.classList.add('show');
    setTimeout(() => {
      this.banner.classList.remove('show');
      setTimeout(() => this._next(), 380);
    }, n.ms);
  }

  // me: {x,z,heading}, items: [{x,z}], others: [{x,z,color}], goal: {x,z}|null
  drawMap(me, items, others, goal, t) {
    const c = this.ctx, W = this.mini.width, R = W / 2;
    const range = 110; // metres from centre to edge
    const k = R / range;
    c.save();
    c.clearRect(0, 0, W, W);
    c.beginPath(); c.arc(R, R, R, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#a8dcb0'; c.fillRect(0, 0, W, W);
    // heading-up: rotate the world around the player
    c.translate(R, R);
    c.rotate(me.heading);
    c.scale(k, k);
    c.translate(-me.x, -me.z);
    if (this.base) c.drawImage(this.base, -HALF, -HALF);
    c.restore();

    const proj = (p) => {
      const dx = p.x - me.x, dz = p.z - me.z;
      const cs = Math.cos(me.heading), sn = Math.sin(me.heading);
      let x = (dx * cs - dz * sn) * k, y = (dx * sn + dz * cs) * k;
      const d = Math.hypot(x, y), lim = R - 9;
      const clamped = d > lim;
      if (clamped) { x *= lim / d; y *= lim / d; }
      return { x: R + x, y: R + y, clamped };
    };
    const glow = (x, y, r, col, alpha = 1) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r * 2.4);
      g.addColorStop(0, col); g.addColorStop(0.45, col); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.globalAlpha = alpha; c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 2.4, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
    };
    const pulse = 0.75 + 0.25 * Math.sin(t * 5);
    for (const it of items) {
      const p = proj(it);
      glow(p.x, p.y, p.clamped ? 5 : 6, 'rgba(255,200,60,1)', p.clamped ? 0.75 : pulse);
      c.fillStyle = '#fff6c9'; c.beginPath(); c.arc(p.x, p.y, 3, 0, Math.PI * 2); c.fill();
    }
    for (const o of others) {
      const p = proj(o);
      c.fillStyle = hex(o.color); c.strokeStyle = '#fff'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(p.x, p.y, 7, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    if (goal) {
      const p = proj(goal);
      glow(p.x, p.y, 8, 'rgba(255,60,60,1)', pulse);
      c.fillStyle = '#ff3b3b'; c.strokeStyle = '#fff'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(p.x, p.y, 7, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    // the player: glowing blue dot with a view cone pointing up
    c.fillStyle = 'rgba(80,170,255,0.25)';
    c.beginPath(); c.moveTo(R, R); c.arc(R, R, 46, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); c.closePath(); c.fill();
    glow(R, R, 9, 'rgba(60,160,255,1)', 0.9);
    c.fillStyle = '#2f8fff'; c.strokeStyle = '#fff'; c.lineWidth = 3;
    c.beginPath(); c.arc(R, R, 8, 0, Math.PI * 2); c.fill(); c.stroke();
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
