// Background music. Plays music/lobby.mp3 and music/game.mp3 when present; otherwise a
// built-in synthesized J-Pop-style loop (royal road progression IV-V-iii-vi) so the game
// is never silent.

const FILES = { lobby: 'music/lobby.mp3', game: 'music/game.mp3' };

export class Music {
  constructor() {
    this.ctx = null;
    this.current = null;
    this.muted = false;
    this.el = new Audio();
    this.el.loop = true;
    this.el.preload = 'auto';
    this.el.setAttribute('playsinline', '');
    this.available = {};
    this.synth = null;
    this.volume = 0.55;
  }

  // Must be called from a tap so iOS lets audio start.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // prime the media element inside the gesture
    if (this.el.paused) { this.el.muted = true; this.el.play().then(() => { this.el.pause(); this.el.muted = false; }).catch(() => {}); }
  }

  async _hasFile(name) {
    if (name in this.available) return this.available[name];
    try {
      const r = await fetch(FILES[name], { method: 'HEAD' });
      this.available[name] = r.ok && (r.headers.get('content-type') || '').startsWith('audio');
    } catch { this.available[name] = false; }
    return this.available[name];
  }

  async play(name) {
    if (this.current === name) return;
    this.current = name;
    this.stopSynth();
    this.el.pause();
    if (await this._hasFile(name)) {
      if (this.current !== name) return;
      this.el.src = FILES[name];
      this.el.volume = this.muted ? 0 : this.volume;
      this.el.play().catch(() => {});
    } else if (this.ctx) {
      if (this.current !== name) return;
      this.synth = new SynthSong(this.ctx, this.master, name === 'lobby' ? LOBBY : GAME);
      this.synth.start();
    }
  }

  stop() { this.current = null; this.el.pause(); this.stopSynth(); }
  stopSynth() { if (this.synth) { this.synth.stop(); this.synth = null; } }

  setMuted(m) {
    this.muted = m;
    this.el.volume = m ? 0 : this.volume;
    if (this.master) this.master.gain.value = m ? 0 : 0.32;
  }

  // Duck the music while people talk.
  setDuck(on) {
    const v = this.muted ? 0 : on ? this.volume * 0.45 : this.volume;
    this.el.volume = v;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(on ? 0.15 : 0.32, this.ctx.currentTime, 0.2);
  }
}

// --- Synth fallback -------------------------------------------------------------------
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
// chords as MIDI notes (key of D major): G, A, F#m, Bm  (IV - V - iii - vi)
const ROYAL = [[55, 59, 62, 66], [57, 61, 64, 67], [54, 57, 61, 64], [59, 62, 66, 69]];
const LOBBY = {
  bpm: 92, chords: ROYAL, swing: 0.08, drums: 'soft', arp: false,
  // melody: [step(16ths), midi, length(16ths)] per 4-bar loop
  melody: [[0, 74, 3], [4, 73, 2], [6, 71, 2], [8, 69, 6], [16, 73, 3], [20, 74, 2], [22, 76, 2], [24, 73, 6],
    [32, 73, 3], [36, 71, 2], [38, 69, 2], [40, 66, 6], [48, 71, 2], [50, 73, 2], [52, 74, 4], [56, 73, 2], [58, 71, 4]],
};
const GAME = {
  bpm: 148, chords: [...ROYAL, [52, 55, 59, 62], [57, 61, 64, 67], [50, 54, 57, 62], [57, 61, 64, 69]], swing: 0, drums: 'four', arp: true,
  melody: [[0, 78, 2], [2, 76, 2], [4, 74, 2], [6, 76, 4], [12, 74, 2], [14, 73, 2], [16, 76, 2], [18, 74, 2], [20, 73, 2], [22, 74, 4], [28, 71, 2], [30, 73, 2],
    [32, 73, 2], [34, 71, 2], [36, 69, 2], [38, 73, 4], [44, 76, 2], [46, 78, 2], [48, 79, 4], [52, 78, 2], [54, 76, 2], [56, 78, 6],
    [64, 76, 2], [66, 74, 2], [68, 71, 2], [70, 74, 4], [76, 73, 2], [78, 74, 2], [80, 76, 4], [84, 74, 2], [86, 73, 2], [88, 69, 6],
    [96, 74, 2], [98, 76, 2], [100, 78, 4], [104, 81, 4], [108, 78, 2], [110, 76, 2], [112, 74, 4], [116, 73, 4], [120, 74, 8]],
};

