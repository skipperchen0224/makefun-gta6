// Palmetto Heat — the procedural palm city: a seeded block grid, roads on
// every block line, buildings inside the blocks, palms along the sidewalks,
// collision boxes for everyone else to steer around. No randomness at
// runtime: the seed comes from the URL, so screenshots are reproducible.
// Lamps line the avenues and come on after dark.

import * as THREE from 'three';
import { WORLD, PALETTE, PLACES, clamp, mulberry32 } from './config.js';

// ---- module state ---------------------------------------------------------
const colliders = [];          // { minX, maxX, minZ, maxZ } per building/landmark
const roadLines = [];          // { axis, at } — one per road, for traffic and spawns
let cityGroup = null;
let lampHeadMat = null;        // shared by every lamp head in the city
let roadMat = null;
const buildingMats = [];       // one Lambert material per building (window glow)
let propKits = null;           // kind -> { geometry, material, tiles: Map<key, Matrix4[]> }
const TILE = WORLD.block * 3;  // prop tiles are three blocks wide
const propTiles = [];          // { mesh, matrices, spheres, visible } per kind per tile
const frustum = new THREE.Frustum();
const viewProj = new THREE.Matrix4();

const LAMP_DAY = 0x4a4f55;     // lamp head by day: dull grey
const LAMP_NIGHT = 0xffe9a8;   // lamp head by night: warm yellow
const SAND = 0xe8d9a0;
const SEA = 0x2e7fa8;
const ROOF_BROWN = 0x6b4a2f;
const AC_GREY = 0x9aa0a6;
const POLE_BLUE = 0x2c3e50;
const SIGN_CREAM = 0xf2ead8;

// ---- helpers --------------------------------------------------------------

/** A hex number as a CSS colour string: 0xffe9a8 -> '#ffe9a8'. */
function hexCss(n) {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/**
 * One building's window textures: a 64x128 base canvas and a 64x128 black
 * emissive canvas. Windows sit in a 4x8 grid (15px cells, 10x9 windows,
 * offset 4,6); each window lights with probability 0.35, warm yellow when
 * lit, dark blue-grey when not, and a lit window is painted on the glow
 * canvas in the same spot. Returns { map, glow }.
 */
function makeWindowTexture(rng, baseCss) {
  const base = document.createElement('canvas');
  base.width = 64;
  base.height = 128;
  const g = base.getContext('2d');
  g.fillStyle = baseCss;
  g.fillRect(0, 0, 64, 128);
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64;
  glowCanvas.height = 128;
  const gg = glowCanvas.getContext('2d');
  gg.fillStyle = '#000000';
  gg.fillRect(0, 0, 64, 128);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 8; r++) {
      const x = 4 + c * 15;
      const y = 6 + r * 15;
      if (rng() < 0.35) {
        g.fillStyle = '#ffe9a8';
        g.fillRect(x, y, 10, 9);
        gg.fillStyle = '#ffe9a8';
        gg.fillRect(x, y, 10, 9);
      } else {
        g.fillStyle = '#2c3e50';
        g.fillRect(x, y, 10, 9);
      }
    }
  }
  const map = new THREE.CanvasTexture(base);
  map.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.CanvasTexture(glowCanvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  return { map, glow };
}

// ---- prop system (instanced static props) ---------------------------------

/** Queue one instance of a prop kind: position, scale, tilt about X, spin about Y. */
function addProp(kind, x, y, z, sx = 1, sy = 1, sz = 1, rotX = 0, rotY = 0) {
  const kit = propKits[kind];
  if (!kit) return;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
  if (!kit.tiles.has(key)) kit.tiles.set(key, []);
  kit.tiles.get(key).push(m);
}

