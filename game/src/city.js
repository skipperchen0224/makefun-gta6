// 程序化生成的棕榈城——按种子生成的街区网格，道路沿每条街区线，楼在街区里，棕榈沿人行道，碰撞盒供其余系统绕行；运行时没有任何随机，种子来自网址参数所以截图可复现；路灯沿大道排列，天黑后亮起。
import * as THREE from 'three';
import { WORLD, PALETTE, PLACES, mulberry32, clamp } from './config.js';

// Collision boxes: { minX, maxX, minZ, maxZ }. Road lines: { axis, pos }.
const colliders = [];
const roadLines = [];
let cityGroup = null;
let lampHeadMat = null;
let roadMat = null;
let lampGlow = null;
const lampSpots = [];
const buildingMats = [];
let props = {};
const TILE = WORLD.block * 3;
const propTiles = [];
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const dummy = new THREE.Object3D();

function hexCss(n) {
  return '#' + n.toString(16).padStart(6, '0');
}

// One wall texture plus its night-glow twin. Windows are 4 across, 8 down;
// a window lights up with probability 0.35, warm yellow when lit, dark
// blue-grey when dark. Lit windows are painted on the glow canvas too.
function makeWindowTextures(rng, baseCss) {
  const base = document.createElement('canvas');
  base.width = 64;
  base.height = 128;
  const g = base.getContext('2d');
  g.fillStyle = baseCss;
  g.fillRect(0, 0, 64, 128);
  const glow = document.createElement('canvas');
  glow.width = 64;
  glow.height = 128;
  const gg = glow.getContext('2d');
  gg.fillStyle = '#000000';
  gg.fillRect(0, 0, 64, 128);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 8; row++) {
      const wx = 4 + col * 15;
      const wy = 6 + row * 15;
      const lit = rng() < 0.35;
      g.fillStyle = lit ? hexCss(PALETTE.windowLit) : hexCss(PALETTE.windowDark);
      g.fillRect(wx, wy, 10, 9);
      if (lit) {
        gg.fillStyle = hexCss(PALETTE.windowLit);
        gg.fillRect(wx, wy, 10, 9);
      }
    }
  }
  const map = new THREE.CanvasTexture(base);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(glow);
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, glow: emissive };
}

