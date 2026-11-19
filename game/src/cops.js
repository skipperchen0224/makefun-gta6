// Palmetto Heat — police.
// Cop cars spawn at the city edge in proportion to the wanted level, chase
// the player, ram the car, and arrest a slow player on foot. At 3+ stars they
// shoot; at 5 a helicopter circles overhead and never lands.

import * as THREE from 'three';
import { PALETTE, WANTED_RULES, clamp } from './config.js';
import { createCar, driveCar } from './vehicles.js';
import { resolveCircleCollision } from './city.js';

const cops = [];
let sceneRef = null;
let heli = null;
let heliAngle = 0;
let spawnCooldown = 0;

export function initCops(scene) {
  sceneRef = scene;
  cops.length = 0;
  spawnCooldown = 0;
  if (heli) { scene.remove(heli); heli = null; }
}

function wantedToCount(stars) {
  if (stars <= 0) return 0;
  return Math.min(1 + stars, 6); // 1 star: 2 cars ... 5 stars: 6 cars
}

function spawnCopNear(px, pz, angle) {
  const r = 55 + Math.random() * 25;
  const x = px + Math.cos(angle) * r;
  const z = pz + Math.sin(angle) * r;
  const car = createCar(PALETTE.copCar, x, z, Math.atan2(px - x, pz - z), true);
  car.cruise = 0;
  car.hp = 60;
  cops.push(car);
  return car;
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
  return g;
}

export function updateCops(dt, stars, player, onArrest, onCopShot) {
  // Spawn / despawn to match the wanted level.
  spawnCooldown -= dt;
  const want = wantedToCount(stars);
  if (cops.length < want && spawnCooldown <= 0) {
    spawnCopNear(player.x, player.z, Math.random() * Math.PI * 2);
    spawnCooldown = 2.5;
  }
  if (cops.length > want) {
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
    heli = null;
  }
  if (heli) {
    heliAngle += dt * 0.55;
    heli.position.set(
      player.x + Math.cos(heliAngle) * 26,
      34 + Math.sin(heliAngle * 2.3) * 2,
      player.z + Math.sin(heliAngle) * 26,
    );
    heli.lookAt(player.x, 30, player.z);
    heli.userData.rotor.rotation.y += dt * 22;
    heli.userData.lamp.material.color.setHex(
      Math.floor(performance.now() / 300) % 2 === 0 ? 0xffffff : 0xffdd88,
    );
  }

  // Chase: steer toward the player, ram, and shoot at 3+ stars.
  for (const cop of cops) {
    if (cop.dead) continue;
    const dx = player.x - cop.x;
    const dz = player.z - cop.z;
    const dist = Math.hypot(dx, dz) || 1;
    const targetHeading = Math.atan2(dx, dz);
    let diff = targetHeading - cop.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    cop.heading += clamp(diff, -1.6 * dt, 1.6 * dt);
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
    if (stars >= WANTED_RULES.copShootAtStars && dist < 55) {
      cop.shotTimer = (cop.shotTimer ?? 0.6) - dt;
      if (cop.shotTimer <= 0) {
        cop.shotTimer = 0.9 + Math.random() * 0.7;
        onCopShot(dist);
      }
    }
  }
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
  if (heli) { sceneRef.remove(heli); heli = null; }
}
