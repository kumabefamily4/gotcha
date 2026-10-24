// Builds the Three.js scene for a generated city.
import * as THREE from 'three';
import { HALF, SIZE } from './city.js';
import { drawGround } from './mapcanvas.js';

export const SUN_DIR = new THREE.Vector3(-0.62, 0.36, -0.7).normalize();

export function buildWorld(city, renderer) {
  const scene = new THREE.Scene();
  const horizon = new THREE.Color(0xffd9b3);
  scene.fog = new THREE.Fog(horizon, 90, 340);
  scene.background = horizon;

  scene.add(makeSky());

  // --- Lights: late-day sun
  const hemi = new THREE.HemisphereLight(0xbfe3fa, 0xf5c9a0, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc98a, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // --- Ground (water is cut out of it)
  const gtex = new THREE.CanvasTexture(drawGround(city, 4096));
  gtex.colorSpace = THREE.SRGBColorSpace;
  gtex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  gtex.generateMipmaps = true;
  gtex.minFilter = THREE.LinearMipmapLinearFilter;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.95, alphaTest: 0.5 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // outer ground so the horizon isn't a cliff
  const outer = new THREE.Mesh(
    new THREE.RingGeometry(SIZE * 0.72, 1400, 48, 1),
    new THREE.MeshStandardMaterial({ color: 0xa8dcb0, roughness: 1 }),
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  scene.add(outer);

  // --- River
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, 60, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4fb6cc, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.92 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.7, city.riverCenter(0));
  // the river wiggles more than a flat strip covers at its edges; widen the strip
  water.scale.z = 1;
  {
    let lo = Infinity, hi = -Infinity;
    for (let x = -HALF; x <= HALF; x += 4) { const c = city.riverCenter(x); lo = Math.min(lo, c); hi = Math.max(hi, c); }
    water.geometry = new THREE.PlaneGeometry(SIZE, hi - lo + city.riverHalfW * 2 + 6);
    water.position.z = (lo + hi) / 2;
  }
  scene.add(water);
  const riverbed = water.clone();
  riverbed.material = new THREE.MeshStandardMaterial({ color: 0x2f7f8f, roughness: 1 });
  riverbed.position.y = -2.2;
  scene.add(riverbed);

  // embankment walls
  {
    const segs = [];
    for (let x = -HALF; x < HALF; x += 3) {
      const c0 = city.riverCenter(x), c1 = city.riverCenter(x + 3);
      for (const s of [-1, 1]) segs.push({ x: x + 1.5, z: (c0 + c1) / 2 + s * city.riverHalfW, ang: Math.atan2(c1 - c0, 3) });
    }
    const geo = new THREE.BoxGeometry(3.2, 2.4, 0.5);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xe9dcc6, roughness: 0.9 }), segs.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    segs.forEach((s, i) => {
      q.setFromEuler(e.set(0, -s.ang, 0));
      m.compose(new THREE.Vector3(s.x, -1.15, s.z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // --- Bridges
  for (const b of city.bridges) {
    const g = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(b.w + 1.2, 0.5, b.d), new THREE.MeshStandardMaterial({ color: 0xd9c4a5, roughness: 0.8 }));
    deck.position.y = -0.24;
    deck.receiveShadow = true;
    g.add(deck);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(city.roadW, b.d), new THREE.MeshStandardMaterial({ color: 0x7a8696, roughness: 0.9 }));
    road.rotation.x = -Math.PI / 2; road.position.y = 0.02; road.receiveShadow = true;
    g.add(road);
    const railMat = new THREE.MeshStandardMaterial({ color: 0xff9a6b, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, b.d), railMat);
      rail.position.set(s * (b.w / 2 + 0.3), 1.05, 0);
      g.add(rail);
      for (let z = -b.d / 2; z <= b.d / 2; z += 2) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.05, 0.15), railMat);
        post.position.set(s * (b.w / 2 + 0.3), 0.52, z);
        g.add(post);
      }
      // arch under the deck
      const arch = new THREE.Mesh(new THREE.TorusGeometry(b.d / 2 - 1, 0.35, 6, 24, Math.PI), new THREE.MeshStandardMaterial({ color: 0xfff3dc, roughness: 0.7 }));
      arch.rotation.y = Math.PI / 2;
      arch.position.set(s * (b.w / 2), -0.5, 0);
      arch.scale.set(1, 0.18, 1);
      arch.rotation.z = Math.PI;
      g.add(arch);
    }
    g.position.set(b.x, 0, b.z);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }

  // --- Buildings: instanced boxes with a procedural window pattern
  const towerMat = windowMaterial(0xffffff, true);
  const houseMat = windowMaterial(0xffffff, false);
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const tall = city.buildings.filter((b) => b.kind !== 'house');
  const houses = city.buildings.filter((b) => b.kind === 'house');
  const tiers = tall.filter((b) => b.tier);
  const tallMesh = new THREE.InstancedMesh(box, towerMat, tall.length + tiers.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  let k = 0;
  for (const b of tall) {
    m.makeScale(b.w, b.h, b.d).setPosition(b.x, 0, b.z);
    tallMesh.setMatrixAt(k, m);
    tallMesh.setColorAt(k++, col.setHex(b.color));
  }
  for (const b of tiers) {
    m.makeScale(b.tier.w, b.tier.h, b.tier.d).setPosition(b.x, b.h, b.z);
    tallMesh.setMatrixAt(k, m);
    tallMesh.setColorAt(k++, col.setHex(b.color).offsetHSL(0, 0, -0.04));
  }
  tallMesh.castShadow = tallMesh.receiveShadow = true;
  scene.add(tallMesh);

  // rooftop trim (thin cap) on towers and apartments
  const capMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.7 }), tall.length);
  tall.forEach((b, i) => {
    m.makeScale(b.w + 0.5, 0.5, b.d + 0.5).setPosition(b.x, b.h, b.z);
    capMesh.setMatrixAt(i, m);
  });
  capMesh.castShadow = true;
  scene.add(capMesh);

  const houseMesh = new THREE.InstancedMesh(box, houseMat, houses.length);
  const roofGeo = gableGeometry();
  const roofMesh = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, flatShading: true }), houses.length);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc3 = new THREE.Vector3();
  houses.forEach((b, i) => {
    m.makeScale(b.w, b.h, b.d).setPosition(b.x, 0, b.z);
    houseMesh.setMatrixAt(i, m);
    houseMesh.setColorAt(i, col.setHex(b.color));
    const alongX = b.roofAxis === 'x';
    q.setFromAxisAngle(up, alongX ? 0 : Math.PI / 2);
    sc3.set(alongX ? b.w + 0.8 : b.d + 0.8, Math.min(b.w, b.d) * 0.42, alongX ? b.d + 0.8 : b.w + 0.8);
    m.compose(v.set(b.x, b.h, b.z), q, sc3);
    roofMesh.setMatrixAt(i, m);
    roofMesh.setColorAt(i, col.setHex(b.roof));
  });
  houseMesh.castShadow = houseMesh.receiveShadow = true;
  roofMesh.castShadow = roofMesh.receiveShadow = true;
  scene.add(houseMesh, roofMesh);

  // --- Trees
  {
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 2.2, 6); trunkGeo.translate(0, 1.1, 0);
    const roundGeo = new THREE.IcosahedronGeometry(1.6, 1); roundGeo.translate(0, 3.3, 0);
    const coneGeo = new THREE.ConeGeometry(1.4, 3.6, 7); coneGeo.translate(0, 3.6, 0);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0xb08463, roughness: 0.9 }), city.trees.length);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true });
    const rounds = city.trees.filter((t) => t.kind === 'round'), cones = city.trees.filter((t) => t.kind === 'cone');
    const roundMesh = new THREE.InstancedMesh(roundGeo, leafMat, rounds.length);
    const coneMesh = new THREE.InstancedMesh(coneGeo, leafMat, cones.length);
    const greens = [0x7fcfa6, 0x5fbfb4, 0x9edc9c];
    const autumn = [0xffb37a, 0xffd27f];
    city.trees.forEach((t, i) => { m.makeScale(t.s, t.s, t.s).setPosition(t.x, 0, t.z); trunkMesh.setMatrixAt(i, m); });
    let ri = 0, ci = 0;
    for (const t of city.trees) {
      m.makeScale(t.s, t.s * (0.9 + (t.hue * 0.1)), t.s).setPosition(t.x, 0, t.z);
      const c = (t.x * 7 + t.z * 13) % 11 < 1.6 ? autumn[t.hue % 2] : greens[t.hue];
      if (t.kind === 'round') { roundMesh.setMatrixAt(ri, m); roundMesh.setColorAt(ri++, col.setHex(c)); }
      else { coneMesh.setMatrixAt(ci, m); coneMesh.setColorAt(ci++, col.setHex(c)); }
    }
    for (const mm of [trunkMesh, roundMesh, coneMesh]) { mm.castShadow = true; mm.receiveShadow = true; scene.add(mm); }
  }

  // --- Hedges & fences
  {
    const mesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), city.hedges.length);
    city.hedges.forEach((h, i) => {
      m.makeScale(h.w, h.h, h.d).setPosition(h.x, 0, h.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.setHex(h.fence ? 0xfff3dc : 0x6fc49a));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // --- Benches
  {
    const seat = new THREE.BoxGeometry(2, 0.12, 0.6); seat.translate(0, 0.45, 0);
    const mesh = new THREE.InstancedMesh(seat, new THREE.MeshStandardMaterial({ color: 0xffa66b, roughness: 0.7 }), city.benches.length);
    city.benches.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot);
      m.compose(v.set(b.x, 0, b.z), q, sc3.set(1, 1, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = true;
    scene.add(mesh);
  }

  // --- Street lamps
  {
    const pole = new THREE.CylinderGeometry(0.07, 0.09, 4.6, 6); pole.translate(0, 2.3, 0);
    const lampHead = new THREE.SphereGeometry(0.28, 10, 8); lampHead.translate(0, 4.7, 0);
    const pm = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x3c9d97, roughness: 0.5, metalness: 0.4 }), city.lamps.length);
    const hm = new THREE.InstancedMesh(lampHead, new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffd98a, emissiveIntensity: 1.2 }), city.lamps.length);
    city.lamps.forEach((l, i) => { m.makeTranslation(l.x, 0, l.z); pm.setMatrixAt(i, m); hm.setMatrixAt(i, m); });
    pm.castShadow = true;
    scene.add(pm, hm);
  }

  // --- Fountains
  for (const f of city.fountains) {
    const g = new THREE.Group();
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(f.r, f.r + 0.3, 0.7, 28), new THREE.MeshStandardMaterial({ color: 0xfff3dc, roughness: 0.8 }));
    basin.position.y = 0.35; basin.castShadow = basin.receiveShadow = true;
    const w = new THREE.Mesh(new THREE.CircleGeometry(f.r - 0.3, 28), new THREE.MeshStandardMaterial({ color: 0x6cc8dc, roughness: 0.1, metalness: 0.1 }));
    w.rotation.x = -Math.PI / 2; w.position.y = 0.62;
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.5, 2.6, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.6, roughness: 0.1 }));
    jet.position.y = 1.9;
    g.add(basin, w, jet);
    g.position.set(f.x, 0, f.z);
    scene.add(g);
  }

  // Sun follows the player so the shadow map covers what you can see.
  const followSun = (pos) => {
    sun.position.set(pos.x + SUN_DIR.x * 150, SUN_DIR.y * 150, pos.z + SUN_DIR.z * 150);
    sun.target.position.set(pos.x, 0, pos.z);
  };

  return { scene, sun, followSun, water };
}

