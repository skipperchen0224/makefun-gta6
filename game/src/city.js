// Procedural Palmetto City: seeded block grid, roads on every block line,
// buildings inside blocks, palms on sidewalks, collision boxes for the rest
// of the game. No randomness at runtime — the seed comes from ?seed=, so
// screenshots are reproducible. Round 5 adds line-of-sight tests, a 2048
// sun-shadow map that follows the player, and night lamp glow.
import * as THREE from 'three';
import { WORLD, PALETTE, PLACES, mulberry32 } from './config.js';

const colliders = [];
const roadLines = [];
let cityGroup = null;
let lampMat = null;
let roadMat = null;
let buildingMats = [];
let lampGlow = null;
const TILE = WORLD.block * 3;
let propTiles = [];
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();

function windowTextures(rng, base) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 64, 128);
  const e = document.createElement('canvas');
  e.width = 64; e.height = 128;
  const eg = e.getContext('2d');
  eg.fillStyle = '#000'; eg.fillRect(0, 0, 64, 128);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 8; row++) {
      const x = 4 + col * 15, y = 6 + row * 15;
      const lit = rng() < 0.35;
      g.fillStyle = lit ? '#ffe9a8' : '#2c3e50';
      g.fillRect(x, y, 10, 9);
      if (lit) { eg.fillStyle = '#ffe9a8'; eg.fillRect(x, y, 10, 9); }
    }
  }
  const map = new THREE.CanvasTexture(c);
  const glow = new THREE.CanvasTexture(e);
  map.colorSpace = THREE.SRGBColorSpace;
  glow.colorSpace = THREE.SRGBColorSpace;
  return { map, glow };
}

function hexCss(n) { return '#' + n.toString(16).padStart(6, '0'); }

let props = null;
function addProp(kind, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
  const tile = props[kind].tiles;
  if (!tile.has(key)) tile.set(key, []);
  tile.get(key).push(m);
}

function addBuilding(scene, rng, cx, cz, w, d) {
  const h = 8 + rng() * 30;
  const color = PALETTE.building[Math.floor(rng() * PALETTE.building.length)];
  const tex = windowTextures(rng, hexCss(color));
  const mat = new THREE.MeshLambertMaterial({ map: tex.map, emissive: 0xffffff, emissiveIntensity: 0 });
  mat.userData.windowGlow = tex.glow;
  buildingMats.push(mat);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(cx, h / 2, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  cityGroup.add(mesh);
  addProp('roof', cx, h + 0.3, cz, w + 0.4, 0.6, d + 0.4);
  colliders.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 });
  if (h > 24) addProp('ac', cx + w * 0.2, h + 1.4, cz - d * 0.15);
}

function addPalm(scene, rng, x, z) {
  addProp('trunk', x, 2.6, z, 1, 1, 1, 0, (rng() - 0.5) * 0.16);
  addProp('leaves', x, 5.8, z);
}

function addLamp(scene, x, z) {
  addProp('pole', x, 3.2, z);
  addProp('lampHead', x, 6.5, z);
}

export function setCityNight(on) {
  if (lampMat) lampMat.color.setHex(on ? 0xffe9a8 : 0x3a3f46);
  if (roadMat) roadMat.emissiveIntensity = on ? 0.3 : 0;
  for (const mat of buildingMats) {
    const glow = mat.userData.windowGlow;
    const next = on ? glow : null;
    if (mat.emissiveMap !== next) { mat.emissiveMap = next; mat.needsUpdate = true; }
    mat.emissiveIntensity = on ? 1 : 0;
  }
  if (lampGlow) lampGlow.visible = on;
}

// Round 5: a 2048 shadow map on the sun, covering ±70 m around the player.
export function enableSunShadows(sun) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -70; cam.right = 70; cam.top = 70; cam.bottom = -70;
  cam.near = 10; cam.far = 500;
  sun.shadow.bias = -0.0004;
}

export function followSunShadow(sun, x, z) {
  // Keep the weather-driven sun direction, just re-centre the ±70 m shadow
  // box on the player so the shadows follow instead of sliding away.
  const d = sun.position.clone().sub(sun.target.position).normalize();
  sun.position.set(x + d.x * 220, Math.max(20, d.y * 220), z + d.z * 220);
  sun.target.position.set(x, 0, z);
  sun.target.updateMatrixWorld();
}

