// Palmetto Heat — procedural Palmetto City.
// A seeded grid of blocks: roads on every `block` line, buildings inside the
// blocks, palms along the sidewalks, and the AABB colliders every other
// system steers around. Nothing here is random at runtime: the seed comes
// from ?seed= so screenshots are reproducible. Street lamps line the
// avenues and switch on after dark (setNightMode, driven by weather.js).

import * as THREE from 'three';
import { WORLD, PALETTE, PLACES, mulberry32 } from './config.js';

// Every building's footprint, for collision and for keeping traffic on roads.
const colliders = [];
// Road centrelines, for traffic, peds and mission spawns.
const roadLines = [];
let cityGroup = null;
// Shared lamp-head material: one colour swap lights the whole city.
let lampMat = null;
let roadMat = null;
const buildingMats = [];
let props = null;
const PROP_TILE_SIZE = WORLD.block * 3;
const propTiles = [];
const propFrustum = new THREE.Frustum();
const viewProjection = new THREE.Matrix4();

export function updateCityVisibility(camera) {
  camera.updateMatrixWorld();
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  propFrustum.setFromProjectionMatrix(viewProjection);
  for (const tile of propTiles) {
    const { mesh, matrices, bounds } = tile;
    if (!propFrustum.intersectsSphere(mesh.boundingSphere)) continue;
    const visible = [];
    for (let i = 0; i < matrices.length; i++) {
      if (propFrustum.intersectsSphere(bounds[i])) visible.push(i);
    }
    if (visible.length !== tile.visible.length || visible.some((index, i) => index !== tile.visible[i])) {
      visible.forEach((index, i) => mesh.setMatrixAt(i, matrices[index]));
      mesh.count = visible.length;
      mesh.instanceMatrix.needsUpdate = true;
      tile.visible = visible;
    }
  }
}

function addProp(kind, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  const transform = new THREE.Object3D();
  transform.position.set(x, y, z);
  transform.scale.set(sx, sy, sz);
  transform.rotation.set(rx, 0, rz);
  transform.updateMatrix();
  const tiles = props[kind].tiles;
  const key = `${Math.floor(x / PROP_TILE_SIZE)},${Math.floor(z / PROP_TILE_SIZE)}`;
  if (!tiles.has(key)) tiles.set(key, []);
  tiles.get(key).push(transform.matrix);
}

function makeWindowTexture(rng, baseColor) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  const e = document.createElement('canvas');
  e.width = 64;
  e.height = 128;
  const eg = e.getContext('2d');
  eg.fillStyle = '#000000';
  eg.fillRect(0, 0, 64, 128);
  g.fillStyle = baseColor;
  g.fillRect(0, 0, 64, 128);
  const cols = 4;
  const rows = 8;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const lit = rng() < 0.35;
      g.fillStyle = lit ? '#ffe9a8' : '#2c3e50';
      g.fillRect(4 + x * 15, 6 + y * 15, 10, 9);
      if (lit) {
        eg.fillStyle = '#ffe9a8';
        eg.fillRect(4 + x * 15, 6 + y * 15, 10, 9);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const emissiveMap = new THREE.CanvasTexture(e);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map: tex, emissiveMap };
}

function hexCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

function addBuilding(scene, rng, cx, cz, w, d) {
  const h = 8 + rng() * 30;
  const color = PALETTE.building[Math.floor(rng() * PALETTE.building.length)];
  const { map, emissiveMap } = makeWindowTexture(rng, hexCss(color));
  const mat = new THREE.MeshLambertMaterial({
    map, emissive: 0xffffff, emissiveIntensity: 0,
  });
  mat.userData.windowGlow = emissiveMap;
  buildingMats.push(mat);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(cx, h / 2, cz);
  scene.add(mesh);
  // Flat roof cap so the top reads as a roof, not stretched windows.
  addProp('roof', cx, h + 0.3, cz, w + 0.4, 0.6, d + 0.4);
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  // Rooftop AC box on tall towers, for skyline variety.
  if (h > 24) {
    addProp('ac', cx + w * 0.2, h + 1.4, cz - d * 0.15);
  }
}

function addPalm(scene, rng, x, z) {
  addProp('trunk', x, 2.6, z, 1, 1, 1, 0, (rng() - 0.5) * 0.16);
  addProp('leaves', x, 5.8, z);
}

