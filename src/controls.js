// Input: gyroscope look, drag-to-look, left-thumb joystick, jump/action buttons, keyboard.
import * as THREE from 'three';

const zee = new THREE.Vector3(0, 0, 1);
const qScreen = new THREE.Quaternion();
const qWorld = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // camera looks out the back of the device
const euler = new THREE.Euler();
const yAxis = new THREE.Vector3(0, 1, 0);

export async function requestMotionPermission() {
  // iOS 13+: must be called from inside a tap handler.
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    try { return (await DOE.requestPermission()) === 'granted'; } catch { return false; }
  }
  return 'DeviceOrientationEvent' in window;
}

export class Controls {
  constructor(el, ui) {
    this.el = el;
    this.move = new THREE.Vector2(); // x: strafe right, y: forward
    this.jumpPressed = false;
    this.actionPressed = false;
    this.yawOffset = 0; // added by dragging / recentering
    this.pitch = 0; // only used without a gyroscope
    this.gyro = null; // {alpha,beta,gamma}
    this.gyroEnabled = false;
    this.keys = new Set();
    this.quat = new THREE.Quaternion();

    this._onOrient = (e) => {
      if (e.alpha === null) return;
      this.gyro = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
    };
    window.addEventListener('deviceorientation', this._onOrient);

    this._setupJoystick(ui.stick, ui.knob);
    this._setupButton(ui.jump, () => { this.jumpPressed = true; });
    this._setupButton(ui.action, () => { this.actionPressed = true; });
    this._setupDragLook(el);

    this._kd = (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this.jumpPressed = true; e.preventDefault(); }
      if (e.code === 'KeyE' || e.code === 'Enter') this.actionPressed = true;
    };
    this._ku = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
  }

  dispose() {
    window.removeEventListener('deviceorientation', this._onOrient);
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
  }

  _setupJoystick(stick, knob) {
    let id = null, cx = 0, cy = 0;
    const R = () => stick.clientWidth * 0.42;
    const set = (x, y) => {
      let dx = x - cx, dy = y - cy;
      const r = R(), len = Math.hypot(dx, dy);
      if (len > r) { dx *= r / len; dy *= r / len; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // small dead zone, then a smooth ramp
      const m = Math.min(1, len / r);
      const k = m < 0.12 ? 0 : (m - 0.12) / 0.88;
      const a = Math.atan2(dy, dx);
      this.move.set(Math.cos(a) * k, -Math.sin(a) * k);
    };
    const end = () => { id = null; knob.style.transform = ''; this.move.set(0, 0); stick.classList.remove('active'); };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      stick.setPointerCapture(id);
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      stick.classList.add('active');
      set(e.clientX, e.clientY);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e.clientX, e.clientY); });
    stick.addEventListener('pointerup', (e) => { if (e.pointerId === id) end(); });
    stick.addEventListener('pointercancel', (e) => { if (e.pointerId === id) end(); });
  }

  _setupButton(btn, fn) {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('down'); fn(); });
    const up = () => btn.classList.remove('down');
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }

  _setupDragLook(el) {
    let id = null, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId; lx = e.clientX; ly = e.clientY;
      el.setPointerCapture(id);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      this.yawOffset -= dx * 0.0055;
      if (!this.gyroActive) this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -1.3, 1.3);
    });
    const end = (e) => { if (e.pointerId === id) id = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  get gyroActive() { return this.gyroEnabled && !!this.gyro; }

  // Sets the look direction to "straight ahead along the current heading" (resets drift).
  recenter() {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
    const heading = Math.atan2(-fwd.x, -fwd.z);
    if (this.gyroActive) {
      const raw = this._rawGyroQuat(new THREE.Quaternion());
      const f2 = new THREE.Vector3(0, 0, -1).applyQuaternion(raw);
      this.yawOffset = heading - Math.atan2(-f2.x, -f2.z);
    }
    this.pitch = 0;
  }

  _rawGyroQuat(q) {
    const d = THREE.MathUtils.DEG2RAD;
    const { alpha, beta, gamma } = this.gyro;
    const orient = (screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : window.orientation || 0) * d;
    euler.set(beta * d, alpha * d, -gamma * d, 'YXZ');
    q.setFromEuler(euler);
    q.multiply(qWorld);
    q.multiply(qScreen.setFromAxisAngle(zee, -orient));
    return q;
  }

  // Updates and returns the camera orientation.
  update() {
    const yawQ = new THREE.Quaternion().setFromAxisAngle(yAxis, this.yawOffset);
    if (this.gyroActive) {
      this._rawGyroQuat(this.quat);
      this.quat.premultiply(yawQ);
    } else {
      // keyboard turning for desktop testing
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyQ')) this.yawOffset += 0.035;
      if (this.keys.has('ArrowRight')) this.yawOffset -= 0.035;
      this.quat.setFromEuler(euler.set(this.pitch, this.yawOffset, 0, 'YXZ'));
    }
    return this.quat;
  }

  // Movement intent in camera-relative axes, joystick or WASD.
  moveIntent(out) {
    out.copy(this.move);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) out.y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) out.y -= 1;
    if (this.keys.has('KeyA')) out.x -= 1;
    if (this.keys.has('KeyD')) out.x += 1;
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  consumeJump() { const j = this.jumpPressed; this.jumpPressed = false; return j; }
  consumeAction() { const a = this.actionPressed; this.actionPressed = false; return a; }
}
