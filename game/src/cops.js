// Police spawn on the road grid, chase by heading (or along the streets when a building is
// in the way), ram, arrest, shoot with line of sight at 3+ stars, set roadblocks and send
// intercepts; at 5 stars a helicopter circles with a searchlight that tracks you after dark.
// alertTo(): a big drift or horn blast in front of a cop sends the nearest unit to look.

import * as THREE from 'three';
import { PALETTE, WANTED_RULES, POLICE, WORLD, clamp } from './config.js';
import { createCar, driveCar } from './vehicles.js';
import { resolveCircleCollision, segmentBlocked, roadWaypoint, snapToRoad } from './city.js';

const cops = [];
let sceneRef = null;
let heli = null;
let heliCone = null;
let heliAngle = 0;
let spawnCooldown = 0;
// Intercept units are on top of the star quota for a while, so the cap doesn't cull them.
let interceptExtra = 0;
let interceptLeft = 0;
// Round 5 roadblocks: pairs of parked cruisers across the road ahead of you at 3+ stars.
const roadblocks = [];
let roadblockTimer = 6;
let nightMode = false;

export function initCops(scene) {
  sceneRef = scene;
  cops.length = 0;
  spawnCooldown = 0;
  if (heli) { scene.remove(heli); scene.remove(heliCone); heli = null; heliCone = null; }
}

// After dark the helicopter's searchlight cone comes on.
export function setNightMode(on) {
  nightMode = on;
  if (heliCone) heliCone.visible = on;
}

function wantedToCount(stars) {
  if (stars <= 0) return 0;
  return Math.min(1 + stars, 6); // 1 star: 2 cars ... 5 stars: 6 cars
}

// Round 5: units always arrive on a street, never inside a building.
function spawnCopNear(px, pz, angle, radius = 55 + Math.random() * 25) {
  const half = WORLD.size / 2 - 10;
  const p = snapToRoad(clamp(px + Math.cos(angle) * radius, -half, half), clamp(pz + Math.sin(angle) * radius, -half, half));
  const x = p.x;
  const z = p.z;
  const car = createCar(PALETTE.copCar, x, z, Math.atan2(px - x, pz - z), true);
  car.cruise = 0;
  car.hp = 60;
  car.alertX = null;
  car.alertZ = null;
  car.alertUntil = 0;
  cops.push(car);
  return car;
}

// A disturbance at (x, z) — a drift show, a horn blast — sends the nearest
// cop to look. The alert fades after a few seconds if nothing is found.
export function alertTo(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const cop of cops) {
    if (cop.dead) continue;
    const dx = cop.x - x;
    const dz = cop.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) { bestD = d2; best = cop; }
  }
  if (!best) return;
  best.alertX = x;
  best.alertZ = z;
  best.alertUntil = performance.now() + 6000;
}