function addBuilding(container, rng, cx, cz, w, d) {
  const h = 8 + rng() * 30;
  const color = PALETTE.building[Math.floor(rng() * PALETTE.building.length)];
  const tex = makeWindowTextures(rng, hexCss(color));
  const mat = new THREE.MeshLambertMaterial({
    map: tex.map, emissive: 0xffffff, emissiveIntensity: 0,
  });
  mat.userData.windowGlow = tex.glow;
  buildingMats.push(mat);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(cx, h / 2, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  container.add(mesh);
  // Roof cap goes through the instanced prop system.
  addProp('roof', cx, h + 0.3, cz, w + 0.4, 0.6, d + 0.4);
  if (h > 24) {
    addProp('ac', cx + w * 0.2, h + 1.4, cz - d * 0.15);
  }
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

function addPalm(container, rng, x, z) {
  void container;
  addProp('trunk', x, 2.6, z, 1, 1, 1, 0, (rng() - 0.5) * 0.16);
  addProp('leaves', x, 5.8, z);
}

function addLamp(container, x, z) {
  void container;
  addProp('pole', x, 3.2, z);
  addProp('head', x, 6.5, z);
  lampSpots.push(x, 6.5, z);
}

// Round 5: a soft round sprite, drawn additively, fakes bloom around lamps and car lights.
let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function glowMaterial(size, color, vertexColors = false) {
  return new THREE.PointsMaterial({
    size, color, map: glowTexture(), vertexColors, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
}

// City-side night switch: lamp heads glow warm, roads pick up a faint blue
// sheen, building windows light up from their stored glow maps.
export function setNightMode(on) {
  if (lampHeadMat) lampHeadMat.color.setHex(on ? 0xffd27a : 0x3a3f46);
  if (roadMat) roadMat.emissiveIntensity = on ? 0.3 : 0;
  if (lampGlow) lampGlow.visible = on;
  for (const mat of buildingMats) {
    const glow = mat.userData.windowGlow;
    const next = on ? glow : null;
    if (mat.emissiveMap !== next) {
      mat.emissiveMap = next;
      mat.needsUpdate = true;
    }
    mat.emissiveIntensity = on ? 1 : 0;
  }
}

function makeProp(geometry, material) {
  return { geometry, material, tiles: new Map() };
}

export function buildCity(scene, seed = 1) {
  const rng = mulberry32(seed);
  cityGroup = new THREE.Group();
  scene.add(cityGroup);
  const half = WORLD.size / 2;
  const step = WORLD.block;
  lampHeadMat = new THREE.MeshBasicMaterial({ color: 0x3a3f46 });
  buildingMats.length = 0;
  colliders.length = 0;
  roadLines.length = 0;
  propTiles.length = 0;
  lampSpots.length = 0;
  props = {
    roof: makeProp(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0x4a3828 }),
    ),
    ac: makeProp(
      new THREE.BoxGeometry(3, 1.6, 3),
      new THREE.MeshLambertMaterial({ color: 0x8a8f96 }),
    ),
    trunk: makeProp(
      new THREE.CylinderGeometry(0.22, 0.34, 5.2, 6, 1, true),
      new THREE.MeshLambertMaterial({ color: PALETTE.palmTrunk }),
    ),
    leaves: makeProp(
      new THREE.ConeGeometry(2.4, 2.2, 7),
      new THREE.MeshLambertMaterial({ color: PALETTE.palmLeaf }),
    ),
    pole: makeProp(
      new THREE.CylinderGeometry(0.09, 0.12, 6.4, 6, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x2c3542 }),
    ),
    head: makeProp(new THREE.SphereGeometry(0.32, 10, 8), lampHeadMat),
    dash: makeProp(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: PALETTE.roadLine }),
    ),
  };

  // Ground, beach and sea.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size + 160, WORLD.size + 160),
    new THREE.MeshLambertMaterial({ color: PALETTE.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  cityGroup.add(ground);
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(60, WORLD.size + 160),
    new THREE.MeshLambertMaterial({ color: 0xe8d9a8 }),
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(half + 30, 0, 0);
  cityGroup.add(beach);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(220, WORLD.size + 160),
    new THREE.MeshLambertMaterial({ color: 0x2e7fa8 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(half + 170, -0.2, 0);
  cityGroup.add(sea);

  // Roads and sidewalks on every grid line.
  roadMat = new THREE.MeshLambertMaterial({
    color: PALETTE.road, emissive: 0x1c3a5c, emissiveIntensity: 0,
  });
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
  for (let p = -half; p <= half; p += step) {
    const roadH = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, WORLD.roadWidth), roadMat);
    roadH.rotation.x = -Math.PI / 2;
    roadH.position.set(0, 0.02, p);
    roadH.receiveShadow = true;
    cityGroup.add(roadH);
    roadLines.push({ axis: 'x', pos: p });
    const roadV = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.roadWidth, WORLD.size), roadMat);
    roadV.rotation.x = -Math.PI / 2;
    roadV.position.set(p, 0.02, 0);
    roadV.receiveShadow = true;
    cityGroup.add(roadV);
    roadLines.push({ axis: 'z', pos: p });
    for (const side of [-1, 1]) {
      const walkH = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, 4), sidewalkMat);
      walkH.rotation.x = -Math.PI / 2;
      walkH.position.set(0, 0.01, p + side * (WORLD.roadWidth / 2 + 2));
      walkH.receiveShadow = true;
      cityGroup.add(walkH);
      const walkV = new THREE.Mesh(new THREE.PlaneGeometry(4, WORLD.size), sidewalkMat);
      walkV.rotation.x = -Math.PI / 2;
      walkV.position.set(p + side * (WORLD.roadWidth / 2 + 2), 0.01, 0);
      walkV.receiveShadow = true;
      cityGroup.add(walkV);
    }
  }

  // Dashed centre lines down the two central avenues.
  for (let p = -half; p <= half; p += 12) {
    addProp('dash', 0, 0.04, p, 0.5, 5, 1, -Math.PI / 2, 0);
    addProp('dash', p, 0.04, 0, 5, 0.5, 1, -Math.PI / 2, 0);
  }

  // Buildings, one or two per block.
  const inner = step - WORLD.roadWidth - 2 * WORLD.buildingGap;
  for (let bx = -half + step / 2; bx <= half - step / 2; bx += step) {
    for (let bz = -half + step / 2; bz <= half - step / 2; bz += step) {
      if (Math.abs(bx) < 30 && Math.abs(bz - 100) < 30) continue; // spawn plaza
      if (bx > half - step) continue; // eastern column stays low, beach side
      if (rng() < 0.55) {
        addBuilding(cityGroup, rng, bx, bz, inner, inner);
      } else {
        addBuilding(cityGroup, rng, bx - inner / 4, bz, inner / 2 - 2, inner);
        addBuilding(cityGroup, rng, bx + inner / 4, bz, inner / 2 - 2, inner);
      }
    }
  }

  // Palms along the central avenue and the beachfront.
  for (let z = -half; z <= half; z += 28) {
    addPalm(cityGroup, rng, -8, z);
    addPalm(cityGroup, rng, 8, z + 14);
    addPalm(cityGroup, rng, half - 14, z + 7);
  }

  // Lamps along the two central avenues, staggered on both sides.
  for (let p = -half; p <= half; p += 40) {
    addLamp(cityGroup, -6, p);
    addLamp(cityGroup, 6, p + 20);
    addLamp(cityGroup, p, -6);
    addLamp(cityGroup, p + 20, 6);
  }

  // Landmarks: a coloured block plus a sign, each with a collision box.
  const landmarkDefs = [
    { name: 'diner', h: 7, color: 0xff5a7a },
    { name: 'pier', h: 6, color: 0x2e6fb5 },
    { name: 'safehouse', h: 6, color: 0x3f8f4f },
    { name: 'alley', h: 9, color: 0xd9a441 },
  ];
  for (const def of landmarkDefs) {
    const pos = PLACES[def.name];
    if (!pos) continue;
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(14, def.h, 10),
      new THREE.MeshLambertMaterial({ color: def.color }),
    );
    block.position.set(pos.x, def.h / 2, pos.z);
    block.castShadow = true;
    block.receiveShadow = true;
    cityGroup.add(block);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(10, 2.2, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xf2ead8 }),
    );
    sign.position.set(pos.x, def.h + 1.6, pos.z);
    cityGroup.add(sign);
    colliders.push({ minX: pos.x - 7, maxX: pos.x + 7, minZ: pos.z - 5, maxZ: pos.z + 5 });
  }

  // Bake every prop kind into one InstancedMesh per tile.
  for (const [kind, entry] of Object.entries(props)) {
    entry.geometry.computeBoundingBox();
    entry.geometry.computeBoundingSphere();
    for (const matrices of entry.tiles.values()) {
      const mesh = new THREE.InstancedMesh(entry.geometry, entry.material, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = kind !== 'dash';
      mesh.receiveShadow = kind === 'roof';
      const spheres = matrices.map((m) => {
        if (kind === 'roof' || kind === 'dash') {
          const box = entry.geometry.boundingBox.clone().applyMatrix4(m);
          const s = new THREE.Sphere();
          box.getBoundingSphere(s);
          return s;
        }
        return entry.geometry.boundingSphere.clone().applyMatrix4(m);
      });
      propTiles.push({
        mesh,
        matrices,
        spheres,
        visible: matrices.map((_, i) => i),
      });
      cityGroup.add(mesh);
    }
  }
  props = {};

  // Night halos over every lamp head: one Points cloud, one draw call.
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampSpots, 3));
  lampGlow = new THREE.Points(haloGeo, glowMaterial(7, 0xffc870));
  lampGlow.visible = false;
  cityGroup.add(lampGlow);
  return cityGroup;
}