/** One building: a textured box, an instanced roof cap, maybe an AC unit. */
function addBuilding(scene, rng, cx, cz, w, d) {
  const h = 8 + rng() * 30;
  const color = PALETTE.building[Math.floor(rng() * PALETTE.building.length)];
  const tex = makeWindowTexture(rng, hexCss(color));
  const mat = new THREE.MeshLambertMaterial({
    map: tex.map, emissive: 0xffffff, emissiveIntensity: 0,
  });
  mat.userData['窗户辉光'] = tex.glow;
  buildingMats.push(mat);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(cx, h / 2, cz);
  cityGroup.add(mesh);
  addProp('roof', cx, h + 0.3, cz, w + 0.4, 0.6, d + 0.4);
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  if (h > 24) addProp('ac', cx + w * 0.2, h + 1.4, cz - d * 0.15);
}

/** One palm: an instanced trunk (slight random lean) and an instanced crown. */
function addPalm(scene, rng, x, z) {
  addProp('trunk', x, 2.6, z, 1, 1, 1, 0, (rng() - 0.5) * 0.16);
  addProp('leaves', x, 5.8, z);
}

/** One street lamp: an instanced pole and an instanced head (shared material). */
function addLamp(scene, x, z) {
  addProp('pole', x, 3.2, z);
  addProp('lamp', x, 6.5, z);
}

/**
 * Night mode for the city: lamp heads go warm yellow (dull grey by day),
 * the road glows faintly blue, and every building's window-glow map is
 * hung on its material at intensity 1 (taken off again by day).
 */
export function setNightMode(on) {
  if (lampHeadMat) lampHeadMat.color.setHex(on ? LAMP_NIGHT : LAMP_DAY);
  if (roadMat) roadMat.emissiveIntensity = on ? 0.3 : 0;
  for (const mat of buildingMats) {
    const next = on ? mat.userData['窗户辉光'] : null;
    if (mat.emissiveMap !== next) {
      mat.emissiveMap = next;
      mat.needsUpdate = true;
    }
    mat.emissiveIntensity = on ? 1 : 0;
  }
}

// ---- city build -----------------------------------------------------------

