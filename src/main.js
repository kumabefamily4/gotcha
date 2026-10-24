// App controller: title screen, lobby, starting a round, results.
import * as THREE from 'three';
import { connectRoom } from './net.js';
import { PeerMesh, getMic } from './voice.js';
import { requestMotionPermission } from './controls.js';
import { Music } from './music.js';
import { PLAYER_COLORS } from './avatar.js';
import { escapeHtml } from './hud.js';
import { Game } from './game.js';
import { CREDITS } from './credits.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  sget(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  sset(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
};

const LOBBY_TIMEOUT = 7000;
const MAX_PLAYERS = 8;

const app = {
  room: null, net: null, mesh: null, mic: null, micOn: false,
  me: { id: null, name: '', color: PLAYER_COLORS[0] },
  isHost: false,
  lobby: { phase: 'lobby', items: 4, expected: 0, players: [], hostId: null },
  seen: new Map(), // id -> { name, lastSeen }
  lastLobbyMsg: 0,
  game: null,
  settings: { stereo: store.get('gotcha-stereo', false), gyro: true },
  music: new Music(),
};

const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

function show(screen) {
  app.screen = screen;
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === screen);
  document.body.classList.toggle('ingame', screen === 'hud');
}

let toastTimer;
function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function randomId(n = 10) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(n));
  for (const b of r) s += a[b % a.length];
  return s;
}

// --- Title screen -----------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const joinCode = (params.get('g') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
$('name').value = store.get('gotcha-name', '');
$('credits').textContent = CREDITS;
if (joinCode) {
  $('btn-join').classList.remove('hidden');
  $('join-code').textContent = joinCode.toUpperCase();
  $('btn-create').classList.add('hidden');
  $('home-hint').textContent = 'You were invited to a game. Enter your name and join.';
}

async function enter(asHost) {
  const name = $('name').value.trim().slice(0, 14);
  if (!name) { $('name').focus(); toast('Enter a name first'); return; }
  store.set('gotcha-name', name);
  // Everything that needs a tap on iOS happens here, inside the click.
  const motion = requestMotionPermission();
  app.music.unlock();
  app.settings.gyro = await motion;
  if (!app.settings.gyro) toast('Motion sensor off: drag on the screen to look around', 3500);

  app.room = asHost ? randomId(6) : joinCode;
  const idKey = 'gotcha-id-' + app.room;
  app.me.id = store.sget(idKey) || randomId(10);
  store.sset(idKey, app.me.id);
  app.me.name = name;
  app.isHost = asHost || store.sget('gotcha-host-' + app.room) === '1';
  if (asHost) store.sset('gotcha-host-' + app.room, '1');

  const url = new URL(location.href);
  url.search = '?g=' + app.room;
  history.replaceState(null, '', url);

  $('btn-create').disabled = $('btn-join').disabled = true;
  try {
    app.net = await connectRoom(app.room, app.me.id);
  } finally {
    $('btn-create').disabled = $('btn-join').disabled = false;
  }
  if (app.net.warning) toast(app.net.warning, 6000);
  app.net.on(onNet);
  app.mesh = new PeerMesh(app.net, app.me.id, {
    onData: (from, d) => { if (app.game) app.game.onState(from, d); },
  });
  if (app.isHost) {
    app.lobby.hostId = app.me.id;
    app.lobby.players = [{ id: app.me.id, name, color: PLAYER_COLORS[0], host: true }];
  }
  window.addEventListener('pagehide', () => app.net && app.net.send('bye', {}));
  setInterval(tick, 1000);
  tick();
  enterLobby();
  // ask for the microphone right away; voice is on by default
  setMic(true);
}

$('btn-create').addEventListener('click', () => enter(true));
$('btn-join').addEventListener('click', () => enter(false));
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') (joinCode ? $('btn-join') : $('btn-create')).click(); });