function windowMaterial(color, tall) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTall = { value: tall ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        wp = modelMatrix * wp;
        vWPos = wp.xyz;
        vWNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nuniform float uTall;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wall = 1.0 - step(0.5, abs(vWNormal.y));
        float h = abs(vWNormal.x) > 0.5 ? vWPos.z : vWPos.x;
        float floorH = mix(2.8, 3.4, uTall);
        float spacing = mix(3.2, 2.6, uTall);
        float fx = fract(h / spacing);
        float fy = fract((vWPos.y - 0.9) / floorH);
        float win = step(0.18, fx) * step(fx, 0.82) * step(0.25, fy) * step(fy, 0.8);
        win *= step(1.2, vWPos.y);
        if (uTall < 0.5) win *= step(vWPos.y, 3.3) * step(0.3, fract(h / 4.5)) * step(fract(h / 4.5), 0.6);
        vec3 glass = vec3(0.47, 0.72, 0.80) + vec3(0.25, 0.15, 0.0) * smoothstep(0.0, 1.0, fy);
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * wall * 0.85);
        // gentle darkening toward the ground for depth
        diffuseColor.rgb *= mix(0.86, 1.0, smoothstep(0.0, 6.0, vWPos.y));`);
    // glossy windows
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          float wall2 = 1.0 - step(0.5, abs(vWNormal.y));
          float h2 = abs(vWNormal.x) > 0.5 ? vWPos.z : vWPos.x;
          float fx2 = fract(h2 / mix(3.2, 2.6, uTall));
          float fy2 = fract((vWPos.y - 0.9) / mix(2.8, 3.4, uTall));
          float w2 = step(0.18, fx2) * step(fx2, 0.82) * step(0.25, fy2) * step(fy2, 0.8) * step(1.2, vWPos.y) * wall2 * uTall;
          roughnessFactor = mix(roughnessFactor, 0.15, w2);
        }`);
  };
  return mat;
}

// Unit gable roof: spans x in [-0.5,0.5], z in [-0.5,0.5], ridge along x at height 1.
function gableGeometry() {
  const p = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, // south slope
    0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0, // north slope
    -0.5, 0, 0.5, -0.5, 0, -0.5, -0.5, 1, 0, // west gable
    0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 1, 0, // east gable
  ];
  const idx = [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6, 8, 10, 9, 11, 13, 12];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

function makeSky() {
  const geo = new THREE.SphereGeometry(1500, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { sunDir: { value: SUN_DIR } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 sunDir;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 top = vec3(0.50, 0.76, 0.94);
        vec3 mid = vec3(0.74, 0.88, 0.97);
        vec3 hor = vec3(1.0, 0.85, 0.70);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, top, smoothstep(0.22, 0.8, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.62, 0.30) * pow(s, 8.0) * 0.45;
        col += vec3(1.0, 0.9, 0.7) * smoothstep(0.9975, 0.999, s);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}
