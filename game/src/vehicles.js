// Palmetto Heat — cars: build, drive, steal, crash.
// Arcade physics on purpose: throttle, steering scaled by speed, handbrake
// drift, building collision through city.js, and traffic that stays on the
// road lines instead of ever ploughing through a block.

import * as THREE from 'three';
import { CAR, PALETTE, clamp, mulberry32 } from './config.js';
import { resolveCircleCollision, randomRoadPoint } from './city.js';

let sceneRef = null;
let rng = mulberry32(1);
export const traffic = [];

function buildCarMesh(color, isCop = false) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a2733 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.4), bodyMat);
  body.position.y = 0.62;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.2), glassMat);
  cabin.position.set(0, 1.18, -0.2);
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const wheels = [];
  for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.36, z);
    g.add(w);
    wheels.push(w);
  }
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c9 });
  for (const x of [-0.6, 0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), headMat);
    h.position.set(x, 0.66, 2.22);
    g.add(h);
  }
  if (isCop) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.16, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    bar.position.set(0, 1.55, -0.2);
    g.add(bar);
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xff2222 }),
    );
    red.position.set(-0.32, 1.55, -0.2);
    g.add(red);
    const blue = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, 0.42),
      new THREE.MeshBasicMaterial({ color: 0x2244ff }),
    );
    blue.position.set(0.32, 1.55, -0.2);
    g.add(blue);
    g.userData.lights = [red, blue];
  }
  g.userData.wheels = wheels;
  return g;
}

export function createCar(color, x, z, heading = 0, isCop = false) {
  const mesh = buildCarMesh(color, isCop);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  sceneRef.add(mesh);
  const car = {
    mesh,
    x, z,
    heading,
    speed: 0,
    hp: 100,
    isCop,
    isPlayer: false,
    dead: false,
    wheelSpin: 0,
  };
  return car;
}

export function initVehicles(scene, seed = 1) {
  sceneRef = scene;
  rng = mulberry32(seed + 77);
  traffic.length = 0;
}

// Player's own car: orange, parked by the spawn plaza.
export function spawnPlayerCar(x, z) {
  const car = createCar(PALETTE.playerCar, x, z, Math.PI);
  car.isPlayer = true;
  return car;
}

// Traffic: 10 cars, each spawned on a road line and driving along it.
// When one gets far from the player it is recycled onto a nearer road.
export function spawnTraffic(count = 10) {
  for (let i = 0; i < count; i++) {
    const p = randomRoadPoint(rng);
    const color = PALETTE.trafficCar[Math.floor(rng() * PALETTE.trafficCar.length)];
    const heading = p.axis === 'x' ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng() < 0.5 ? 0 : Math.PI);
    const car = createCar(color, p.x, p.z, heading);
    car.cruise = 9 + rng() * 6;
    car.axis = p.axis;
    car.dir = rng() < 0.5 ? 1 : -1;
    traffic.push(car);
  }
}

function syncMesh(car) {
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  car.wheelSpin += car.speed * 0.05;
  for (const w of car.mesh.userData.wheels) w.rotation.x = car.wheelSpin;
  if (car.mesh.userData.lights) {
    const t = Math.floor(performance.now() / 260) % 2;
    car.mesh.userData.lights[0].material.color.setHex(t === 0 ? 0xff2222 : 0x551111);
    car.mesh.userData.lights[1].material.color.setHex(t === 1 ? 0x2244ff : 0x111155);
  }
}

// Arcade drive step. Returns distance travelled (for crash sound + damage).
export function driveCar(car, dt, throttle, steer, brake) {
  if (car.dead) return 0;
  const forward = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
  if (throttle > 0) car.speed += CAR.accel * throttle * dt;
  else if (throttle < 0) car.speed -= (car.speed > 0.5 ? CAR.brake : CAR.reverseAccel) * dt;
  if (brake) car.speed -= Math.sign(car.speed) * CAR.brake * dt;
  // Drag + grip: kill sideways drift unless handbraking.
  const grip = brake ? CAR.handbrakeGrip : CAR.grip;
  car.speed -= car.speed * 0.25 * dt;
  car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
  if (Math.abs(car.speed) < 0.05 && throttle === 0) car.speed = 0;
  const speedFactor = clamp(Math.abs(car.speed) / 12, 0, 1);
  car.heading += steer * CAR.turnRate * speedFactor * Math.sign(car.speed || 1) * dt * (brake ? 1.5 : 1);
  void grip;
  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  void forward;
  const hit = resolveCircleCollision(nx, nz, CAR.radius);
  const crashed = Math.abs(hit.x - nx) > 0.01 || Math.abs(hit.z - nz) > 0.01;
  if (crashed) {
    car.speed *= -0.25;
    car.hp -= 4;
    if (car.hp <= 0) car.dead = true;
  }
  car.x = hit.x;
  car.z = hit.z;
  syncMesh(car);
  return Math.abs(car.speed) * dt;
}

// Traffic AI: cruise along its road axis; at the city edge, turn around.
export function updateTraffic(dt, playerX, playerZ) {
  const half = 240;
  for (const car of traffic) {
    if (car.dead) continue;
    car.speed = car.cruise;
    const dx = Math.sin(car.heading) * car.speed * dt;
    const dz = Math.cos(car.heading) * car.speed * dt;
    car.x += dx;
    car.z += dz;
    if (Math.abs(car.x) > half - 8 || Math.abs(car.z) > half - 8) {
      car.heading += Math.PI; // U-turn at the edge
      car.x = clamp(car.x, -half + 10, half - 10);
      car.z = clamp(car.z, -half + 10, half - 10);
    }
    // Recycle far-away cars onto a road near the player so streets stay alive.
    const ddx = car.x - playerX;
    const ddz = car.z - playerZ;
    if (ddx * ddx + ddz * ddz > 200 * 200) {
      const p = randomRoadPoint(rng);
      const near = { x: playerX + (rng() - 0.5) * 120, z: playerZ + (rng() - 0.5) * 120 };
      void p;
      car.x = clamp(near.x, -half + 10, half - 10);
      car.z = clamp(near.z, -half + 10, half - 10);
      car.heading = rng() * Math.PI * 2;
    }
    syncMesh(car);
  }
}

// Nearest drivable car to a point (for F to steal / enter).
export function nearestCar(x, z, range, exclude = null) {
  let best = null;
  let bestD = range * range;
  const all = [...traffic];
  for (const car of all) {
    if (car === exclude || car.dead) continue;
    const dx = car.x - x;
    const dz = car.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) { bestD = d2; best = car; }
  }
  return best;
}

export function removeCar(car) {
  if (!sceneRef) return;
  sceneRef.remove(car.mesh);
  const i = traffic.indexOf(car);
  if (i !== -1) traffic.splice(i, 1);
}

export function explodeCar(car) {
  car.dead = true;
  car.mesh.rotation.z = 0.5;
  car.mesh.position.y = 0.4;
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff9922, transparent: true, opacity: 0.85 }),
  );
  flash.position.copy(car.mesh.position);
  sceneRef.add(flash);
  setTimeout(() => sceneRef.remove(flash), 450);
}
