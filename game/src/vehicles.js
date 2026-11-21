// Palmetto Heat — cars: build, drive, steal, crash.
// Arcade physics on purpose: throttle, speed-scaled steering, handbrake
// drifts, building collision through city.js, traffic that follows the road
// lines and never drives through a tower. Headlights and taillights share
// one material each across the whole city so night mode is a single switch.

import * as THREE from 'three';
import { CAR, DRIFT, PALETTE, clamp, mulberry32 } from './config.js';
import { resolveCircleCollision, randomRoadPoint } from './city.js';

let sceneRef = null;
let rng = mulberry32(1);
export const traffic = [];

const headMat = new THREE.MeshLambertMaterial({
  color: 0xfff6c9, emissive: 0xfff6c9, emissiveIntensity: 0,
});
const tailMat = new THREE.MeshLambertMaterial({
  color: 0x9b2020, emissive: 0xff2222, emissiveIntensity: 0,
});

export function setNightMode(on) {
  headMat.emissiveIntensity = on ? 1 : 0;
  tailMat.emissiveIntensity = on ? 1 : 0;
}

function buildCarMesh(color, isCop) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.62, 4.4),
    new THREE.MeshLambertMaterial({ color }),
  );
  body.position.y = 0.62;
  g.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.55, 2.2),
    new THREE.MeshLambertMaterial({ color: 0x8fb8cc }),
  );
  cabin.position.set(0, 1.18, -0.2);
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14181d });
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    g.add(wheel);
    wheels.push(wheel);
  }
  for (const side of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), headMat);
    head.position.set(side, 0.66, 2.22);
    g.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), tailMat);
    tail.position.set(side, 0.66, -2.22);
    g.add(tail);
  }
  g.userData.wheels = wheels;
  if (isCop) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.16, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x1a2733 }),
    );
    bar.position.y = 1.55;
    g.add(bar);
    const redMat = new THREE.MeshLambertMaterial({
      color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 1,
    });
    const blueMat = new THREE.MeshLambertMaterial({
      color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 0.1,
    });
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42), redMat);
    red.position.set(-0.3, 1.55, 0);
    g.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42), blueMat);
    blue.position.set(0.3, 1.55, 0);
    g.add(blue);
    g.userData.redMat = redMat;
    g.userData.blueMat = blueMat;
  }
  return g;
}