export function getColliders() {
  return colliders;
}

export function randomRoadPoint(rng, margin = 20) {
  const half = WORLD.size / 2 - margin;
  const axis = rng() < 0.5 ? 'x' : 'z';
  const line = Math.round(((rng() * 2 - 1) * half) / WORLD.block) * WORLD.block;
  const along = (rng() * 2 - 1) * half;
  return axis === 'x' ? { x: along, z: line, axis } : { x: line, z: along, axis };
}

export function snapToRoad(x, z) {
  const gx = Math.round(x / WORLD.block) * WORLD.block;
  const gz = Math.round(z / WORLD.block) * WORLD.block;
  if (Math.abs(x - gx) <= Math.abs(z - gz)) return { x: gx, z, axis: 'z' };
  return { x, z: gz, axis: 'x' };
}

export function resolveCircleCollision(x, z, r) {
  let nx = x;
  let nz = z;
  for (const b of colliders) {
    const cx = clamp(nx, b.minX, b.maxX);
    const cz = clamp(nz, b.minZ, b.maxZ);
    const dx = nx - cx;
    const dz = nz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      nx += dx * push;
      nz += dz * push;
    } else {
      // Centre is inside the box: leave along the shallowest axis.
      const pl = nx - b.minX;
      const pr = b.maxX - nx;
      const pt = nz - b.minZ;
      const pb = b.maxZ - nz;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) nx = b.minX - r;
      else if (m === pr) nx = b.maxX + r;
      else if (m === pt) nz = b.minZ - r;
      else nz = b.maxZ + r;
    }
  }
  const half = WORLD.size / 2;
  nx = clamp(nx, -half, half);
  nz = clamp(nz, -half, half);
  return { x: nx, z: nz };
}

