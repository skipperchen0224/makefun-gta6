// Round 5 pickups: health, armour, ammo and cash on the sidewalks, plus drops from downed
// crew and wrecked cop cars. Touch one on foot or drive through it to collect; fixed
// pickups come back after PICKUP_RESPAWN seconds, drops vanish after thirty.

import * as THREE from 'three';
import { PICKUP_KINDS, PICKUP_RESPAWN, WORLD, mulberry32 } from './config.js';

const pickups = [];
let sceneRef = null;
const geo = new THREE.OctahedronGeometry(0.6, 0);
const mats = {};

function makeMesh(kind) {
  if (!mats[kind]) {
    const c = PICKUP_KINDS[kind].color;
    mats[kind] = new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.55 });
  }
  const mesh = new THREE.Mesh(geo, mats[kind]);
  mesh.castShadow = true;
  sceneRef.add(mesh);
  return mesh;
}

export function addPickup(kind, x, z, drop = false) {
  const p = { kind, x, z, mesh: makeMesh(kind), active: true, timer: drop ? 30 : 0, drop };
  p.mesh.position.set(x, 1, z);
  pickups.push(p);
  return p;
}

// Fixed pickups sit on sidewalk corners, chosen by the seed so every run is the same map.
export function initPickups(scene, seed = 1) {
  sceneRef = scene;
  pickups.length = 0;
  const rng = mulberry32(seed + 404);
  const kinds = Object.keys(PICKUP_KINDS);
  const cells = WORLD.size / WORLD.block;
  for (let i = 0; i < 16; i++) {
    const gx = (Math.floor(rng() * (cells - 1)) - cells / 2 + 1) * WORLD.block;
    const gz = (Math.floor(rng() * (cells - 1)) - cells / 2 + 1) * WORLD.block;
    addPickup(kinds[i % kinds.length], gx + 7, gz + 7);
  }
}

// Spin, bob, respawn, and collect. `onCollect(kind)` applies the effect in main.js.
export function updatePickups(dt, px, pz, inCar, onCollect) {
  const t = performance.now() / 1000;
  const reach = inCar ? 3.2 : 1.8;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    if (!p.active) {
      p.timer -= dt;
      if (p.timer <= 0) { p.active = true; p.mesh.visible = true; }
      continue;
    }
    p.mesh.rotation.y = t * 2;
    p.mesh.position.y = 1 + Math.sin(t * 3 + p.x) * 0.2;
    if (p.drop) {
      p.timer -= dt;
      if (p.timer <= 0) { sceneRef.remove(p.mesh); pickups.splice(i, 1); continue; }
    }
    const dx = p.x - px;
    const dz = p.z - pz;
    if (dx * dx + dz * dz < reach * reach) {
      onCollect(p.kind);
      if (p.drop) { sceneRef.remove(p.mesh); pickups.splice(i, 1); continue; }
      p.active = false;
      p.mesh.visible = false;
      p.timer = PICKUP_RESPAWN;
    }
  }
}

export function getPickups() { return pickups.filter((p) => p.active); }