export function buildCity(scene, seed = 1) {
  const rng = mulberry32(seed);
  cityGroup = new THREE.Group();
  scene.add(cityGroup);
  const half = WORLD.size / 2;
  const step = WORLD.block;
  lampMat = new THREE.MeshBasicMaterial({ color: 0x3a3f46 });
  buildingMats = [];
  propTiles = [];
  roadLines.length = 0;
  colliders.length = 0;
  props = {
    roof: { geo: new THREE.BoxGeometry(1, 1, 1), mat: new THREE.MeshLambertMaterial({ color: 0x5a4632 }), tiles: new Map() },
    ac: { geo: new THREE.BoxGeometry(3, 1.6, 3), mat: new THREE.MeshLambertMaterial({ color: 0x8a8f96 }), tiles: new Map() },
    trunk: { geo: new THREE.CylinderGeometry(0.22, 0.34, 5.2, 6, 1, true), mat: new THREE.MeshLambertMaterial({ color: PALETTE.palmTrunk }), tiles: new Map() },
    leaves: { geo: new THREE.ConeGeometry(2.4, 2.2, 7), mat: new THREE.MeshLambertMaterial({ color: PALETTE.palmLeaf }), tiles: new Map() },
    pole: { geo: new THREE.CylinderGeometry(0.09, 0.12, 6.4, 6, 1, true), mat: new THREE.MeshLambertMaterial({ color: 0x2c3644 }), tiles: new Map() },
    lampHead: { geo: new THREE.SphereGeometry(0.32, 8, 6), mat: lampMat, tiles: new Map() },
    dash: { geo: new THREE.PlaneGeometry(1, 1), mat: new THREE.MeshBasicMaterial({ color: PALETTE.roadLine }), tiles: new Map() },
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size + 160, WORLD.size + 160), new THREE.MeshLambertMaterial({ color: PALETTE.ground }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
  ground.receiveShadow = true;
  cityGroup.add(ground);
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(60, WORLD.size + 160), new THREE.MeshLambertMaterial({ color: 0xe8d9a0 }));
  beach.rotation.x = -Math.PI / 2; beach.position.set(half + 30, 0, 0);
  cityGroup.add(beach);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(220, WORLD.size + 160), new THREE.MeshLambertMaterial({ color: 0x2e7fa8 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(half + 170, -0.2, 0);
  cityGroup.add(sea);
  roadMat = new THREE.MeshLambertMaterial({ color: PALETTE.road, emissive: 0x0e1a2e, emissiveIntensity: 0 });
  const walkMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
  for (let c = -half; c <= half; c += step) {
    const roadX = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, WORLD.roadWidth), roadMat);
    roadX.rotation.x = -Math.PI / 2; roadX.position.set(0, 0.02, c);
    cityGroup.add(roadX);
    const roadZ = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.roadWidth, WORLD.size), roadMat);
    roadZ.rotation.x = -Math.PI / 2; roadZ.position.set(c, 0.02, 0);
    cityGroup.add(roadZ);
    roadLines.push({ axis: 'x', at: c }, { axis: 'z', at: c });
    for (const s of [-1, 1]) {
      const w1 = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, 4), walkMat);
      w1.rotation.x = -Math.PI / 2; w1.position.set(0, 0.01, c + s * (WORLD.roadWidth / 2 + 2));
      cityGroup.add(w1);
      const w2 = new THREE.Mesh(new THREE.PlaneGeometry(4, WORLD.size), walkMat);
      w2.rotation.x = -Math.PI / 2; w2.position.set(c + s * (WORLD.roadWidth / 2 + 2), 0.01, 0);
      cityGroup.add(w2);
    }
  }
  for (let c = -half; c <= half; c += 12) {
    addProp('dash', c, 0.04, 0, 5, 0.5, 1, -Math.PI / 2, 0);
    addProp('dash', 0, 0.04, c, 0.5, 5, 1, -Math.PI / 2, 0);
  }
  const inner = step - WORLD.roadWidth - 2 * WORLD.buildingGap;
  for (let cx = -half + step / 2; cx < half; cx += step) {
    for (let cz = -half + step / 2; cz < half; cz += step) {
      if (Math.abs(cx) < 30 && Math.abs(cz - 100) < 30) continue;
      if (cx > half - step) continue;
      if (rng() < 0.55) {
        addBuilding(scene, rng, cx, cz, inner, inner);
      } else {
        addBuilding(scene, rng, cx - inner / 4, cz, inner / 2 - 2, inner);
        addBuilding(scene, rng, cx + inner / 4, cz, inner / 2 - 2, inner);
      }
    }
  }
  for (let c = -half; c <= half; c += 28) {
    addPalm(scene, rng, -8, c);
    addPalm(scene, rng, 8, c + 14);
    addPalm(scene, rng, half - 12, c + 7);
  }
  const lampSpots = [];
  for (let c = -half; c <= half; c += 40) {
    addLamp(scene, -8, c); addLamp(scene, 8, c + 20);
    addLamp(scene, c, -8); addLamp(scene, c + 20, 8);
    lampSpots.push([-8, c], [8, c + 20], [c, -8], [c + 20, 8]);
  }
  // Night lamp glow: one additive Points cloud over every lamp head.
  const glowPos = new Float32Array(lampSpots.length * 3);
  lampSpots.forEach(([x, z], i) => { glowPos[i * 3] = x; glowPos[i * 3 + 1] = 6.5; glowPos[i * 3 + 2] = z; });
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
  lampGlow = new THREE.Points(glowGeo, new THREE.PointsMaterial({
    color: 0xffe9a8, size: 5, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  lampGlow.visible = false;
  lampGlow.frustumCulled = false;
  cityGroup.add(lampGlow);
  const landmarks = [
    { name: 'diner', h: 7, color: 0xff7a1a },
    { name: 'pier', h: 6, color: 0x3f6fb5 },
    { name: 'safehouse', h: 6, color: 0x2e8b6a },
    { name: 'alley', h: 9, color: 0x7a5fc0 },
  ];
  for (const lm of landmarks) {
    const p = PLACES[lm.name];
    const box = new THREE.Mesh(new THREE.BoxGeometry(14, lm.h, 10), new THREE.MeshLambertMaterial({ color: lm.color }));
    box.position.set(p.x, lm.h / 2, p.z);
    cityGroup.add(box);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(10, 2.2, 0.6), new THREE.MeshBasicMaterial({ color: 0xf2ead8 }));
    sign.position.set(p.x, lm.h + 1.6, p.z);
    cityGroup.add(sign);
    colliders.push({ x0: p.x - 7, x1: p.x + 7, z0: p.z - 5, z1: p.z + 5 });
  }
  for (const [kind, def] of Object.entries(props)) {
    def.geo.computeBoundingBox();
    def.geo.computeBoundingSphere();
    for (const matrices of def.tiles.values()) {
      const inst = new THREE.InstancedMesh(def.geo, def.mat, matrices.length);
      matrices.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      const spheres = matrices.map((m) => {
        const box = def.geo.boundingBox.clone().applyMatrix4(m);
        const s = new THREE.Sphere();
        box.getBoundingSphere(s);
        return s;
      });
      if (kind === 'roof' || kind === 'dash') {
        // Non-uniform boxes/planes: bounding-box sphere is the honest one.
      }
      propTiles.push({ mesh: inst, matrices, spheres, visible: matrices.map((_, i) => i) });
      cityGroup.add(inst);
    }
  }
  props = null;
}

export function getColliders() { return colliders; }

export function randomRoadPoint(rng, margin = 20) {
  const half = WORLD.size / 2 - margin;
  const axis = rng() < 0.5 ? 'x' : 'z';
  const line = Math.round(((rng() * 2 - 1) * half) / WORLD.block) * WORLD.block;
  const along = (rng() * 2 - 1) * half;
  return axis === 'x' ? { x: along, z: line, axis } : { x: line, z: along, axis };
}

export function snapToRoad(x, z) {
  const lineX = Math.round(x / WORLD.block) * WORLD.block;
  const lineZ = Math.round(z / WORLD.block) * WORLD.block;
  return Math.abs(x - lineX) < Math.abs(z - lineZ)
    ? { x: lineX, z, axis: 'z' }
    : { x, z: lineZ, axis: 'x' };
}

export function resolveCircleCollision(x, z, r) {
  for (const b of colliders) {
    const nx = Math.max(b.x0, Math.min(x, b.x1));
    const nz = Math.max(b.z0, Math.min(z, b.z1));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      x = nx + (dx / d) * r;
      z = nz + (dz / d) * r;
    } else if (d2 <= 0.0001) {
      const pushL = x - b.x0 + r, pushR = b.x1 - x + r;
      const pushU = z - b.z0 + r, pushD = b.z1 - z + r;
      const m = Math.min(pushL, pushR, pushU, pushD);
      if (m === pushL) x = b.x0 - r;
      else if (m === pushR) x = b.x1 + r;
      else if (m === pushU) z = b.z0 - r;
      else z = b.z1 + r;
    }
  }
  const half = WORLD.size / 2;
  x = Math.max(-half, Math.min(half, x));
  z = Math.max(-half, Math.min(half, z));
  return { x, z };
}