// Round 5: is the straight line from A to B blocked by a building? Sampled every 4 m.
export function segmentBlocked(ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.ceil(len / 4);
  for (let i = 1; i < n; i++) {
    const x = ax + ((bx - ax) * i) / n;
    const z = az + ((bz - az) * i) / n;
    for (const b of colliders) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && !inBox(b, ax, az) && !inBox(b, bx, bz)) return true;
    }
  }
  return false;
}

// Someone standing against (or inside) a box can still see out of it.
function inBox(b, x, z) {
  return x > b.minX - 1.5 && x < b.maxX + 1.5 && z > b.minZ - 1.5 && z < b.maxZ + 1.5;
}

// Round 5 road-grid navigation: the next point on the street grid that brings a
// driver at (fx, fz) closer to (tx, tz). On a road it heads for the next
// intersection toward the target; at an intersection it picks the neighbour
// along the bigger gap; off the road it snaps back onto the nearest one.
export function roadWaypoint(fx, fz, tx, tz) {
  const B = WORLD.block;
  const half = WORLD.size / 2;
  const ix = Math.round(fx / B) * B;
  const iz = Math.round(fz / B) * B;
  const onZ = Math.abs(fx - ix) < 6; // on a north-south road (x = ix)
  const onX = Math.abs(fz - iz) < 6; // on an east-west road (z = iz)
  if (!onX && !onZ) {
    const s = snapToRoad(fx, fz);
    return { x: s.x, z: s.z };
  }
  const dx = tx - fx;
  const dz = tz - fz;
  if (onX && onZ && Math.hypot(fx - ix, fz - iz) < 6) {
    if (Math.abs(dx) > Math.abs(dz)) return { x: clamp(ix + Math.sign(dx) * B, -half, half), z: iz };
    return { x: ix, z: clamp(iz + Math.sign(dz) * B, -half, half) };
  }
  if (onX) {
    const nx = dx > 0 ? Math.ceil(fx / B) * B : Math.floor(fx / B) * B;
    return { x: nx === fx ? nx + Math.sign(dx || 1) * B : nx, z: iz };
  }
  const nz = dz > 0 ? Math.ceil(fz / B) * B : Math.floor(fz / B) * B;
  return { x: ix, z: nz === fz ? nz + Math.sign(dz || 1) * B : nz };
}

export function getLandmark(name) {
  return PLACES[name] || null;
}

function addProp(kind, x, y, z, sx = 1, sy = 1, sz = 1, rotX = 0, rotY = 0) {
  const entry = props[kind];
  if (!entry) return;
  dummy.position.set(x, y, z);
  dummy.scale.set(sx, sy, sz);
  dummy.rotation.set(rotX, 0, rotY);
  dummy.updateMatrix();
  const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
  let list = entry.tiles.get(key);
  if (!list) {
    list = [];
    entry.tiles.set(key, list);
  }
  list.push(dummy.matrix.clone());
}

function sameList(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Per-frame visibility pass: coarse tile sphere test, then per-instance
// sphere test; instance matrices are rewritten only when the visible set
// actually changed.
export function updateCityVisibility(camera) {
  camera.updateMatrixWorld();
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  for (const tile of propTiles) {
    if (!tile.mesh.boundingSphere || !frustum.intersectsSphere(tile.mesh.boundingSphere)) {
      if (tile.visible.length !== 0) {
        tile.mesh.count = 0;
        tile.mesh.instanceMatrix.needsUpdate = true;
        tile.visible = [];
      }
      continue;
    }
    const seen = [];
    for (let i = 0; i < tile.spheres.length; i++) {
      if (frustum.intersectsSphere(tile.spheres[i])) seen.push(i);
    }
    if (sameList(tile.visible, seen)) continue;
    for (let j = 0; j < seen.length; j++) {
      tile.mesh.setMatrixAt(j, tile.matrices[seen[j]]);
    }
    tile.mesh.count = seen.length;
    tile.mesh.instanceMatrix.needsUpdate = true;
    tile.visible = seen;
  }
}
