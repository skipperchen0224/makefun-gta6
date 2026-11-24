// Cars: build, drive, steal, crash. Arcade physics on purpose — throttle,
// speed-scaled steering, handbrake drift, building collision via city.js,
// traffic drives on road lines and never through buildings. Round 5:
// 18 traffic cars, right-hand driving 2.6 m off the centre line, 35% turn
// chance at intersections, braking for the player and other cars, and
// respawn near the player past 190 m so the streets stay alive.
import * as THREE from 'three';
import { CAR, DRIFT, PALETTE, clamp, mulberry32 } from './config.js';
import { resolveCircleCollision, randomRoadPoint, snapToRoad } from './city.js';

let sceneRef = null;
let rng = mulberry32(1);
export const traffic = [];
const headlightMat = new THREE.MeshLambertMaterial({ color: 0xffe9a8, emissive: 0xffe9a8, emissiveIntensity: 0 });
const taillightMat = new THREE.MeshLambertMaterial({ color: 0x8a1111, emissive: 0xff2222, emissiveIntensity: 0 });
const headGlowMat = new THREE.SpriteMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const tailGlowMat = new THREE.SpriteMaterial({ color: 0xff3333, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });

export function setVehicleNight(on) {
  headlightMat.emissiveIntensity = on ? 1 : 0;
  taillightMat.emissiveIntensity = on ? 1 : 0;
  headGlowMat.opacity = on ? 0.5 : 0;
  tailGlowMat.opacity = on ? 0.45 : 0;
}

function buildCarMesh(color, isCop) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.62, 4.4), new THREE.MeshLambertMaterial({ color }));
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.2), new THREE.MeshLambertMaterial({ color: 0x1a2733 }));
  cabin.position.set(0, 1.18, -0.2);
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const wheels = [];
  for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.36, z);
    g.add(w);
    wheels.push(w);
  }
  for (const x of [-0.6, 0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), headlightMat);
    h.position.set(x, 0.66, 2.22);
    g.add(h);
    const hg = new THREE.Sprite(headGlowMat);
    hg.scale.set(1.6, 1.6, 1);
    hg.position.set(x, 0.66, 2.35);
    g.add(hg);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), taillightMat);
    t.position.set(x, 0.66, -2.22);
    g.add(t);
    const tg = new THREE.Sprite(tailGlowMat);
    tg.scale.set(1.4, 1.4, 1);
    tg.position.set(x, 0.66, -2.35);
    g.add(tg);
  }
  if (isCop) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.4), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    bar.position.y = 1.55;
    g.add(bar);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.set(-0.3, 1.56, 0);
    g.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42), new THREE.MeshBasicMaterial({ color: 0x2244ff }));
    blue.position.set(0.3, 1.56, 0);
    g.add(blue);
    g.userData.redLight = red;
    g.userData.blueLight = blue;
  }
  g.userData.wheels = wheels;
  return g;
}

export function createCar(color, x, z, heading = 0, isCop = false) {
  const mesh = buildCarMesh(color, isCop);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  sceneRef.add(mesh);
  return {
    mesh, x, z, heading, speed: 0, hp: 100, isCop,
    isPlayer: false, dead: false, wheelSpin: 0,
    drifting: false, driftScore: 0, lastBanked: 0,
    grip: CAR.grip, cruise: 0, axis: 'x', dir: 1, turnCooldown: 0,
  };
}

export function initVehicles(scene, seed = 1) {
  sceneRef = scene;
  rng = mulberry32(seed + 77);
  traffic.length = 0;
}

export function spawnPlayerCar(x, z) {
  const car = createCar(PALETTE.playerCar, x, z, Math.PI);
  car.isPlayer = true;
  return car;
}

export function spawnTraffic(count = 18) {
  for (let i = 0; i < count; i++) {
    const p = randomRoadPoint(rng);
    const color = PALETTE.trafficCar[Math.floor(rng() * PALETTE.trafficCar.length)];
    const heading = p.axis === 'x' ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng() < 0.5 ? 0 : Math.PI);
    const car = createCar(color, p.x, p.z, heading);
    car.cruise = 9 + rng() * 6;
    car.axis = p.axis;
    car.dir = heading === Math.PI / 2 || heading === 0 ? 1 : -1;
    traffic.push(car);
  }
}

function syncMesh(car) {
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  car.wheelSpin += car.speed * 0.05;
  for (const w of car.mesh.userData.wheels) w.rotation.x = car.wheelSpin;
  if (car.isCop && car.mesh.userData.redLight) {
    const on = Math.floor(performance.now() / 260) % 2 === 0;
    car.mesh.userData.redLight.material.color.setHex(on ? 0xff2222 : 0x551111);
    car.mesh.userData.blueLight.material.color.setHex(on ? 0x111155 : 0x2244ff);
  }
}

