// One round of play: the 3D view, physics, items, goal, remote players and HUD.
import * as THREE from 'three';
import { generateCity, SOLID } from './city.js';
import { buildWorld } from './world.js';
import { makeSkater, makeBoard } from './avatar.js';
import { Controls } from './controls.js';
import { Hud, statusText } from './hud.js';

const SPEED = 7.5; // m/s, skateboard cruising
const ACCEL = 9;
const GRAVITY = 16;
const JUMP_V = 6.2; // ~1.2 m hop: clears hedges and fences
const STEP = 0.35;
const EYE = 1.62;
const RADIUS = 0.35;
const PICK_AUTO = 1.6;
const PICK_ACTION = 4.5;
const GOAL_R = 5;
const VIEW_DIST = 90; // others are drawn when this close

export class Game {
  constructor({ canvas, renderer, net, mesh, me, setup, settings, sfx, onEnd }) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.net = net;
    this.mesh = mesh;
    this.me = me;
    this.setup = setup; // { seed, items: {id: [{x,z}]}, players: [{id,name,color}], count }
    this.settings = settings;
    this.sfx = sfx;
    this.onEnd = onEnd;
    this.hud = new Hud();
    this.t = 0;
    this.running = false;
    this.finishedCount = 0;

    this.city = generateCity(setup.seed);
    this.hud.setCity(this.city);
    const world = buildWorld(this.city, renderer);
    this.world = world;
    this.scene = world.scene;

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 2000);
    this.stereo = new THREE.StereoCamera();
    this.stereo.eyeSep = 0.063; // average human interpupillary distance

    // players
    this.players = new Map();
    for (const p of setup.players) {
      const total = (setup.items[p.id] || []).length;
      const rec = { id: p.id, name: p.name, color: p.color, found: 0, total, status: 'collecting', rank: 0, lastSeen: performance.now(), talking: false };
      if (p.id !== me.id) {
        rec.avatar = makeSkater(p.color, p.name);
        rec.avatar.visible = false;
        this.scene.add(rec.avatar);
        rec.pos = new THREE.Vector3(this.city.start.x, 0, this.city.start.z);
        rec.target = rec.pos.clone();
        rec.heading = 0; rec.speed = 0; rec.air = false; rec.trick = 0; rec.seen = false;
      }
      this.players.set(p.id, rec);
    }
    this.self = this.players.get(me.id);

    // spawn spread around the start so nobody overlaps
    const order = setup.players.findIndex((p) => p.id === me.id);
    const ang = (order / Math.max(1, setup.players.length)) * Math.PI * 2;
    const sp = this.city.nearestFree(this.city.start.x + Math.cos(ang) * 2.5, this.city.start.z + Math.sin(ang) * 2.5);
    this.pos = new THREE.Vector3(sp.x, 0, sp.z);
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.onGround = true;
    this.trick = 0;

    this.myBoard = makeBoard(me.color);
    this.scene.add(this.myBoard);

    // my items
    this.items = (setup.items[me.id] || []).map((p, i) => {
      const m = makeItem();
      m.position.set(p.x, 1.1, p.z);
      this.scene.add(m);
      return { i, x: p.x, z: p.z, mesh: m, got: false };
    });

    this.goalMarker = makeGoal();
    this.goalMarker.position.set(this.city.goal.x, 0, this.city.goal.z);
    this.goalMarker.visible = false;
    this.scene.add(this.goalMarker);

    this.controls = new Controls(canvas, {
      stick: document.getElementById('stick'), knob: document.getElementById('knob'),
      jump: document.getElementById('btn-jump'), action: document.getElementById('btn-action'),
    });
    this.controls.gyroEnabled = settings.gyro;
    // face toward the city centre at the start
    this.controls.yawOffset = Math.atan2(-(0 - this.pos.x), -(0 - this.pos.z));

    this.offNet = net.on((m) => this._onNet(m));
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
    this.lastSend = 0; this.lastNetSend = 0; this.lastHb = 0;
  }

  get goalOpen() { return this.self.found >= this.self.total; }

  start(delayMs) {
    this.running = true;
    this.startAt = performance.now() + delayMs;
    this.renderer.setAnimationLoop((ts) => this._frame(ts));
    this._last = performance.now();
    this.countdownEl = document.getElementById('countdown');
    this.hud.notify(`Find your ${this.self.total} glowing item${this.self.total === 1 ? '' : 's'}!`, 3000);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.offNet();
    window.removeEventListener('resize', this._resize);
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const mm of [].concat(o.material)) { if (mm.map) mm.map.dispose(); mm.dispose(); }
    });
    this.renderer.renderLists.dispose();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.settings.stereo ? w / 2 / h : w / h;
    this.camera.updateProjectionMatrix();
  }

  setStereo(on) { this.settings.stereo = on; this.resize(); }

  _frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this.t += dt;
    const frozen = now < this.startAt;
    if (this.countdownEl) {
      const left = Math.ceil((this.startAt - now) / 1000);
      this.countdownEl.textContent = frozen ? String(left) : now - this.startAt < 700 ? 'GO!' : '';
    }
    this._updateSelf(dt, frozen);
    this._updateItems(dt);
    this._updateOthers(dt, now);
    this._network(now);
    this._updateHud();
    this._render();
  }

  _blockedAt(x, z, feet) {
    for (let a = 0; a < 8; a++) {
      const px = x + Math.cos((a / 8) * Math.PI * 2) * RADIUS, pz = z + Math.sin((a / 8) * Math.PI * 2) * RADIUS;
      if (this.city.obstacleAt(px, pz) > feet + STEP) return true;
    }
    return false;
  }

  _groundAt(x, z, feet) {
    let g = 0;
    for (let a = 0; a < 5; a++) {
      const px = a === 4 ? x : x + Math.cos((a / 4) * Math.PI * 2) * RADIUS * 0.7;
      const pz = a === 4 ? z : z + Math.sin((a / 4) * Math.PI * 2) * RADIUS * 0.7;
      const h = this.city.obstacleAt(px, pz);
      if (h < SOLID && h <= feet + STEP) g = Math.max(g, h);
    }
    return g;
  }

  _updateSelf(dt, frozen) {
    const q = this.controls.update();
    this.camera.quaternion.copy(q);
    // movement follows where the phone is pointing, flattened onto the ground
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    fwd.y = 0;
    if (fwd.lengthSq() < 0.04) { fwd.set(0, 1, 0).applyQuaternion(q); fwd.y = 0; }
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    this.heading = -Math.atan2(fwd.x, -fwd.z);

    const intent = this.controls.moveIntent(new THREE.Vector2());
    if (frozen || this.self.status === 'done') intent.set(0, 0);
    const target = fwd.multiplyScalar(intent.y * SPEED).add(right.multiplyScalar(intent.x * SPEED));
    const a = Math.min(1, ACCEL * dt * (this.onGround ? 1 : 0.35));
    this.vel.x += (target.x - this.vel.x) * a;
    this.vel.z += (target.z - this.vel.z) * a;

    const feet = this.pos.y;
    const nx = this.pos.x + this.vel.x * dt;
    if (!this._blockedAt(nx, this.pos.z, feet)) this.pos.x = nx; else this.vel.x *= 0.2;
    const nz = this.pos.z + this.vel.z * dt;
    if (!this._blockedAt(this.pos.x, nz, feet)) this.pos.z = nz; else this.vel.z *= 0.2;

    if (this.controls.consumeJump() && this.onGround && !frozen) { this.vy = JUMP_V; this.onGround = false; this.sfx('jump'); }
    if (this.controls.consumeAction() && !frozen) this._action();

    const ground = this._groundAt(this.pos.x, this.pos.z, this.pos.y);
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      if (!this.onGround && this.vy < -3) this.sfx('land');
      this.pos.y = ground; this.vy = 0; this.onGround = true;
    } else if (this.pos.y - ground > 0.05) {
      this.onGround = false;
    }
    if (this.trick > 0) this.trick = Math.max(0, this.trick - dt * 1.8);

    this.camera.position.set(this.pos.x, this.pos.y + EYE + 0.1, this.pos.z);
    this.world.followSun(this.pos);

    // my own board under my feet, visible when looking down
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.4) this.boardHeading = Math.atan2(this.vel.x, this.vel.z);
    this.myBoard.position.set(this.pos.x, this.pos.y + (this.onGround ? 0 : 0.05), this.pos.z);
    this.myBoard.rotation.set(0, this.boardHeading || 0, this.trick > 0 ? (1 - this.trick) * Math.PI * 2 : 0);
    this.speed = speed;

    // reaching the goal
    if (this.goalOpen && this.self.status !== 'done') {
      if (Math.hypot(this.pos.x - this.city.goal.x, this.pos.z - this.city.goal.z) < GOAL_R) this._finish();
    }
  }

  _action() {
    // pick up the closest item within reach; otherwise do a kickflip
    let best = null, bd = PICK_ACTION;
    for (const it of this.items) {
      if (it.got) continue;
      const d = Math.hypot(it.x - this.pos.x, it.z - this.pos.z);
      if (d < bd) { bd = d; best = it; }
    }
    if (best) { this._collect(best); return; }
    if (this.trick === 0) { this.trick = 1; if (this.onGround) { this.vy = JUMP_V * 0.75; this.onGround = false; } this.sfx('trick'); }
  }

  _updateItems(dt) {
    for (const it of this.items) {
      if (it.got) {
        if (it.mesh.visible) {
          it.fade -= dt * 3;
          it.mesh.scale.setScalar(Math.max(0.01, 1 + (1 - it.fade) * 1.5));
          it.mesh.children.forEach((c) => { if (c.material) c.material.opacity = Math.max(0, it.fade); });
          if (it.fade <= 0) { it.mesh.visible = false; this.scene.remove(it.mesh); }
        }
        continue;
      }
      it.mesh.position.y = 1.1 + Math.sin(this.t * 2.2 + it.i) * 0.18;
      it.mesh.rotation.y += dt;
      const d = Math.hypot(it.x - this.pos.x, it.z - this.pos.z);
      if (d < PICK_AUTO && Math.abs(this.pos.y - 0) < 2.5) this._collect(it);
    }
    if (this.goalMarker.visible) {
      this.goalMarker.children[0].material.opacity = 0.45 + Math.sin(this.t * 3) * 0.12;
      this.goalMarker.children[2].rotation.z += dt * 0.8;
    }
  }

  _collect(it) {
    it.got = true; it.fade = 1;
    this.self.found++;
    this.sfx('pickup');
    this.net.send('got', { n: this.self.found, i: it.i });
    if (this.goalOpen) {
      this.self.status = 'goal';
      this.goalMarker.visible = true;
      this.hud.notify('All items found! Head to the red goal.', 3500);
      this.sfx('reveal');
    } else {
      this.hud.notify(`Gotcha! ${this.self.found} of ${this.self.total}`, 1500);
    }
  }

  _finish() {
    this.self.status = 'done';
    const elapsed = (performance.now() - this.startAt) / 1000;
    this.self.time = elapsed;
    this.self.rank = this._nextRank();
    this.net.send('fin', { time: elapsed, rank: this.self.rank });
    this.sfx('goal');
    this.hud.notify(`You reached the goal! #${this.self.rank}`, 4000);
    this._checkEnd();
  }

  _nextRank() {
    let n = 0;
    for (const p of this.players.values()) if (p.status === 'done' && p.id !== this.me.id) n++;
    return n + 1;
  }

  _onNet(m) {
    const p = this.players.get(m.f);
    if (!p) return;
    p.lastSeen = performance.now();
    if (p.status === 'left' && m.t !== 'bye') { p.status = 'collecting'; if (p.avatar) this.scene.add(p.avatar); }
    switch (m.t) {
      case 'st': this.onState(m.f, m.d); break;
      case 'got':
        p.found = Math.max(p.found, m.d.n);
        if (p.found >= p.total && p.status === 'collecting') p.status = 'goal';
        break;
      case 'fin':
        if (p.status !== 'done') {
          p.status = 'done'; p.found = p.total; p.time = m.d.time; p.rank = m.d.rank || this._nextRank();
          this.hud.notify(`${p.name} reached the goal! 🎉`, 3500);
          this.sfx('other');
          this._checkEnd();
        }
        break;
      case 'bye': this._markLeft(p); break;
      default: break;
    }
  }

  // Position packets arrive here from both the data channel and the room transport.
  onState(id, d) {
    const p = this.players.get(id);
    if (!p || !p.avatar) return;
    p.lastSeen = performance.now();
    p.target.set(d.x, d.y, d.z);
    if (!p.seen) { p.pos.copy(p.target); p.seen = true; }
    p.heading = d.h; p.speed = d.s; p.air = !!d.a; p.trick = d.k || 0;
    if (typeof d.f === 'number' && d.f > p.found) p.found = d.f;
    if (d.st && p.status !== 'done' && p.status !== 'left') p.status = d.st;
  }

  _markLeft(p) {
    if (p.status === 'left' || p.id === this.me.id) return;
    p.status = 'left';
    if (p.avatar) { p.avatar.visible = false; this.scene.remove(p.avatar); }
    this.mesh.close(p.id);
    this.hud.notify(`${p.name} left the game`, 2500);
    this._checkEnd();
  }

  _updateOthers(dt, now) {
    for (const p of this.players.values()) {
      if (p.id === this.me.id) continue;
      if (p.status !== 'left' && now - p.lastSeen > 10000) this._markLeft(p);
      if (!p.avatar || p.status === 'left') continue;
      p.pos.lerp(p.target, Math.min(1, dt * 10));
      const d = p.pos.distanceTo(this.pos);
      p.avatar.visible = p.seen && d < VIEW_DIST;
      if (!p.avatar.visible) continue;
      p.avatar.position.copy(p.pos);
      let dh = p.heading - p.avatar.rotation.y;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      p.avatar.rotation.y += dh * Math.min(1, dt * 10);
      p.avatar.userData.animate(dt, p.speed, p.air, p.trick);
    }
  }

  _network(now) {
    const st = {
      x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2),
      h: +(this.boardHeading || 0).toFixed(2), s: +this.speed.toFixed(1), a: this.onGround ? 0 : 1, k: +this.trick.toFixed(2),
      f: this.self.found, st: this.self.status,
    };
    if (now - this.lastSend > 80) {
      this.lastSend = now;
      this.mesh.broadcast(st);
    }
    // relay through the room channel too, slower, for anyone without a direct link
    const needRelay = [...this.players.values()].some((p) => p.id !== this.me.id && p.status !== 'left' && !this.mesh.isOpen(p.id));
    if (needRelay && now - this.lastNetSend > 250) { this.lastNetSend = now; this.net.send('st', st); }
    if (now - this.lastHb > 2000) { this.lastHb = now; this.net.send('hb', { name: this.me.name, game: true }); }
  }

  _updateHud() {
    const list = [...this.players.values()];
    this.hud.renderPlayers(list, this.me.id);
    this.hud.setMe(this.self.status === 'done' ? `Finished #${this.self.rank}` : this.goalOpen ? 'Head to the red goal!' : `Items ${this.self.found} / ${this.self.total}`);
    const items = this.items.filter((i) => !i.got);
    const others = list.filter((p) => p.id !== this.me.id && p.status !== 'left' && p.seen).map((p) => ({ x: p.pos.x, z: p.pos.z, color: p.color }));
    this.hud.drawMap({ x: this.pos.x, z: this.pos.z, heading: this.heading }, items, others, this.goalOpen ? this.city.goal : null, this.t);
  }

  _render() {
    const r = this.renderer;
    this.camera.updateMatrixWorld();
    if (this.settings.stereo) {
      const size = r.getSize(new THREE.Vector2());
      this.stereo.update(this.camera);
      r.setScissorTest(true);
      r.setScissor(0, 0, size.x / 2, size.y); r.setViewport(0, 0, size.x / 2, size.y);
      r.render(this.scene, this.stereo.cameraL);
      r.setScissor(size.x / 2, 0, size.x / 2, size.y); r.setViewport(size.x / 2, 0, size.x / 2, size.y);
      r.render(this.scene, this.stereo.cameraR);
      r.setScissorTest(false);
      r.setViewport(0, 0, size.x, size.y);
    } else {
      r.render(this.scene, this.camera);
    }
  }

  _checkEnd() {
    const active = [...this.players.values()].filter((p) => p.status !== 'left');
    if (active.length && active.every((p) => p.status === 'done')) {
      setTimeout(() => this.onEnd(this.results()), 2500);
    }
  }

  results() {
    return [...this.players.values()].map((p) => ({ name: p.name, color: p.color, status: p.status, rank: p.rank, time: p.time, text: statusText(p) }))
      .sort((a, b) => (a.rank || 99) - (b.rank || 99));
  }
}

function glowTexture() {
  if (glowTexture.tex) return glowTexture.tex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,236,170,0.85)');
  grad.addColorStop(0.6, 'rgba(255,190,90,0.25)');
  grad.addColorStop(1, 'rgba(255,170,60,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  glowTexture.tex = new THREE.CanvasTexture(c);
  glowTexture.tex.colorSpace = THREE.SRGBColorSpace;
  return glowTexture.tex;
}

function makeItem() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffd27a }));
  halo.scale.set(2.6, 2.6, 1);
  // a faint light pillar so items are easier to spot down a street
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 14, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  pillar.position.y = 6;
  g.add(core, halo, pillar);
  return g;
}

function makeGoal() {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 60, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff5a4e, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 30;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(GOAL_R, GOAL_R, 0.08, 40), new THREE.MeshStandardMaterial({ color: 0xff8f7a, emissive: 0xff5a4e, emissiveIntensity: 0.4, roughness: 0.6 }));
  pad.position.y = 0.04;
  const ring = new THREE.Mesh(new THREE.RingGeometry(GOAL_R - 0.6, GOAL_R - 0.2, 40), new THREE.MeshBasicMaterial({ color: 0xfff3dc, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  g.add(beam, pad, ring);
  return g;
}
