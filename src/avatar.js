// Low-poly skateboarder character: beanie, hoodie, loose pants, sneakers, board.
import * as THREE from 'three';

export const PLAYER_COLORS = [0xff8f6b, 0x5fbfb4, 0xffc857, 0x9b8cf0, 0xff6f9c, 0x6fb3f2, 0x8fd16f, 0xf2a65a];

const mat = (color, rough = 0.7) => new THREE.MeshStandardMaterial({ color, roughness: rough });

export function makeBoard(accent = 0xff8f6b) {
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.8), mat(accent, 0.5));
  deck.position.y = 0.1;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.005, 0.74), mat(0x2b2f3a, 0.95));
  grip.position.y = 0.118;
  // kicktails
  for (const s of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.12), mat(accent, 0.5));
    tail.position.set(0, 0.125, s * 0.43);
    tail.rotation.x = s * 0.35;
    g.add(tail);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.04, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wm = mat(0xfff3dc, 0.4);
  for (const z of [-0.27, 0.27]) for (const x of [-0.09, 0.09]) {
    const w = new THREE.Mesh(wheelGeo, wm);
    w.position.set(x, 0.035, z);
    g.add(w);
  }
  g.add(deck, grip);
  return g;
}

export function makeSkater(color, name) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // rotated sideways on the board, like a real stance
  root.add(body);

  const hoodie = mat(color, 0.85);
  const pants = mat(0x3d4a63, 0.9);
  const skin = mat(0xf5c7a1, 0.6);
  const shoe = mat(0xfafafa, 0.6);
  const beanieColor = new THREE.Color(color).offsetHSL(0.08, 0, -0.08);
  const beanie = mat(beanieColor, 0.9);

  const legGeo = new THREE.CapsuleGeometry(0.075, 0.55, 4, 8);
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0, 0.95, s * 0.17);
    const leg = new THREE.Mesh(legGeo, pants);
    leg.position.y = -0.38;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.12), shoe);
    foot.position.set(0.04, -0.75, 0);
    hip.add(leg, foot);
    body.add(hip);
    legs.push(hip);
  }

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.36, 4, 10), hoodie);
  torso.scale.set(0.85, 1, 1.15);
  torso.position.y = 1.28;
  body.add(torso);
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.05, 6, 14), hoodie);
  hood.rotation.x = Math.PI / 2;
  hood.position.y = 1.56;
  body.add(hood);

  const armGeo = new THREE.CapsuleGeometry(0.06, 0.45, 4, 8);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(0, 1.47, s * 0.27);
    const arm = new THREE.Mesh(armGeo, hoodie);
    arm.position.y = -0.27;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), skin);
    hand.position.y = -0.55;
    sh.add(arm, hand);
    sh.rotation.x = s * 0.5; // arms out for balance
    body.add(sh);
    arms.push(sh);
  }

  const head = new THREE.Group();
  head.position.y = 1.72;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), skin);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), beanie);
  cap.position.y = 0.02;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.162, 0.06, 14), beanie);
  cuff.position.y = 0.02;
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(0xfff3dc));
  pom.position.y = 0.19;
  head.add(face, cap, cuff, pom);
  body.add(head);
  body.rotation.y = Math.PI / 2; // stand sideways
  body.position.y = 0.12;

  const board = makeBoard(color);
  root.add(board);

  const label = makeLabel(name, color);
  label.position.y = 2.25;
  root.add(label);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

  let phase = 0;
  root.userData.animate = (dt, speed, airborne, trick) => {
    phase += dt * (4 + speed * 0.8);
    // push with the back foot when rolling, crouch when in the air
    const pushing = speed > 0.5 && !airborne;
    const push = pushing ? Math.sin(phase) : 0;
    legs[1].rotation.z = pushing ? Math.max(0, push) * 0.7 : 0;
    legs[1].position.y = 0.95 - (pushing ? Math.max(0, -push) * 0.06 : 0);
    const crouch = airborne ? 0.12 : 0.02 + speed * 0.004;
    body.position.y = 0.12 - crouch;
    legs[0].rotation.z = airborne ? -0.25 : 0;
    arms[0].rotation.x = -0.5 - (airborne ? 0.6 : 0) + Math.sin(phase * 0.5) * 0.05;
    arms[1].rotation.x = 0.5 + (airborne ? 0.6 : 0) - Math.sin(phase * 0.5) * 0.05;
    torso.rotation.z = -speed * 0.015;
    // kickflip when doing a trick
    board.rotation.z = trick > 0 ? (1 - trick) * Math.PI * 2 : 0;
    board.position.y = airborne ? 0.05 : 0;
  };
  root.userData.dispose = () => root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } if (o.isSprite) o.material.map.dispose(); });
  return root;
}

export function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '600 30px "Nunito", system-ui, sans-serif';
  const w = Math.min(240, ctx.measureText(text).width + 36);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  roundRect(ctx, (256 - w) / 2, 8, w, 48, 24);
  ctx.fill();
  ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
  ctx.beginPath(); ctx.arc((256 - w) / 2 + 20, 32, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b3a4a';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, (256 - w) / 2 + 34, 33, w - 44);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(1.6, 0.4, 1);
  return s;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