// --- Lobby ------------------------------------------------------------------------------
function enterLobby() {
  show('lobby');
  document.body.classList.remove('wantlandscape');
  app.music.play('lobby');
  $('share-url').value = location.origin + location.pathname + '?g=' + app.room;
  renderLobby();
}

function tick() {
  const now = Date.now();
  app.net.send('hb', { name: app.me.name, game: !!app.game });
  if (app.isHost) {
    // drop players who stopped sending heartbeats (only while waiting in the lobby)
    if (!app.game) {
      const before = app.lobby.players.length;
      app.lobby.players = app.lobby.players.filter((p) => p.id === app.me.id || (app.seen.get(p.id) && now - app.seen.get(p.id).lastSeen < LOBBY_TIMEOUT));
      if (before !== app.lobby.players.length) renderLobby();
    }
    app.net.send('lobby', app.lobby);
  } else if (!app.game && app.lastLobbyMsg && now - app.lastLobbyMsg > 9000) {
    $('lobby-status').textContent = 'Lost contact with the host. Waiting…';
  }
  if (app.mesh && app.game) {
    for (const [id, p] of app.game.players) if (id !== app.me.id && p.status !== 'left') app.mesh.ensure(id);
  }
}

function onNet(m) {
  const now = Date.now();
  if (m.t === 'hb') {
    app.seen.set(m.f, { name: m.d.name, lastSeen: now });
    if (app.isHost && !app.game && !app.lobby.players.some((p) => p.id === m.f)) {
      if (app.lobby.players.length < MAX_PLAYERS) {
        const used = new Set(app.lobby.players.map((p) => p.color));
        const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[app.lobby.players.length % PLAYER_COLORS.length];
        app.lobby.players.push({ id: m.f, name: String(m.d.name || 'Player').slice(0, 14), color });
        app.net.send('lobby', app.lobby);
        renderLobby();
        app.sfx('join');
      }
    } else if (app.isHost) {
      const p = app.lobby.players.find((pp) => pp.id === m.f);
      if (p && m.d.name && p.name !== m.d.name) { p.name = String(m.d.name).slice(0, 14); renderLobby(); }
    }
  } else if (m.t === 'lobby' && !app.isHost) {
    app.lastLobbyMsg = now;
    const prev = JSON.stringify(app.lobby);
    app.lobby = m.d;
    const mine = app.lobby.players.find((p) => p.id === app.me.id);
    if (mine) app.me.color = mine.color;
    if (app.lobby.phase === 'lobby' && (app.game || app.screen === 'results')) {
      endGame();
      enterLobby();
    } // host went back to the lobby
    if (prev !== JSON.stringify(app.lobby) && !app.game) renderLobby();
  } else if (m.t === 'start') {
    if (app.game) return;
    if (!m.d.players.some((p) => p.id === app.me.id)) {
      $('lobby-status').textContent = 'A round is in progress. You will join the next one.';
      return;
    }
    startGame(m.d);
  } else if (m.t === 'bye' && app.isHost && !app.game) {
    app.lobby.players = app.lobby.players.filter((p) => p.id !== m.f);
    renderLobby();
  }
}

function renderLobby() {
  const L = app.lobby;
  const list = $('player-list');
  const rows = L.players.map((p) => `<li><span class="dot" style="background:${hex(p.color)}"></span>${escapeHtml(p.name)}
    ${p.id === app.me.id ? '<span class="you">(you)</span>' : ''}${p.host || p.id === L.hostId ? '<span class="badge">HOST</span>' : ''}</li>`);
  const waitingFor = Math.max(0, (L.expected || 0) - L.players.length);
  for (let i = 0; i < waitingFor; i++) rows.push('<li class="empty">Waiting for a player to join…</li>');
  list.innerHTML = rows.join('');
  $('player-count').textContent = L.expected ? `${L.players.length} of ${L.expected} joined` : `${L.players.length} joined`;
  $('items-val').textContent = L.items;
  $('items-ro').textContent = L.items;
  $('expected-val').textContent = L.expected || '–';
  $('host-settings').classList.toggle('hidden', !app.isHost);
  $('guest-settings').classList.toggle('hidden', app.isHost);
  $('btn-start').classList.toggle('hidden', !app.isHost);
  if (app.isHost) {
    $('lobby-status').textContent = L.players.length < 2 ? 'Share the link. You can also start alone to explore.' : waitingFor ? `Still waiting for ${waitingFor}. Start whenever you like.` : 'Everyone is here!';
  } else if (!L.players.some((p) => p.id === app.me.id)) {
    $('lobby-status').textContent = app.lastLobbyMsg ? 'Joining…' : 'Connecting to the host…';
  } else {
    $('lobby-status').textContent = 'Waiting for the host to start the game…';
  }
  for (const b of document.querySelectorAll('#view-mode button')) b.classList.toggle('on', (b.dataset.mode === 'stereo') === app.settings.stereo);
}

