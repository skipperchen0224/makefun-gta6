// Pedestrians wander the sidewalks, flee gunfire, and form the hostile squads some missions need.
// Walk / flee / down state machine; rain makes walkers hurry and flee farther. Civilians are
// recycled near the player; hostile crew close in and hold their ground to shoot.

import * as THREE from 'three';
import { WORLD, TRAFFIC, clamp, mulberry32 } from './config.js';
import { resolveCircleCollision, snapToRoad } from './city.js';

const peds = [];
let sceneRef = null;
let rng = mulberry32(5);
let raining = false;
const SHIRT_COLORS = [0xe8e8e8, 0x3f6fb5, 0xc23b2e, 0x2e8b6a, 0xd9a441, 0x7a5fc0, 0xe87ab0];

// Called by the weather system: rain makes the streets hurry.
export function setRain(isRaining) { raining = isRaining; }

function buildPedMesh(shirtColor, hostile = false) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: hostile ? 0x8a4a3a : 0xd9a986 });
  const shirt = new THREE.MeshLambertMaterial({ color: hostile ? 0xaa1111 : shirtColor });
  const legs = new THREE.MeshLambertMaterial({ color: 0x2c3240 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.95, 8), shirt);
  body.position.y = 1.05;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), skin);
  head.position.y = 1.78;
  g.add(head);
  for (const x of [-0.14, 0.14]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.55, 6), legs);
    leg.position.set(x, 0.32, 0);
    g.add(leg);
  }
  g.userData.legs = g.children.filter((c) => c.geometry && c.geometry.type === 'CylinderGeometry' && c.position.y < 0.5);
  return g;
}

export function initPeds(scene, seed = 5) {
  sceneRef = scene;
  rng = mulberry32(seed);
  peds.length = 0;
}

export function spawnPed(x, z, hostile = false) {
  const mesh = buildPedMesh(SHIRT_COLORS[Math.floor(rng() * SHIRT_COLORS.length)], hostile);
  mesh.position.set(x, 0, z);
  mesh.traverse((o) => { o.castShadow = true; });
  sceneRef.add(mesh);
  const ped = {
    mesh,
    x, z,
    heading: rng() * Math.PI * 2,
    speed: 1.2 + rng() * 1.2,
    state: 'walk',       // walk | flee | down
    hp: hostile ? 3 : 1,
    hostile,
    fleeTime: 0,
    walkPhase: rng() * 10,
  };
  peds.push(ped);
  return ped;
}

export function spawnPeds(count = 16) {
  const half = WORLD.size / 2 - 15;
  for (let i = 0; i < count; i++) {
    const snapped = snapToRoad((rng() * 2 - 1) * half, (rng() * 2 - 1) * half);
    // Sidewalk offset: a few metres off the road centre.
    const off = (rng() < 0.5 ? -1 : 1) * (7 + rng() * 3);
    const x = snapped.axis === 'x' ? snapped.x + (rng() * 2 - 1) * half * 0.2 : snapped.x + off;
    const z = snapped.axis === 'z' ? snapped.z + (rng() * 2 - 1) * half * 0.2 : snapped.z + off;
    spawnPed(x, z).heading = snapped.axis === 'x' ? (rng() < 0.5 ? 1 : -1) * Math.PI / 2 : (rng() < 0.5 ? 0 : Math.PI);
  }
}

// Round 5: a civilian who wanders out past TRAFFIC.recycle reappears on a
// sidewalk 60-110 m from the player, so the streets around you stay busy.
function recyclePed(p, px, pz) {
  const half = WORLD.size / 2 - 20;
  const a = rng() * Math.PI * 2;
  const r = 60 + rng() * 50;
  const s = snapToRoad(clamp(px + Math.cos(a) * r, -half, half), clamp(pz + Math.sin(a) * r, -half, half));
  const off = (rng() < 0.5 ? -1 : 1) * (7 + rng() * 1.5);
  p.x = s.axis === 'x' ? s.x : s.x + off;
  p.z = s.axis === 'x' ? s.z + off : s.z;
  p.heading = s.axis === 'x' ? (rng() < 0.5 ? 1 : -1) * Math.PI / 2 : (rng() < 0.5 ? 0 : Math.PI);
  p.state = 'walk';
  p.hp = 1;
  p.mesh.rotation.x = 0;
  p.mesh.position.y = 0;
}