export function buildCity(scene, seed = 1) {
  const rng = mulberry32(seed);
  cityGroup = new THREE.Group();
  scene.add(cityGroup);
  const half = WORLD.size / 2;
  const step = WORLD.block;
  colliders.length = 0;
  roadLines.length = 0;
  propTiles.length = 0;
  buildingMats.length = 0;
  lampHeadMat = new THREE.MeshBasicMaterial({ color: LAMP_DAY });

  const makeKit = (geometry, material) => ({ geometry, material, tiles: new Map() });
  const lambert = (color) => new THREE.MeshLambertMaterial({ color });
  propKits = {
    roof: makeKit(new THREE.BoxGeometry(1, 1, 1), lambert(ROOF_BROWN)),
    ac: makeKit(new THREE.BoxGeometry(3, 1.6, 3), lambert(AC_GREY)),
    trunk: makeKit(new THREE.CylinderGeometry(0.22, 0.34, 5.2, 6, 1, true), lambert(PALETTE.palmTrunk)),
    leaves: makeKit(new THREE.ConeGeometry(2.4, 2.2, 7), lambert(PALETTE.palmLeaf)),
    pole: makeKit(new THREE.CylinderGeometry(0.09, 0.12, 6.4, 6, 1, true), lambert(POLE_BLUE)),
    lamp: makeKit(new THREE.SphereGeometry(0.32, 10, 8), lampHeadMat),
    dash: makeKit(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: PALETTE.roadLine })),
  };

  // Ground, beach, sea.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size + 160, WORLD.size + 160),
    lambert(PALETTE.ground),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  cityGroup.add(ground);
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(60, WORLD.size + 160),
    lambert(SAND),
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(half + 30, 0, 0);
  cityGroup.add(beach);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(220, WORLD.size + 160),
    lambert(SEA),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(half + 170, -0.2, 0);
  cityGroup.add(sea);

  // Roads and sidewalks on every grid line.
  roadMat = new THREE.MeshLambertMaterial({
    color: PALETTE.road, emissive: 0x0e1a2e, emissiveIntensity: 0,
  });
  const sidewalkMat = lambert(PALETTE.sidewalk);
  const sideOff = WORLD.roadWidth / 2 + 2;
  for (let p = -half; p <= half; p += step) {
    const roadX = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, WORLD.roadWidth), roadMat);
    roadX.rotation.x = -Math.PI / 2;
    roadX.position.set(0, 0.02, p);
    cityGroup.add(roadX);
    const roadZ = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.roadWidth, WORLD.size), roadMat);
    roadZ.rotation.x = -Math.PI / 2;
    roadZ.position.set(p, 0.02, 0);
    cityGroup.add(roadZ);
    roadLines.push({ axis: 'x', at: p }, { axis: 'z', at: p });
    for (const s of [-sideOff, sideOff]) {
      const walkX = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, 4), sidewalkMat);
      walkX.rotation.x = -Math.PI / 2;
      walkX.position.set(0, 0.01, p + s);
      cityGroup.add(walkX);
      const walkZ = new THREE.Mesh(new THREE.PlaneGeometry(4, WORLD.size), sidewalkMat);
      walkZ.rotation.x = -Math.PI / 2;
      walkZ.position.set(p + s, 0.01, 0);
      cityGroup.add(walkZ);
    }
  }

  // Dashed centre lines down the two central avenues.
  for (let d = -half; d <= half; d += 12) {
    addProp('dash', d, 0.04, 0, 5, 0.5, 1, -Math.PI / 2, 0);
    addProp('dash', 0, 0.04, d, 0.5, 5, 1, -Math.PI / 2, 0);
  }

  // Buildings, one or two per block.
  const inner = step - WORLD.roadWidth - 2 * WORLD.buildingGap;
  for (let cx = -half + step / 2; cx <= half - step / 2; cx += step) {
    for (let cz = -half + step / 2; cz <= half - step / 2; cz += step) {
      if (Math.abs(cx) < 30 && Math.abs(cz - 100) < 30) continue; // spawn plaza
      if (cx === half - step / 2) continue; // eastern column stays low (beach)
      if (rng() < 0.55) {
        addBuilding(scene, rng, cx, cz, inner, inner);
      } else {
        const w = inner / 2 - 2;
        addBuilding(scene, rng, cx - inner / 4, cz, w, inner);
        addBuilding(scene, rng, cx + inner / 4, cz, w, inner);
      }
    }
  }

  // Palms along the central avenue and the beach front, three per stop.
  for (let t = -half; t <= half; t += 28) {
    addPalm(scene, rng, -8, t);
    addPalm(scene, rng, 8, t + 14);
    addPalm(scene, rng, half - 8, t + 7);
  }

  // Lamps along both central avenues, staggered on both sides.
  for (let t = -half; t <= half; t += 40) {
    addLamp(scene, -7, t);
    addLamp(scene, 7, t + 20);
    addLamp(scene, t, -7);
    addLamp(scene, t + 20, 7);
  }

  // Landmarks: a coloured box and a sign each, plus a collision box.
  const LANDMARKS = [
    ['diner', 7, 0xff7a1a],
    ['pier', 6, 0x3f6fb5],
    ['safehouse', 6, 0x2e8b6a],
    ['alley', 9, 0x7a5fc0],
  ];
  const signMat = new THREE.MeshBasicMaterial({ color: SIGN_CREAM });
  for (const [name, h, color] of LANDMARKS) {
    const pos = PLACES[name];
    const box = new THREE.Mesh(new THREE.BoxGeometry(14, h, 10), lambert(color));
    box.position.set(pos.x, h / 2, pos.z);
    cityGroup.add(box);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(10, 2.2, 0.6), signMat);
    sign.position.set(pos.x, h + 1.6, pos.z);
    cityGroup.add(sign);
    colliders.push({ minX: pos.x - 7, maxX: pos.x + 7, minZ: pos.z - 5, maxZ: pos.z + 5 });
  }

  // Bake every prop kind into one InstancedMesh per tile.
  for (const [kind, kit] of Object.entries(propKits)) {
    kit.geometry.computeBoundingBox();
    kit.geometry.computeBoundingSphere();
    for (const matrices of kit.tiles.values()) {
      const mesh = new THREE.InstancedMesh(kit.geometry, kit.material, matrices.length);
      for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      const spheres = matrices.map((m) => {
        if (kind === 'roof' || kind === 'dash') {
          // Non-uniformly scaled box/plane: box through the matrix, then a sphere.
          return kit.geometry.boundingBox.clone().applyMatrix4(m).getBoundingSphere(new THREE.Sphere());
        }
        return kit.geometry.boundingSphere.clone().applyMatrix4(m);
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
  propKits = null; // temporary build data, released
}

// ---- queries --------------------------------------------------------------

/** The building and landmark collision boxes. */
export function getColliders() {
  return colliders;
}

/** A random point on a road: a road line snapped to the block pitch, then anywhere along it. */
export function randomRoadPoint(rng, margin = 20) {
  const half = WORLD.size / 2 - margin;
  const lines = WORLD.size / WORLD.block;
  const linePos = -WORLD.size / 2 + Math.floor(rng() * lines) * WORLD.block;
  if (rng() < 0.5) return { x: (rng() * 2 - 1) * half, z: linePos, axis: 'x' };
  return { x: linePos, z: (rng() * 2 - 1) * half, axis: 'z' };
}

/** Snap a point to its nearest road line, and say which way that road runs. */
export function snapToRoad(x, z) {
  const rx = Math.round(x / WORLD.block) * WORLD.block;
  const rz = Math.round(z / WORLD.block) * WORLD.block;
  if (Math.abs(x - rx) <= Math.abs(z - rz)) return { x: rx, z, axis: 'z' };
  return { x, z: rz, axis: 'x' };
}

/**
 * Push a circle out of every collision box it overlaps (or out along the
 * shallowest axis when its centre is inside one), then clamp to the world.
 */
export function resolveCircleCollision(x, z, radius) {
  let nx = x;
  let nz = z;
  for (const b of colliders) {
    const cx = clamp(nx, b.minX, b.maxX);
    const cz = clamp(nz, b.minZ, b.maxZ);
    const dx = nx - cx;
    const dz = nz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      nx = cx + (dx / d) * radius;
      nz = cz + (dz / d) * radius;
    } else {
      const pl = nx - b.minX;
      const pr = b.maxX - nx;
      const pt = nz - b.minZ;
      const pb = b.maxZ - nz;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) nx = b.minX - radius;
      else if (m === pr) nx = b.maxX + radius;
      else if (m === pt) nz = b.minZ - radius;
      else nz = b.maxZ + radius;
    }
  }
  const half = WORLD.size / 2;
  return { x: clamp(nx, -half, half), z: clamp(nz, -half, half) };
}

/** A named landmark's position from the config table, or null. */
export function getLandmark(name) {
  return PLACES[name] ?? null;
}

// ---- per-frame visibility -------------------------------------------------

/**
 * Frustum-cull the instanced props: a coarse pass per tile on the mesh's
 * bounding sphere, then a fine pass per instance sphere. Only visible
 * instances are written back into the front slots and counted; when the
 * visible list is unchanged, nothing is written.
 */
export function updateCityVisibility(camera) {
  camera.updateMatrixWorld();
  viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProj);
  for (const tile of propTiles) {
    if (!tile.mesh.boundingSphere) continue;
    if (!frustum.intersectsSphere(tile.mesh.boundingSphere)) continue;
    const visible = [];
    for (let i = 0; i < tile.spheres.length; i++) {
      if (frustum.intersectsSphere(tile.spheres[i])) visible.push(i);
    }
    const same = visible.length === tile.visible.length
      && visible.every((v, i) => v === tile.visible[i]);
    if (same) continue;
    for (let i = 0; i < visible.length; i++) {
      tile.mesh.setMatrixAt(i, tile.matrices[visible[i]]);
    }
    tile.mesh.count = visible.length;
    tile.mesh.instanceMatrix.needsUpdate = true;
    tile.visible = visible;
  }
}
