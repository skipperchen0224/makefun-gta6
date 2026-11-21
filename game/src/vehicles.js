// Palmetto Heat — cars: build, drive, steal, crash.
// Arcade physics on purpose: throttle, speed-scaled steering, handbrake
// drift, building collisions through city.js, traffic that follows the
// road lines and never drives through a tower.

import * as THREE from 'three';
import { CAR, DRIFT, PALETTE, clamp, mulberry32 } from './config.js';
import { resolveCircleCollision, randomRoadPoint } from './city.js';

// ---- module state ---------------------------------------------------------
let sceneRef = null;
let rng = mulberry32(1);
export const traffic = []; // live traffic cars, driven by updateTraffic

// Headlights and taillights share two materials across every car, so one
// night switch lights the whole city fleet at once.
const headlightMat = new THREE.MeshLambertMaterial({
  color: 0xffe9a8, emissive: 0xffe9a8, emissiveIntensity: 0,
});
const taillightMat = new THREE.MeshLambertMaterial({
  color: 0x8a1111, emissive: 0xff2222, emissiveIntensity: 0,
});

const GLASS = 0x1a2733;
const ROOF_BAR = 0x2c3240;
const WHEEL_DARK = 0x14181d;

/** Night mode for the cars: headlights and taillights glow, or go dark by day. */
export function setNightMode(on) {
  headlightMat.emissiveIntensity = on ? 1 : 0;
  taillightMat.emissiveIntensity = on ? 1 : 0;
}

// ---- construction ---------------------------------------------------------

/** Build one car group: body, cabin, four wheels, headlights, taillights, cop kit. */
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
    new THREE.MeshLambertMaterial({ color: GLASS }),
  );
  cabin.position.set(0, 1.18, -0.2);
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: WHEEL_DARK });
  const wheels = [];
  for (const sx of [-0.95, 0.95]) {
    for (const sz of [-1.45, 1.45]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx, 0.36, sz);
      g.add(wheel);
      wheels.push(wheel);
    }
  }
  g.userData.wheels = wheels;
  for (const sx of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), headlightMat);
    head.position.set(sx, 0.66, 2.22);
    g.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), taillightMat);
    tail.position.set(sx, 0.66, -2.22);
    g.add(tail);
  }
  if (isCop) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.16, 0.4),
      new THREE.MeshLambertMaterial({ color: ROOF_BAR }),
    );
    bar.position.y = 1.55;
    g.add(bar);
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, 0.42),
      new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 0.9 }),
    );
    red.position.set(-0.32, 1.55, 0);
    g.add(red);
    const blue = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, 0.42),
      new THREE.MeshLambertMaterial({ color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 0.9 }),
    );
    blue.position.set(0.32, 1.55, 0);
    g.add(blue);
    g.userData.copLights = { red, blue };
  }
  return g;
}

/** One car object: mesh plus the driving state the loop reads and writes. */
export function createCar(color, x, z, heading = 0, isCop = false) {
  const mesh = buildCarMesh(color, isCop);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  sceneRef.add(mesh);
  return {
    mesh,
    x, z, heading,
    speed: 0,
    hp: 100,
    isCop,
    isPlayer: false,
    dead: false,
    wheelSpin: 0,
    drifting: false,
    driftScore: 0,
    lastBanked: 0,
    grip: CAR.grip,
    cruise: 0,
    axis: 'z',
    dir: 1,
  };
}

export function initVehicles(scene, seed = 1) {
  sceneRef = scene;
  rng = mulberry32(seed + 77);
  traffic.length = 0;
}

/** The player's own orange car, facing south (180 degrees). */
export function createPlayerCar(x, z) {
  const car = createCar(PALETTE.playerCar, x, z, Math.PI, false);
  car.isPlayer = true;
  return car;
}

/** Fill the streets with traffic: road points, random paint, road headings. */
export function spawnTraffic(count = 10) {
  for (let i = 0; i < count; i++) {
    const spot = randomRoadPoint(rng);
    const color = PALETTE.trafficCar[Math.floor(rng() * PALETTE.trafficCar.length)];
    const heading = spot.axis === 'x'
      ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2)
      : (rng() < 0.5 ? 0 : Math.PI);
    const car = createCar(color, spot.x, spot.z, heading, false);
    car.cruise = 9 + rng() * 6;
    car.axis = spot.axis;
    car.dir = rng() < 0.5 ? 1 : -1;
    traffic.push(car);
  }
}