// One street lamp: a dark pole and a lamp head that shares lampMat, so the
// whole city lights up with a single colour swap at night.
function addLamp(scene, x, z) {
  addProp('pole', x, 3.2, z);
  addProp('head', x, 6.5, z);
}

// Night mode: lamp heads go from dull grey to warm yellow.
export function setNightMode(on) {
  if (lampMat) lampMat.color.setHex(on ? 0xffe9a8 : 0x4a5058);
  if (roadMat) roadMat.emissiveIntensity = on ? 0.3 : 0;
  for (const mat of buildingMats) {
    const map = on ? mat.userData.windowGlow : null;
    if (mat.emissiveMap !== map) {
      mat.emissiveMap = map;
      mat.needsUpdate = true;
    }
    mat.emissiveIntensity = on ? 1 : 0;
  }
}

export function buildCity(scene, seed = 1) {
  const rng = mulberry32(seed);
  cityGroup = new THREE.Group();
  scene.add(cityGroup);
  const half = WORLD.size / 2;
  const step = WORLD.block;
  lampMat = new THREE.MeshBasicMaterial({ color: 0x4a5058 });
  buildingMats.length = 0;
  propTiles.length = 0;
  const prop = (geometry, color) => ({
    geometry, material: new THREE.MeshLambertMaterial({ color }), tiles: new Map(),
  });
  props = {
    roof: prop(new THREE.BoxGeometry(1, 1, 1), 0x6b5d4f),
    ac: prop(new THREE.BoxGeometry(3, 1.6, 3), 0x8a8f96),
    trunk: prop(new THREE.CylinderGeometry(0.22, 0.34, 5.2, 6, 1, true), PALETTE.palmTrunk),
    leaves: prop(new THREE.ConeGeometry(2.4, 2.2, 7), PALETTE.palmLeaf),
    pole: prop(new THREE.CylinderGeometry(0.09, 0.12, 6.4, 6, 1, true), 0x2c3240),
    head: { geometry: new THREE.SphereGeometry(0.32, 8, 6), material: lampMat, tiles: new Map() },
    dash: { geometry: new THREE.PlaneGeometry(1, 1), material: new THREE.MeshBasicMaterial({ color: PALETTE.roadLine }), tiles: new Map() },
  };

  // Ground: warm grass with a sand-coloured beach strip on the east edge.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size + 160, WORLD.size + 160),
    new THREE.MeshLambertMaterial({ color: PALETTE.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  cityGroup.add(ground);
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(60, WORLD.size + 160),
    new THREE.MeshLambertMaterial({ color: 0xe8d9a0 }),
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

  // Roads: dark strips on every grid line, plus a dashed centre line.
  roadMat = new THREE.MeshLambertMaterial({ color: PALETTE.road, emissive: 0x182d48, emissiveIntensity: 0 });
  const walkMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
  for (let c = -half; c <= half; c += step) {
    for (const [w, h, x, z, axis] of [
      [WORLD.size, WORLD.roadWidth, 0, c, 'x'],
      [WORLD.roadWidth, WORLD.size, c, 0, 'z'],
    ]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, h), roadMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(x, 0.02, z);
      cityGroup.add(strip);
      roadLines.push({ axis, at: axis === 'x' ? z : x });
    }
    // Sidewalk slabs flanking each road, so blocks read as blocks.
    for (const off of [-WORLD.roadWidth / 2 - 2, WORLD.roadWidth / 2 + 2]) {
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, 4), walkMat);
      sw.rotation.x = -Math.PI / 2;
      sw.position.set(0, 0.01, c + off);
      cityGroup.add(sw);
    }
  }
  // Dashed centre lines along the two central avenues.
  for (let t = -half; t < half; t += 12) {
    for (const [x, z, w, h] of [[t, 0, 5, 0.5], [0, t, 0.5, 5]]) {
      addProp('dash', x, 0.04, z, w, h, 1, -Math.PI / 2);
    }
  }

  // Buildings: one or two per block, kept off the roads and the spawn plaza.
  const blockInner = step - WORLD.roadWidth - WORLD.buildingGap * 2;
  for (let bx = -half + step / 2; bx < half; bx += step) {
    for (let bz = -half + step / 2; bz < half; bz += step) {
      if (Math.abs(bx) < 30 && Math.abs(bz - 100) < 30) continue; // spawn plaza
      if (bx > half - step) continue; // beach blocks stay low
      const count = rng() < 0.55 ? 1 : 2;
      if (count === 1) {
        addBuilding(scene, rng, bx, bz, blockInner, blockInner);
      } else {
        const w = blockInner / 2 - 2;
        addBuilding(scene, rng, bx - blockInner / 4, bz, w, blockInner);
        addBuilding(scene, rng, bx + blockInner / 4, bz, w, blockInner);
      }
    }
  }

  // Palms along the central avenue and the beach front.
  for (let t = -half + 20; t < half - 10; t += 28) {
    addPalm(scene, rng, -8, t);
    addPalm(scene, rng, 8, t + 14);
    addPalm(scene, rng, half - 8, t + 7);
  }

  // Street lamps down both central avenues, alternating sides.
  for (let t = -half + 20; t < half - 10; t += 40) {
    addLamp(scene, -7.5, t);
    addLamp(scene, 7.5, t + 20);
    addLamp(scene, t, -7.5);
    addLamp(scene, t + 20, 7.5);
  }

  for (const [kind, { geometry, material, tiles }] of Object.entries(props)) {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    for (const matrices of tiles.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      const bounds = matrices.map((matrix) => kind === 'roof' || kind === 'dash'
        ? geometry.boundingBox.clone().applyMatrix4(matrix).getBoundingSphere(new THREE.Sphere())
        : geometry.boundingSphere.clone().applyMatrix4(matrix));
      propTiles.push({ mesh, matrices, bounds, visible: matrices.map((_, i) => i) });
      cityGroup.add(mesh);
    }
  }
  props = null;

  // Diner, pier and safehouse landmarks: simple coloured boxes with a sign slab.
  const landmark = (place, color, h) => {
    const p = PLACES[place];
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(14, h, 10),
      new THREE.MeshLambertMaterial({ color }),
    );
    m.position.set(p.x, h / 2, p.z);
    cityGroup.add(m);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(10, 2.2, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xfff2cc }),
    );
    sign.position.set(p.x, h + 1.6, p.z);
    cityGroup.add(sign);
    colliders.push({ minX: p.x - 7, maxX: p.x + 7, minZ: p.z - 5, maxZ: p.z + 5 });
  };
  landmark('diner', 0xd96a4a, 7);
  landmark('pier', 0x4a90b8, 6);
  landmark('safehouse', 0x6a8f5a, 6);
  landmark('alley', 0x7a6a8a, 9);
}