function buildHeli() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.4, 5),
    new THREE.MeshLambertMaterial({ color: 0x223344 }),
  );
  g.add(body);
  const rotor = new THREE.Mesh(
    new THREE.BoxGeometry(9, 0.12, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x111111 }),
  );
  rotor.position.y = 1.1;
  g.add(rotor);
  g.userData.rotor = rotor;
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  lamp.position.set(0, -0.9, 1.5);
  g.add(lamp);
  g.userData.lamp = lamp;
  // Searchlight cone: a translucent beam under the heli, night only.
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(5, 1, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff2cc, transparent: true, opacity: 0.08,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  cone.geometry.translate(0, 0.5, 0);
  cone.visible = nightMode;
  // Round 5: the beam is a world object that tracks the player, with a bright pool where it lands.
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(5, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff2cc, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  pool.rotation.x = -Math.PI / 2;
  cone.add(pool);
  sceneRef.add(cone);
  heliCone = cone;
  return g;
}

// Two cruisers parked nose-to-tail across the next intersection on your route.
export function spawnRoadblock(player, ahead = 70) {
  const B = WORLD.block;
  const half = WORLD.size / 2 - B;
  const h = player.heading || 0;
  const ix = clamp(Math.round((player.x + Math.sin(h) * ahead) / B) * B, -half, half);
  const iz = clamp(Math.round((player.z + Math.cos(h) * ahead) / B) * B, -half, half);
  const alongX = Math.abs(Math.sin(h)) > Math.abs(Math.cos(h));
  for (const side of [-1, 1]) {
    const x = alongX ? ix : ix + side * 2.6;
    const z = alongX ? iz + side * 2.6 : iz;
    const car = createCar(PALETTE.copCar, x, z, alongX ? 0 : Math.PI / 2, true);
    car.life = 40;
    roadblocks.push(car);
  }
}

function updateRoadblocks(dt, stars, player) {
  if (stars >= POLICE.roadblockAt) {
    roadblockTimer -= dt;
    if (roadblockTimer <= 0 && player.inCar) {
      roadblockTimer = POLICE.roadblockEvery;
      spawnRoadblock(player);
    }
  }
  const phase = Math.floor(performance.now() / 260) % 2 === 0;
  for (let i = roadblocks.length - 1; i >= 0; i--) {
    const rb = roadblocks[i];
    rb.life -= dt;
    if (stars === 0 || rb.life <= 0 || Math.hypot(rb.x - player.x, rb.z - player.z) > 170) {
      sceneRef.remove(rb.mesh);
      roadblocks.splice(i, 1);
      continue;
    }
    rb.mesh.userData.redLight.emissiveIntensity = phase ? 1 : 0.1;
    rb.mesh.userData.blueLight.emissiveIntensity = phase ? 0.1 : 1;
  }
}

export function getRoadblocks() { return roadblocks; }

// Units sent to intercept: `count` cruisers on the streets ahead of the player,
// within `spread` radians of their heading. Used when the heat jumps to 4 stars.
export function spawnIntercept(player, count = 2, radius = 60, spread = 0.6) {
  interceptExtra = count;
  interceptLeft = 25;
  for (let i = 0; i < count; i++) {
    const a = Math.PI / 2 - (player.heading || 0) + (Math.random() * 2 - 1) * spread;
    spawnCopNear(player.x, player.z, a, radius * (0.6 + Math.random() * 0.4));
  }
}

// Returns true while any unit (or the helicopter) has eyes on the player: within
// POLICE.sightRange with no building in between. main.js only lets stars decay
// when this is false, so breaking line of sight is how you lose the cops.
export function updateCops(dt, stars, player, onArrest, onCopShot) {
  let seen = false;
  updateRoadblocks(dt, stars, player);
  // Spawn / despawn to match the wanted level.
  spawnCooldown -= dt;
  const want = wantedToCount(stars);
  if (cops.length < want && spawnCooldown <= 0) {
    spawnCopNear(player.x, player.z, Math.random() * Math.PI * 2);
    spawnCooldown = 2.5;
  }
  interceptLeft -= dt;
  if (cops.length > want + (interceptLeft > 0 ? interceptExtra : 0)) {
    const extra = cops.pop();
    if (extra) {
      sceneRef.remove(extra.mesh);
    }
  }

  // Helicopter at 5 stars.
  if (stars >= WANTED_RULES.heliAtStars && !heli) {
    heli = buildHeli();
    sceneRef.add(heli);
  } else if (stars < WANTED_RULES.heliAtStars && heli) {
    sceneRef.remove(heli);
    sceneRef.remove(heliCone);
    heli = null;
    heliCone = null;
  }
  if (heli) {
    heliAngle += dt * 0.55;
    heli.position.set(
      player.x + Math.cos(heliAngle) * 26,
      34 + Math.sin(heliAngle * 2.3) * 2,
      player.z + Math.sin(heliAngle) * 26,
    );
    heli.lookAt(player.x, 30, player.z);
    if (heliCone) {
      // Cone base sits on the player, tip under the heli's nose lamp.
      const top = new THREE.Vector3(heli.position.x, heli.position.y - 1, heli.position.z);
      const dir = top.clone().sub(new THREE.Vector3(player.x, 0.05, player.z));
      const len = dir.length();
      heliCone.position.set(player.x, 0.05, player.z);
      heliCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      heliCone.scale.set(1, len, 1);
    }
    heli.userData.rotor.rotation.y += dt * 22;
    heli.userData.lamp.material.color.setHex(
      Math.floor(performance.now() / 300) % 2 === 0 ? 0xffffff : 0xffdd88,
    );
  }

  // Chase: steer toward the player (or toward an alert point), ram, and
  // shoot at 3+ stars.
  for (const cop of cops) {
    if (cop.dead) continue;
    const hasAlert = cop.alertUntil > performance.now() && cop.alertX !== null;
    let tx = hasAlert ? cop.alertX : player.x;
    let tz = hasAlert ? cop.alertZ : player.z;
    const dist = Math.hypot(player.x - cop.x, player.z - cop.z) || 1;
    // Line of sight, re-checked four times a second per unit.
    cop.losTimer = (cop.losTimer ?? 0) - dt;
    if (cop.losTimer <= 0) {
      cop.losTimer = 0.25;
      cop.hasLos = dist < POLICE.sightRange && !segmentBlocked(cop.x, cop.z, player.x, player.z);
    }
    if (cop.hasLos) seen = true;
    // No clear line: drive the street grid toward the target instead of into a wall.
    if (!cop.hasLos && segmentBlocked(cop.x, cop.z, tx, tz)) {
      if (!cop.wp || Math.hypot(cop.wp.x - cop.x, cop.wp.z - cop.z) < 5) cop.wp = roadWaypoint(cop.x, cop.z, tx, tz);
      tx = cop.wp.x;
      tz = cop.wp.z;
    } else {
      cop.wp = null;
    }
    const dx = tx - cop.x;
    const dz = tz - cop.z;
    const targetHeading = Math.atan2(dx, dz);
    let diff = targetHeading - cop.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    cop.heading += clamp(diff, -2.2 * dt, 2.2 * dt);
    const chaseSpeed = 16 + stars * 3.2;
    cop.speed = Math.min(chaseSpeed, cop.speed + 14 * dt);
    const nx = cop.x + Math.sin(cop.heading) * cop.speed * dt;
    const nz = cop.z + Math.cos(cop.heading) * cop.speed * dt;
    const hit = resolveCircleCollision(nx, nz, 2.2);
    cop.x = hit.x;
    cop.z = hit.z;
    cop.mesh.position.set(cop.x, 0, cop.z);
    cop.mesh.rotation.y = cop.heading;

    // Ram: close + fast = damage to the player's car (handled by main.js via return).
    // Arrest: player on foot, slow, and a cop right on top of them.
    if (!player.inCar && dist < 2.6 && Math.abs(player.speed || 0) < 2.5) {
      onArrest();
    }
    // Shooting at 3+ stars: damage ticks when the cop has a clear-ish shot.
    if (stars >= WANTED_RULES.copShootAtStars && dist < 55 && cop.hasLos) {
      cop.shotTimer = (cop.shotTimer ?? 0.6) - dt;
      if (cop.shotTimer <= 0) {
        cop.shotTimer = 0.9 + Math.random() * 0.7;
        onCopShot(dist);
      }
    }
  }
  // The helicopter sees you unless a building stands between its ground track and you.
  if (heli && !segmentBlocked(heli.position.x, heli.position.z, player.x, player.z)) seen = true;
  return seen;
}

// A cop car the player shot: damage it, maybe kill it (and raise heat).
export function damageCop(cop, amount) {
  cop.hp -= amount;
  if (cop.hp <= 0 && !cop.dead) {
    cop.dead = true;
    cop.mesh.rotation.z = 0.4;
    cop.mesh.position.y = 0.3;
    const i = cops.indexOf(cop);
    if (i !== -1) cops.splice(i, 1);
    return true;
  }
  return false;
}

export function getCops() { return cops; }

export function clearCops() {
  for (const cop of cops) sceneRef.remove(cop.mesh);
  cops.length = 0;
  if (heli) { sceneRef.remove(heli); sceneRef.remove(heliCone); heli = null; heliCone = null; }
  for (const rb of roadblocks) sceneRef.remove(rb.mesh);
  roadblocks.length = 0;
  roadblockTimer = 6;
}