// ---- per-frame ------------------------------------------------------------

/** Push a car's mesh to its state: position, heading, wheel spin, cop flash. */
function syncMesh(car) {
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  car.wheelSpin += car.speed * 0.05;
  for (const wheel of car.mesh.userData.wheels) {
    wheel.rotation.x = car.wheelSpin;
  }
  const lights = car.mesh.userData.copLights;
  if (lights) {
    const redOn = Math.floor(performance.now() / 260) % 2 === 0;
    lights.red.material.emissiveIntensity = redOn ? 1 : 0.15;
    lights.blue.material.emissiveIntensity = redOn ? 0.15 : 1;
  }
}

/**
 * Drive one car for a tick. Returns the distance travelled. Wall hits cost
 * speed and health; a drift that ends banks its points (or pays nothing
 * when it was too short), and a drift that ends against a wall pays nothing.
 */
export function driveCar(car, dt, throttle, steer, handbrake) {
  if (car.dead) return 0;
  if (throttle > 0) {
    car.speed += CAR.accel * throttle * dt;
  } else if (throttle < 0) {
    if (car.speed > 0.5) car.speed -= CAR.brake * dt;
    else car.speed += CAR.reverseAccel * throttle * dt;
  }
  if (handbrake) car.speed -= Math.sign(car.speed) * 18 * dt;
  const sliding = handbrake && Math.abs(car.speed) > DRIFT.minSpeed;
  const grip = car.grip || CAR.grip;
  const drag = sliding ? 0.1 : 0.25;
  car.speed -= car.speed * drag * dt;
  car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
  if (Math.abs(car.speed) < 0.05 && throttle === 0) car.speed = 0;
  const speedFactor = clamp(Math.abs(car.speed) / 12, 0, 1);
  const steerMult = sliding ? 1.8 : 1;
  car.heading += steer * CAR.turnRate * speedFactor * Math.sign(car.speed) * dt * steerMult * (grip / CAR.grip);
  if (sliding && steer !== 0) {
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
  const crashed = hit.x !== nx || hit.z !== nz;
  if (crashed) {
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

/** Traffic cruises its roads, turns around at the edge, respawns near the player. */
export function updateTraffic(dt, px, pz) {
  const half = 240;
  for (const car of traffic) {
    if (car.dead) continue;
    car.speed = car.cruise;
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
    if (Math.abs(car.x) > half - 8 || Math.abs(car.z) > half - 8) {
      car.heading += Math.PI;
      car.x = clamp(car.x, -(half - 10), half - 10);
      car.z = clamp(car.z, -(half - 10), half - 10);
    }
    const dx = car.x - px;
    const dz = car.z - pz;
    if (dx * dx + dz * dz > 200 * 200) {
      const spot = randomRoadPoint(rng);
      const nx = clamp(px + (spot.x - px) * 0.5, -half + 20, half - 20);
      const nz = clamp(pz + (spot.z - pz) * 0.5, -half + 20, half - 20);
      car.x = nx;
      car.z = nz;
      car.heading = spot.axis === 'x'
        ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2)
        : (rng() < 0.5 ? 0 : Math.PI);
    }
    syncMesh(car);
  }
}

/** The nearest live traffic car within range of a point, skipping one car. */
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

/** Take a car off the street entirely. */
export function removeCar(car) {
  sceneRef.remove(car.mesh);
  const i = traffic.indexOf(car);
  if (i !== -1) traffic.splice(i, 1);
}

/** Blow a car up: it tips over, lifts, and flashes orange for 450 ms. */
export function explodeCar(car) {
  car.dead = true;
  car.mesh.rotation.z = 0.5;
  car.mesh.position.y = 0.4;
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.75 }),
  );
  flash.position.copy(car.mesh.position);
  flash.position.y = 1;
  sceneRef.add(flash);
  setTimeout(() => sceneRef.remove(flash), 450);
}