for (const b of document.querySelectorAll('[data-step]')) {
  b.addEventListener('click', () => {
    const [key, d] = b.dataset.step.split(':');
    if (key === 'items') app.lobby.items = Math.max(1, Math.min(10, app.lobby.items + Number(d)));
    if (key === 'expected') app.lobby.expected = Math.max(0, Math.min(MAX_PLAYERS, (app.lobby.expected || 0) + Number(d)));
    app.net.send('lobby', app.lobby);
    renderLobby();
  });
}
for (const b of document.querySelectorAll('#view-mode button')) {
  b.addEventListener('click', () => { setStereo(b.dataset.mode === 'stereo'); renderLobby(); });
}

$('btn-share').addEventListener('click', async () => {
  const url = $('share-url').value;
  if (navigator.share) {
    try { await navigator.share({ title: 'Gotcha!', text: `Join my Gotcha! game`, url }); return; } catch { /* cancelled */ }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { $('share-url').select(); toast('Copy the link above'); }
});

async function setMic(on) {
  if (on && !app.mic) {
    app.mic = await getMic();
    if (!app.mic) { toast('Microphone not available. You can still hear others.'); on = false; }
    app.mesh.setMic(app.mic);
  }
  app.micOn = on;
  app.mesh.setMuted(!on);
  $('btn-mic-lobby').textContent = on ? 'On' : 'Off';
  $('btn-mic-lobby').classList.toggle('on', on);
  $('btn-mic').classList.toggle('off', !on);
}
$('btn-mic-lobby').addEventListener('click', () => setMic(!app.micOn));
$('btn-mic').addEventListener('click', () => setMic(!app.micOn));

function setStereo(on) {
  app.settings.stereo = on;
  store.set('gotcha-stereo', on);
  $('btn-stereo').classList.toggle('on', on);
  if (app.game) app.game.setStereo(on);
}
$('btn-stereo').addEventListener('click', () => setStereo(!app.settings.stereo));
$('btn-recenter').addEventListener('click', () => app.game && app.game.controls.recenter());
let musicMuted = store.get('gotcha-music-muted', false);
app.music.setMuted(musicMuted);
$('btn-music').classList.toggle('off', musicMuted);
$('btn-music').addEventListener('click', () => {
  musicMuted = !musicMuted; store.set('gotcha-music-muted', musicMuted);
  app.music.setMuted(musicMuted); $('btn-music').classList.toggle('off', musicMuted);
});

// --- Starting a round -------------------------------------------------------------------
$('btn-start').addEventListener('click', async () => {
  if (!app.isHost || app.game) return;
  $('btn-start').disabled = true;
  show('loading');
  $('loading-text').textContent = 'Building the city and hiding items…';
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const players = app.lobby.players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
  try {
    const items = await assignInWorker(seed, players.map((p) => p.id), app.lobby.items);
    const setup = { seed, items, players, count: app.lobby.items };
    app.lobby.phase = 'game';
    app.net.send('lobby', app.lobby);
    app.net.send('start', setup);
    startGame(setup);
  } catch (e) {
    console.error(e);
    toast('Could not start the game: ' + e.message);
    show('lobby');
  } finally {
    $('btn-start').disabled = false;
  }
});

function assignInWorker(seed, ids, count) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./assign-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { w.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.items); };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'worker failed')); };
    w.postMessage({ seed, ids, count });
  });
}