class SynthSong {
  constructor(ctx, out, song) {
    this.ctx = ctx; this.song = song;
    this.out = ctx.createGain(); this.out.gain.value = 1; this.out.connect(out);
    this.step = 0; this.timer = null; this.next = 0;
    this.noise = makeNoise(ctx);
    // soft room reverb via feedback delay
    this.delay = ctx.createDelay(); this.delay.delayTime.value = (60 / song.bpm) * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    this.delay.connect(fb); fb.connect(this.delay); this.delay.connect(wet); wet.connect(this.out);
  }
  start() {
    this.next = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this._schedule(), 25);
  }
  stop() {
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.15);
    setTimeout(() => this.out.disconnect(), 800);
  }
  _schedule() {
    const s16 = 60 / this.song.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.15) {
      this._playStep(this.step, this.next, s16);
      this.step++;
      this.next += s16 * (this.song.swing && this.step % 2 ? 1 + this.song.swing : this.song.swing ? 1 - this.song.swing : 1);
    }
  }
  _playStep(step, t, s16) {
    const song = this.song;
    const bars = song.chords.length;
    const loopLen = bars * 16;
    const st = step % loopLen;
    const bar = Math.floor(st / 16), b16 = st % 16;
    const chord = song.chords[bar];
    // chords: electric-piano stabs
    if (song.drums === 'soft' ? b16 === 0 || b16 === 10 : b16 % 4 === 2) {
      for (const n of chord) this._ep(NOTE(n), t, s16 * (song.drums === 'soft' ? 6 : 1.6), 0.05);
    }
    // bass
    const root = chord[0] - 24;
    if (song.drums === 'four') {
      if (b16 % 2 === 0) this._bass(NOTE(root + (b16 % 4 === 2 ? 12 : 0)), t, s16 * 1.6, 0.16);
    } else if (b16 === 0 || b16 === 6 || b16 === 8) this._bass(NOTE(root), t, s16 * 3, 0.14);
    // arpeggio sparkle
    if (song.arp && b16 % 1 === 0) {
      const n = chord[(b16 * 3) % chord.length] + 12;
      this._bell(NOTE(n), t, s16 * 0.9, 0.025);
    }
    // melody (loops over its own length)
    const melLen = song.melody.reduce((a, [s, , l]) => Math.max(a, s + l), 0) <= 64 ? 64 : 128;
    const ms = st % melLen;
    for (const [s, n, l] of song.melody) if (s === ms) this._lead(NOTE(n), t, s16 * l * 0.95, song.drums === 'soft' ? 0.07 : 0.06);
    // drums
    if (song.drums === 'four') {
      if (b16 % 4 === 0) this._kick(t, 0.5);
      if (b16 % 8 === 4) this._snare(t, 0.22);
      if (b16 % 2 === 1) this._hat(t, 0.06);
    } else {
      if (b16 === 0 || b16 === 10) this._kick(t, 0.3);
      if (b16 === 8) this._snare(t, 0.1);
      if (b16 % 2 === 0) this._hat(t, 0.025);
    }
  }
  _env(g, t, a, d, peak) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  _osc(type, f, t, dur, peak, { attack = 0.005, dest = this.out, detune = 0, send = 0 } = {}) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    this._env(g, t, attack, dur, peak);
    o.connect(g); g.connect(dest);
    if (send) { const s = this.ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(this.delay); }
    o.start(t); o.stop(t + attack + dur + 0.05);
  }
  _ep(f, t, d, v) { this._osc('sine', f, t, d, v, { send: 0.5 }); this._osc('triangle', f * 2, t, d * 0.5, v * 0.3); }
  _bass(f, t, d, v) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 520;
    this._env(g, t, 0.005, d, v);
    o.connect(lp); lp.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + d + 0.05);
  }
  _lead(f, t, d, v) {
    this._osc('square', f, t, d, v * 0.5, { attack: 0.01, send: 0.6, detune: -6 });
    this._osc('triangle', f, t, d, v, { attack: 0.01, send: 0.6, detune: 6 });
  }
  _bell(f, t, d, v) { this._osc('sine', f, t, d, v, { send: 0.8 }); }
  _kick(t, v) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this._env(g, t, 0.002, 0.22, v);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.3);
  }
  _snare(t, v) { this._noiseHit(t, v, 1800, 0.16); }
  _hat(t, v) { this._noiseHit(t, v, 7000, 0.04); }
  _noiseHit(t, v, freq, d) {
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
    s.buffer = this.noise; f.type = 'highpass'; f.frequency.value = freq;
    this._env(g, t, 0.001, d, v);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t); s.stop(t + d + 0.05);
  }
}

function makeNoise(ctx) {
  const b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
