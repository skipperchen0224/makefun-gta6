// Palmetto Heat — the city: seed-grown blocks, roads, palms, lamps and landmarks.
// One deterministic build from a seed: the same ?seed= always grows the same
// streets, so every screenshot is reproducible. Static props (roof caps, AC
// units, palm trunks and crowns, lamp posts and heads, road dashes) are
// batched into one InstancedMesh per kind per tile, and culled per frame
// against the camera frustum. At night the windows glow and the lamps come on.

import * as THREE from 'three';
import { WORLD, PALETTE, PLACES, mulberry32 } from './config.js';

const colliders = [];
const roadLines = [];
let cityGroup = null;
let lampMat = null;
let roadMat = null;
const buildingMats = [];
let props = {};
const TILE = WORLD.block * 3;
const propTiles = [];
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const dummy = new THREE.Object3D();

function hexCss(n) {
  return `#${n.toString(16).padStart(6, '0')}`;
}

// Paint a building face: a 4x8 grid of windows on a 64x128 canvas, plus a
// second canvas that only carries the lit windows (black elsewhere) so the
// night glow can be switched on by swapping the emissive map.
function makeWindowMaps(rng, base) {
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = 64;
  baseCanvas.height = 128;
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64;
  glowCanvas.height = 128;
  const b = baseCanvas.getContext('2d');
  const g = glowCanvas.getContext('2d');
  b.fillStyle = base;
  b.fillRect(0, 0, 64, 128);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, 64, 128);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 4 + col * 15;
      const y = 6 + row * 15;
      const lit = rng() < 0.35;
      const color = lit ? hexCss(PALETTE.windowLit) : hexCss(PALETTE.windowDark);
      b.fillStyle = color;
      b.fillRect(x, y, 10, 9);
      if (lit) {
        g.fillStyle = hexCss(PALETTE.windowLit);
        g.fillRect(x, y, 10, 9);
      }
    }
  }
  const map = new THREE.CanvasTexture(baseCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.CanvasTexture(glowCanvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  return { map, glow };
}

function addBuilding(scene, rng, cx, cz, w, d) {
  const h = 8 + rng() * 30;
  const color = PALETTE.building[Math.floor(rng() * PALETTE.building.length)];
  const { map, glow } = makeWindowMaps(rng, hexCss(color));
  const mat = new THREE.MeshLambertMaterial({
    map, emissive: 0xffffff, emissiveIntensity: 0,
  });
  mat.userData.windowGlow = glow;
  buildingMats.push(mat);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  body.position.set(cx, h / 2, cz);
  scene.add(body);
  addProp('roof', cx, h + 0.3, cz, w + 0.4, 0.6, d + 0.4);
  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  if (h > 24) {
    addProp('ac', cx + w * 0.2, h + 1.4, cz - d * 0.15);
  }
}

function addPalm(scene, rng, x, z) {
  addProp('trunk', x, 2.6, z, 1, 1, 1, (rng() - 0.5) * 0.16, 0);
  addProp('leaf', x, 5.8, z);
}

function addLamp(scene, x, z) {
  addProp('pole', x, 3.2, z);
  addProp('lamp', x, 6.5, z);
}

export function setNightMode(on) {
  if (lampMat) lampMat.color.setHex(on ? PALETTE.windowLit : 0x4a4f55);
  if (roadMat) roadMat.emissiveIntensity = on ? 0.3 : 0;
  for (const mat of buildingMats) {
    const glow = mat.userData.windowGlow || null;
    const next = on ? glow : null;
    if (mat.emissiveMap !== next) {
      mat.emissiveMap = next;
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
  lampMat = new THREE.MeshBasicMaterial({ color: 0x4a4f55 });
  buildingMats.length = 0;
  colliders.length = 0;
  roadLines.length = 0;
  propTiles.length = 0;

  function makeProp(geometry, material) {
    return { geo: geometry, mat: material, tiles: new Map() };
  }
  props = {
    roof: makeProp(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0x5a3d2b })),
    ac: makeProp(new THREE.BoxGeometry(3, 1.6, 3),
      new THREE.MeshLambertMaterial({ color: 0x8a8f96 })),
    trunk: makeProp(new THREE.CylinderGeometry(0.22, 0.34, 5.2, 6, 1, true),
      new THREE.MeshLambertMaterial({ color: PALETTE.palmTrunk })),
    leaf: makeProp(new THREE.ConeGeometry(2.4, 2.2, 7),
      new THREE.MeshLambertMaterial({ color: PALETTE.palmLeaf })),
    pole: makeProp(new THREE.CylinderGeometry(0.09, 0.12, 6.4, 6, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x2e3a4a })),
    lamp: makeProp(new THREE.SphereGeometry(0.32, 10, 8), lampMat),
    dash: makeProp(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: PALETTE.roadLine })),
  };

  // Ground, beach, sea.
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

  // Roads and sidewalks on every grid line.
  roadMat = new THREE.MeshLambertMaterial({
    color: PALETTE.road, emissive: 0x182d48, emissiveIntensity: 0,
  });
  const walkMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
  for (let pos = -half; pos <= half; pos += step) {
    const alongX = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, WORLD.roadWidth), roadMat);
    alongX.rotation.x = -Math.PI / 2;
    alongX.position.set(0, 0.02, pos);
    cityGroup.add(alongX);
    const alongZ = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.roadWidth, WORLD.size), roadMat);
    alongZ.rotation.x = -Math.PI / 2;
    alongZ.position.set(pos, 0.02, 0);
    cityGroup.add(alongZ);
    roadLines.push({ axis: 'x', at: pos });
    roadLines.push({ axis: 'z', at: pos });
    const off = WORLD.roadWidth / 2 + 2;
    for (const side of [-1, 1]) {
      const walkX = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, 4), walkMat);
      walkX.rotation.x = -Math.PI / 2;
      walkX.position.set(0, 0.01, pos + side * off);
      cityGroup.add(walkX);
      const walkZ = new THREE.Mesh(new THREE.PlaneGeometry(4, WORLD.size), walkMat);
      walkZ.rotation.x = -Math.PI / 2;
      walkZ.position.set(pos + side * off, 0.01, 0);
      cityGroup.add(walkZ);
    }
  }

  // Centre-line dashes down the two central avenues.
  for (let p = -half; p <= half; p += 12) {
    addProp('dash', p, 0.04, 0, 5, 0.5, 1, -Math.PI / 2, 0);
    addProp('dash', 0, 0.04, p, 0.5, 5, 1, -Math.PI / 2, 0);
  }

  // Buildings, one or two per block.
  const inner = step - WORLD.roadWidth - 2 * WORLD.buildingGap;
  for (let cx = -half + step / 2; cx <= half - step / 2; cx += step) {
    for (let cz = -half + step / 2; cz <= half - step / 2; cz += step) {
      if (Math.abs(cx) < 30 && Math.abs(cz - 100) < 30) continue; // spawn plaza
      if (cx >= half - step / 2) continue; // beachfront blocks stay low
      if (rng() < 0.55) {
        addBuilding(cityGroup, rng, cx, cz, inner, inner);
      } else {
        addBuilding(cityGroup, rng, cx - inner / 4, cz, inner / 2 - 2, inner);
        addBuilding(cityGroup, rng, cx + inner / 4, cz, inner / 2 - 2, inner);
      }
    }
  }

  // Palms along the central avenue and the beachfront.
  for (let z = -half; z <= half; z += 28) {
    addPalm(cityGroup, rng, -8, z);
    addPalm(cityGroup, rng, 8, z + 14);
    addPalm(cityGroup, rng, half - 12, z + 7);
  }

  // Lamps along both central avenues, staggered.
  for (let p = -half; p <= half; p += 40) {
    addLamp(cityGroup, -7, p);
    addLamp(cityGroup, 7, p + 20);
    addLamp(cityGroup, p, -7);
    addLamp(cityGroup, p + 20, 7);
  }

  // Landmarks: a coloured box and a sign each.
  const landmarkDefs = [
    { name: 'diner', h: 7, color: 0xe87ab0 },
    { name: 'pier', h: 6, color: 0x3f6fb5 },
    { name: 'safehouse', h: 6, color: 0x2e8b6a },
    { name: 'alley', h: 9, color: 0x7a5fc0 },
  ];
  for (const def of landmarkDefs) {
    const place = PLACES[def.name];
    if (!place) continue;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(14, def.h, 10),
      new THREE.MeshLambertMaterial({ color: def.color }),
    );
    box.position.set(place.x, def.h / 2, place.z);
    cityGroup.add(box);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(10, 2.2, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xf2ead8 }),
    );
    sign.position.set(place.x, def.h + 1.6, place.z);
    cityGroup.add(sign);
    colliders.push({
      minX: place.x - 7, maxX: place.x + 7,
      minZ: place.z - 5, maxZ: place.z + 5,
    });
  }

  // Bake every prop kind into one InstancedMesh per tile.
  for (const kind of Object.keys(props)) {
    const def = props[kind];
    def.geo.computeBoundingBox();
    def.geo.computeBoundingSphere();
    const useBox = kind === 'roof' || kind === 'dash';
    for (const [key, matrices] of def.tiles) {
      if (matrices.length === 0) continue;
      const mesh = new THREE.InstancedMesh(def.geo, def.mat, matrices.length);
      const spheres = [];
      for (let i = 0; i < matrices.length; i++) {
        mesh.setMatrixAt(i, matrices[i]);
        const sphere = useBox
          ? new THREE.Box3().copy(def.geo.boundingBox).applyMatrix4(matrices[i])
            .getBoundingSphere(new THREE.Sphere())
          : def.geo.boundingSphere.clone().applyMatrix4(matrices[i]);
        spheres.push(sphere);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      propTiles.push({
        mesh, matrices, spheres,
        visible: matrices.map((_, i) => i),
      });
      cityGroup.add(mesh);
    }
  }
  props = {};
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
  const lineX = Math.round(x / WORLD.block) * WORLD.block;
  const lineZ = Math.round(z / WORLD.block) * WORLD.block;
  if (Math.abs(x - lineX) < Math.abs(z - lineZ)) {
    return { x: lineX, z, axis: 'z' };
  }
  return { x, z: lineZ, axis: 'x' };
}