// Round 5: segment vs building boxes — cops and gang only shoot with a
// clear line of sight, and cop cars path around blocks instead of through.
export function hasLineOfSight(x1, z1, x2, z2) {
  for (const b of colliders) {
    if (segmentHitsBox(x1, z1, x2, z2, b)) return false;
  }
  return true;
}

function segmentHitsBox(x1, z1, x2, z2, b) {
  const dx = x2 - x1, dz = z2 - z1;
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[x1, dx, b.x0, b.x1], [z1, dz, b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let a = (lo - p) / d, c = (hi - p) / d;
      if (a > c) { const t = a; a = c; c = t; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function landmarkAt(name) { return PLACES[name] || PLACES.spawn; }

export function updateCityVisibility(camera) {
  camera.updateMatrixWorld();
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  for (const tile of propTiles) {
    if (!frustum.intersectsSphere(tile.mesh.boundingSphere)) continue;
    const next = [];
    for (let i = 0; i < tile.spheres.length; i++) {
      if (frustum.intersectsSphere(tile.spheres[i])) next.push(i);
    }
    const same = next.length === tile.visible.length && next.every((v, i) => v === tile.visible[i]);
    if (same) continue;
    next.forEach((src, dst) => tile.mesh.setMatrixAt(dst, tile.matrices[src]));
    tile.mesh.count = next.length;
    tile.mesh.instanceMatrix.needsUpdate = true;
    tile.visible = next;
  }
}