export function driveCar(car, dt, throttle, steer, handbrake) {
  if (car.dead) return 0;
  if (throttle > 0) car.speed += CAR.accel * dt;
  else if (throttle < 0) car.speed += (car.speed > 0.5 ? -CAR.brake : -CAR.reverseAccel) * dt;
  if (handbrake) car.speed -= Math.sign(car.speed) * CAR.brake * 0.6 * dt;
  const drifting = handbrake && Math.abs(car.speed) > DRIFT.minSpeed;
  const grip = car.grip || CAR.grip;
  const drag = drifting ? 0.1 : 0.25;
  car.speed -= car.speed * drag * dt;
  car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
  if (Math.abs(car.speed) < 0.05 && throttle === 0) car.speed = 0;
  const speedFactor = clamp(Math.abs(car.speed) / 12, 0, 1);
  const turnMult = drifting ? 1.8 : 1;
  car.heading += steer * CAR.turnRate * speedFactor * Math.sign(car.speed) * dt * turnMult * (CAR.grip / grip);
  if (drifting && steer !== 0) {
    car.drifting = true;
    car.driftScore += Math.abs(car.speed) * DRIFT.scoreRate * dt;
  } else if (car.drifting) {
    car.drifting = false;
    car.lastBanked = car.driftScore >= DRIFT.minBank ? car.driftScore : 0;
    car.driftScore = 0;
  }
  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  const before = { x: car.x, z: car.z };
  const hit = resolveCircleCollision(nx, nz, CAR.radius);
  const crashed = Math.hypot(hit.x - nx, hit.z - nz) > 0.01;
  car.x = hit.x;
  car.z = hit.z;
  if (crashed) {
    car.speed *= -0.25;
    car.hp -= 4;
    if (car.drifting) { car.drifting = false; car.driftScore = 0; car.lastBanked = 0; }
    if (car.hp <= 0) car.dead = true;
  }
  syncMesh(car);
  return Math.hypot(car.x - before.x, car.z - before.z);
}

// Round 5 traffic: right-hand driving, turns at intersections, braking.
export function updateTraffic(dt, px, pz, blockers = []) {
  const half = 240;
  for (const car of traffic) {
    if (car.dead) continue;
    // Brake for anything stopped ahead: the player, another car, a cop.
    const ax = Math.sin(car.heading), az = Math.cos(car.heading);
    let blocked = false;
    for (const b of blockers) {
      const dx = b.x - car.x, dz = b.z - car.z;
      const along = dx * ax + dz * az;
      const side = Math.abs(dx * az - dz * ax);
      if (along > 0 && along < 9 && side < 3.2) { blocked = true; break; }
    }
    if (!blocked) {
      for (const other of traffic) {
        if (other === car || other.dead) continue;
        const dx = other.x - car.x, dz = other.z - car.z;
        const along = dx * ax + dz * az;
        const side = Math.abs(dx * az - dz * ax);
        if (along > 0 && along < 8 && side < 3) { blocked = true; break; }
      }
    }
    car.speed = blocked ? 0 : car.cruise;
    car.turnCooldown -= dt;
    // At an intersection, 35% chance to turn left or right.
    const nearX = Math.abs(car.x - Math.round(car.x / 40) * 40) < 3;
    const nearZ = Math.abs(car.z - Math.round(car.z / 40) * 40) < 3;
    if (nearX && nearZ && car.turnCooldown <= 0 && rng() < 0.35 * dt * 10) {
      car.heading += (rng() < 0.5 ? 1 : -1) * Math.PI / 2;
      car.turnCooldown = 4;
      car.axis = car.axis === 'x' ? 'z' : 'x';
      car.dir = Math.abs(Math.sin(car.heading)) > 0.5 ? Math.sign(Math.sin(car.heading)) : Math.sign(Math.cos(car.heading));
    }
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
    // Right-hand driving: sit 2.6 m to the right of the road centre line.
    const snapped = snapToRoad(car.x, car.z);
    if (snapped.axis === 'x') car.z = snapped.z + (car.dir > 0 ? 2.6 : -2.6);
    else car.x = snapped.x + (car.dir > 0 ? -2.6 : 2.6);
    if (Math.abs(car.x) > half - 8 || Math.abs(car.z) > half - 8) {
      car.heading += Math.PI;
      car.x = clamp(car.x, -half + 10, half - 10);
      car.z = clamp(car.z, -half + 10, half - 10);
      car.dir = -car.dir;
    }
    const dx = car.x - px, dz = car.z - pz;
    if (dx * dx + dz * dz > 190 * 190) {
      const p = randomRoadPoint(rng);
      const near = snapToRoad(px + (rng() * 2 - 1) * 90, pz + (rng() * 2 - 1) * 90);
      car.x = near.x; car.z = near.z;
      car.heading = p.axis === 'x' ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng() < 0.5 ? 0 : Math.PI);
      car.axis = p.axis;
    }
    syncMesh(car);
  }
}

export function nearestCar(x, z, range, exclude = null) {
  let best = null, bestD = range * range;
  for (const car of traffic) {
    if (car === exclude || car.dead) continue;
    const dx = car.x - x, dz = car.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) { bestD = d2; best = car; }
  }
  return best;
}

export function removeCar(car) {
  sceneRef.remove(car.mesh);
  const i = traffic.indexOf(car);
  if (i !== -1) traffic.splice(i, 1);
}

export function explodeCar(car) {
  car.dead = true;
  car.mesh.rotation.z = 0.5;
  car.mesh.position.y = 0.4;
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.7 }),
  );
  flash.position.copy(car.mesh.position);
  sceneRef.add(flash);
  setTimeout(() => sceneRef.remove(flash), 450);
}