export function getColliders() { return colliders; }

// A random point on a road (traffic spawns and mission tail targets use this).
export function randomRoadPoint(rng, margin = 20) {
  const half = WORLD.size / 2 - margin;
  const axis = rng() < 0.5 ? 'x' : 'z';
  const line = (Math.floor(rng() * (WORLD.size / WORLD.block)) - WORLD.size / WORLD.block / 2) * WORLD.block;
  const along = (rng() * 2 - 1) * half;
  return axis === 'x' ? { x: along, z: line, axis } : { x: line, z: along, axis };
}

// Nearest road line coordinate to a point, so cars snap onto roads.
export function snapToRoad(x, z) {
  const step = WORLD.block;
  const snap = (v) => Math.round(v / step) * step;
  return Math.abs(x - snap(x)) < Math.abs(z - snap(z))
    ? { x: snap(x), z, axis: 'z' }
    : { x, z: snap(z), axis: 'x' };
}

// Circle (x, z, r) vs building AABBs: returns a corrected position or null.
export function resolveCircleCollision(x, z, r) {
  let px = x;
  let pz = z;
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(px, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pz, c.maxZ));
    const dx = px - nx;
    const dz = pz - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      px = nx + (dx / d) * r;
      pz = nz + (dz / d) * r;
    } else if (d2 <= 0.0001) {
      // Centre inside the box: push out along the smallest penetration axis.
      const pushL = px - c.minX + r;
      const pushR = c.maxX - px + r;
      const pushU = pz - c.minZ + r;
      const pushD = c.maxZ - pz + r;
      const m = Math.min(pushL, pushR, pushU, pushD);
      if (m === pushL) px = c.minX - r;
      else if (m === pushR) px = c.maxX + r;
      else if (m === pushU) pz = c.minZ - r;
      else pz = c.maxZ + r;
    }
  }
  const half = WORLD.size / 2;
  px = Math.max(-half, Math.min(half, px));
  pz = Math.max(-half, Math.min(half, pz));
  return { x: px, z: pz };
}

export function placeOf(name) { return PLACES[name]; }