export function spawnHostileSquad(x, z, count = 5) {
  const squad = [];
  for (let i = 0; i < count; i++) {
    squad.push(spawnPed(x + (rng() - 0.5) * 16, z + (rng() - 0.5) * 16, true));
  }
  return squad;
}

// Gunfire (or a horn blast) at (x, z): everyone nearby runs away from it.
// In the rain the scare radius grows — wet streets, short tempers.
export function scarePeds(x, z, radius = 45) {
  const r = raining ? radius * 1.3 : radius;
  for (const p of peds) {
    if (p.state === 'down' || p.hostile) continue;
    const dx = p.x - x;
    const dz = p.z - z;
    if (dx * dx + dz * dz < r * r) {
      p.state = 'flee';
      p.fleeTime = 4 + rng() * 2;
      p.heading = Math.atan2(dx, dz);
    }
  }
}

export function updatePeds(dt, playerX, playerZ, playerInCar, carSpeed) {
  const hurry = raining ? 1.6 : 1;
  for (const p of peds) {
    if (!p.hostile && Math.hypot(p.x - playerX, p.z - playerZ) > TRAFFIC.recycle) recyclePed(p, playerX, playerZ);
    if (p.state === 'down') continue;
    let speed = p.speed * hurry;
    if (p.hostile) {
      // Crew stand their ground: close to 14 m, then hold and shoot (main.js fires).
      const d = Math.hypot(playerX - p.x, playerZ - p.z);
      p.heading = Math.atan2(playerX - p.x, playerZ - p.z);
      speed = d > 14 && d < 70 ? 3.2 : 0;
    }
    if (p.state === 'flee') {
      speed = 4.5 * hurry;
      p.fleeTime -= dt;
      if (p.fleeTime <= 0) {
        p.state = 'walk';
        p.heading = Math.round(p.heading / (Math.PI / 2)) * (Math.PI / 2);
      }
    } else if (p.state === 'walk' && !p.hostile) {
      // Stroll along the sidewalk, now and then turn back; dodge a fast car ahead.
      if (rng() < dt * 0.04) p.heading += Math.PI;
      if (playerInCar && Math.abs(carSpeed) > 8) {
        const dx = p.x - playerX;
        const dz = p.z - playerZ;
        const d2 = dx * dx + dz * dz;
        if (d2 < 14 * 14) {
          p.state = 'flee';
          p.fleeTime = 2.5;
          p.heading = Math.atan2(dx, dz);
          speed = 4.5 * hurry;
        }
      }
    }
    const nx = p.x + Math.sin(p.heading) * speed * dt;
    const nz = p.z + Math.cos(p.heading) * speed * dt;
    const hit = resolveCircleCollision(nx, nz, 0.6);
    p.x = hit.x;
    p.z = hit.z;
    p.mesh.position.set(p.x, 0, p.z);
    p.mesh.rotation.y = p.heading;
    // Cheap walk cycle: legs swing opposite.
    p.walkPhase += dt * speed * 3;
    const swing = Math.sin(p.walkPhase) * 0.4;
    if (p.mesh.userData.legs.length === 2) {
      p.mesh.userData.legs[0].rotation.x = swing;
      p.mesh.userData.legs[1].rotation.x = -swing;
    }
    // Fallen peds lie flat; walkers stay upright.
    p.mesh.rotation.x = 0;
  }
}

// A hit on a ped: returns 'hurt' | 'down' | null (miss handled by caller).
export function hitPed(ped, damage = 1) {
  if (!ped || ped.state === 'down') return null;
  ped.hp -= damage;
  if (ped.hp <= 0) {
    ped.state = 'down';
    ped.mesh.rotation.x = Math.PI / 2;
    ped.mesh.position.y = 0.3;
    return 'down';
  }
  scarePeds(ped.x, ped.z, 20);
  return 'hurt';
}

export function getPeds() { return peds; }

export function removePed(ped) {
  sceneRef.remove(ped.mesh);
  const i = peds.indexOf(ped);
  if (i !== -1) peds.splice(i, 1);
}

export function countHostilesUp() {
  return peds.filter((p) => p.hostile && p.state !== 'down').length;
}