export function resolveCircleCollision(x, z, r) {
  for (const box of colliders) {
    const cx = Math.max(box.minX, Math.min(x, box.maxX));
    const cz = Math.max(box.minZ, Math.min(z, box.maxZ));
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      x = cx + (dx / d) * r;
      z = cz + (dz / d) * r;
    } else if (d2 <= 0.0001 && x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) {
      const penL = x - box.minX;
      const penR = box.maxX - x;
      const penT = z - box.minZ;
      const penB = box.maxZ - z;
      const m = Math.min(penL, penR, penT, penB);
      if (m === penL) x = box.minX - r;
      else if (m === penR) x = box.maxX + r;
      else if (m === penT) z = box.minZ - r;
      else z = box.maxZ + r;
    }
  }
  const half = WORLD.size / 2;
  x = Math.max(-half, Math.min(half, x));
  z = Math.max(-half, Math.min(half, z));
  return { x, z };
}

export function getPlace(name) {
  return PLACES[name] || null;
}

function addProp(kind, x, y, z, sx = 1, sy = 1, sz = 1, rotX = 0, rotY = 0) {
  const def = props[kind];
  if (!def) return;
  dummy.position.set(x, y, z);
  dummy.scale.set(sx, sy, sz);
  dummy.rotation.set(rotX, rotY, 0);
  dummy.updateMatrix();
  const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
  let list = def.tiles.get(key);
  if (!list) {
    list = [];
    def.tiles.set(key, list);
  }
  list.push(dummy.matrix.clone());
}

export function updateCityVisibility(camera) {
  camera.updateMatrixWorld();
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  for (const tile of propTiles) {
    if (!frustum.intersectsSphere(tile.mesh.boundingSphere)) continue;
    const seen = [];
    for (let i = 0; i < tile.spheres.length; i++) {
      if (frustum.intersectsSphere(tile.spheres[i])) seen.push(i);
    }
    if (seen.length === tile.visible.length
      && seen.every((v, i) => v === tile.visible[i])) continue;
    for (let j = 0; j < seen.length; j++) {
      tile.mesh.setMatrixAt(j, tile.matrices[seen[j]]);
    }
    tile.mesh.count = seen.length;
    tile.mesh.instanceMatrix.needsUpdate = true;
    tile.visible = seen;
  }
}