function startGame(setup) {
  show('loading');
  $('loading-text').textContent = 'Building the city…';
  // let the loading screen paint before the heavy work
  setTimeout(() => {
    const me = { ...app.me, color: (setup.players.find((p) => p.id === app.me.id) || {}).color || app.me.color };
    app.game = new Game({
      canvas: $('view'), renderer, net: app.net, mesh: app.mesh, me, setup, settings: app.settings,
      sfx: app.sfx, onEnd: showResults,
    });
    for (const p of setup.players) if (p.id !== app.me.id) app.mesh.ensure(p.id);
    show('hud');
    $('btn-stereo').classList.toggle('on', app.settings.stereo);
    app.music.play('game');
    app.game.start(3200);
  }, 60);
}

function showResults(results) {
  const list = $('results-list');
  list.innerHTML = results.map((r) => `<li><span style="color:${hex(r.color)}">●</span> ${escapeHtml(r.name)}
    <span class="time">${r.status === 'done' ? formatTime(r.time) : r.text}</span></li>`).join('');
  $('btn-again').classList.toggle('hidden', !app.isHost);
  $('results-hint').textContent = app.isHost ? '' : 'Waiting for the host…';
  endGame(true);
  show('results');
}

function endGame(keepScreen) {
  if (!app.game) return;
  app.game.stop();
  app.game = null;
  app.mesh.closeAll();
  app.mesh = new PeerMesh(app.net, app.me.id, { onData: (from, d) => { if (app.game) app.game.onState(from, d); } });
  app.mesh.setMic(app.mic);
  app.mesh.setMuted(!app.micOn);
  if (!keepScreen) enterLobby();
}

$('btn-again').addEventListener('click', () => {
  app.lobby.phase = 'lobby';
  app.net.send('lobby', app.lobby);
  enterLobby();
});

function formatTime(s) {
  if (typeof s !== 'number') return '';
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

// --- Sound effects ----------------------------------------------------------------------
app.sfx = (kind) => {
  const ctx = app.music.ctx;
  if (!ctx) return;
  const t = ctx.currentTime;
  const tone = (f, at, d, type = 'sine', v = 0.18) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(v, t + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + at + d);
    o.connect(g); g.connect(ctx.destination); o.start(t + at); o.stop(t + at + d + 0.05);
  };
  if (kind === 'pickup') { tone(1046, 0, 0.18); tone(1568, 0.07, 0.3); }
  else if (kind === 'reveal') { [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.09, 0.35, 'triangle', 0.14)); }
  else if (kind === 'goal') { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.11, 0.5, 'triangle', 0.16)); }
  else if (kind === 'other') { tone(880, 0, 0.2, 'triangle', 0.1); tone(660, 0.12, 0.3, 'triangle', 0.1); }
  else if (kind === 'jump') tone(420, 0, 0.12, 'triangle', 0.08);
  else if (kind === 'land') tone(140, 0, 0.1, 'sine', 0.12);
  else if (kind === 'trick') { tone(600, 0, 0.08, 'square', 0.04); tone(900, 0.06, 0.1, 'square', 0.04); }
  else if (kind === 'join') { tone(660, 0, 0.15, 'triangle', 0.1); tone(990, 0.1, 0.2, 'triangle', 0.1); }
};

// iOS can pause remote audio until the next touch
window.addEventListener('pointerdown', () => { if (app.mesh) app.mesh.resumeAudio(); if (app.music.ctx && app.music.ctx.state === 'suspended') app.music.ctx.resume(); }, { passive: true });

// landscape hint on the title screen for phones
document.body.classList.toggle('wantlandscape', false);
show('home');