export function createCar(color, x, z, heading = 0, isCop = false) {
  const mesh = buildCarMesh(color, isCop);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  sceneRef.add(mesh);
  return {
    mesh, x, z, heading,
    speed: 0, hp: 100, isCop, isPlayer: false, dead: false,
    wheelSpin: 0, drifting: false, driftScore: 0, lastBanked: 0,
    grip: CAR.grip, cruise: 12,
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

export function spawnTraffic(count = 10) {
  for (let i = 0; i < count; i++) {
    const pt = randomRoadPoint(rng);
    const color = PALETTE.trafficCar[Math.floor(rng() * PALETTE.trafficCar.length)];
    const base = pt.axis === 'x'
      ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2)
      : (rng() < 0.5 ? 0 : Math.PI);
    const car = createCar(color, pt.x, pt.z, base);
    car.cruise = 9 + rng() * 6;
    car.axis = pt.axis;
    car.dir = rng() < 0.5 ? 1 : -1;
    if (car.dir < 0) car.heading += Math.PI;
    traffic.push(car);
  }
}

function syncMesh(car) {
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  car.wheelSpin += car.speed * 0.05;
  const wheels = car.mesh.userData.wheels || [];
  for (const wheel of wheels) wheel.rotation.x = car.wheelSpin;
  if (car.isCop && car.mesh.userData.redMat) {
    const phase = Math.floor(performance.now() / 260) % 2 === 0;
    car.mesh.userData.redMat.emissiveIntensity = phase ? 1 : 0.1;
    car.mesh.userData.blueMat.emissiveIntensity = phase ? 0.1 : 1;
  }
}

export function driveCar(car, dt, throttle, steer, handbrake) {
  if (car.dead) return 0;
  if (throttle > 0) {
    car.speed += CAR.accel * throttle * dt;
  } else if (throttle < 0) {
    if (car.speed > 0) car.speed -= CAR.brake * dt;
    else car.speed += CAR.reverseAccel * throttle * dt;
  }
  if (handbrake) car.speed -= Math.sign(car.speed) * CAR.brake * 0.6 * dt;
  const drifting = handbrake && Math.abs(car.speed) > DRIFT.minSpeed;
  const grip = car.grip || CAR.grip;
  const drag = drifting ? 0.1 : 0.25;
  car.speed -= car.speed * drag * dt;
  car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
  if (Math.abs(car.speed) < 0.05 && !throttle) car.speed = 0;
  const speedFactor = clamp(Math.abs(car.speed) / 12, 0, 1);
  const turnMult = drifting ? 1.8 : 1;
  car.heading += steer * CAR.turnRate * speedFactor * Math.sign(car.speed)
    * dt * turnMult * (grip / CAR.grip);
  if (drifting && steer !== 0) {
    car.drifting = true;
    car.driftScore += Math.abs(car.speed) * DRIFT.scoreRate * dt;
  } else if (car.drifting) {
    car.lastBanked = car.driftScore >= DRIFT.minBank ? car.driftScore : 0;
    car.driftScore = 0;
    car.drifting = false;
  }
  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  const hit = resolveCircleCollision(nx, nz, CAR.radius);
  if (Math.abs(hit.x - nx) > 0.01 || Math.abs(hit.z - nz) > 0.01) {
    car.speed *= -0.25;
    car.hp -= 4;
    if (car.drifting) {
      car.driftScore = 0;
      car.drifting = false;
    }
    if (car.hp <= 0) car.dead = true;
  }
  car.x = hit.x;
  car.z = hit.z;
  syncMesh(car);
  return Math.abs(car.speed) * dt;
}

export function updateTraffic(dt, px, pz) {
  const half = 240;
  for (const car of traffic) {
    if (car.dead) continue;
    car.speed = car.cruise;
    const nx = car.x + Math.sin(car.heading) * car.speed * dt;
    const nz = car.z + Math.cos(car.heading) * car.speed * dt;
    if (Math.abs(nx) > half - 8 || Math.abs(nz) > half - 8) {
      car.heading += Math.PI;
      car.x = Math.max(-(half - 10), Math.min(half - 10, nx));
      car.z = Math.max(-(half - 10), Math.min(half - 10, nz));
    } else {
      car.x = nx;
      car.z = nz;
    }
    const dx = car.x - px;
    const dz = car.z - pz;
    if (dx * dx + dz * dz > 200 * 200) {
      const pt = randomRoadPoint(rng);
      car.x = px + Math.max(-120, Math.min(120, pt.x - px));
      car.z = pz + Math.max(-120, Math.min(120, pt.z - pz));
      car.heading = rng() * Math.PI * 2;
    }
    syncMesh(car);
  }
}

export function nearestCar(x, z, range, exclude) {
  let best = null;
  let bestD = range * range;
  for (const car of traffic) {
    if (car === exclude || car.dead) continue;
    const dx = car.x - x;
    const dz = car.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) {
      bestD = d2;
      best = car;
    }
  }
  return best;
}

export function removeVehicle(car) {
  if (sceneRef) sceneRef.remove(car.mesh);
  const i = traffic.indexOf(car);
  if (i !== -1) traffic.splice(i, 1);
}

export function explodeCar(car) {
  car.dead = true;
  car.mesh.rotation.z = 0.5;
  car.mesh.position.y = 0.4;
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.7 }),
  );
  flash.position.set(car.x, 1, car.z);
  sceneRef.add(flash);
  setTimeout(() => { sceneRef.remove(flash); }, 450);
}
