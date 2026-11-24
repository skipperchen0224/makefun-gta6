// 车辆的建造、驾驶、偷车、撞车；街机物理是有意的——油门、按速度缩放的转向、手刹漂移、经由 city.js 的建筑碰撞、交通车沿道路线走、绝不穿楼。
import * as THREE from 'three';
import { CAR, DRIFT, PALETTE, TRAFFIC, WORLD, clamp, mulberry32 } from './config.js';
import { resolveCircleCollision, randomRoadPoint, snapToRoad } from './city.js';

let sceneRef = null;
let rng = mulberry32(1);
export const traffic = [];

// One shared material per lamp, so night mode flips every car at once.
const headlightMat = new THREE.MeshLambertMaterial({
  color: 0xffe9a8, emissive: 0xffe9a8, emissiveIntensity: 0,
});
const taillightMat = new THREE.MeshLambertMaterial({
  color: 0x8b1a1a, emissive: 0xff2222, emissiveIntensity: 0,
});

export function setNightMode(on) {
  headlightMat.emissiveIntensity = on ? 1 : 0;
  taillightMat.emissiveIntensity = on ? 1 : 0;
}

function buildCarMesh(color, isCop) {
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const glass = new THREE.MeshLambertMaterial({ color: 0x8fb8d9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.62, 4.4), paint);
  body.position.y = 0.62;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.2), glass);
  cabin.position.set(0, 1.18, -0.2);
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14181d });
  const wheels = [];
  for (const wx of [-0.95, 0.95]) {
    for (const wz of [-1.45, 1.45]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wx, 0.36, wz);
      g.add(wheel);
      wheels.push(wheel);
    }
  }
  for (const hx of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), headlightMat);
    head.position.set(hx, 0.66, 2.22);
    g.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), taillightMat);
    tail.position.set(hx, 0.66, -2.22);
    g.add(tail);
  }
  if (isCop) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.16, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    bar.position.y = 1.55;
    g.add(bar);
    const redMat = new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 1 });
    const blueMat = new THREE.MeshLambertMaterial({ color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 0.1 });
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42), redMat);
    red.position.set(-0.3, 1.55, 0);
    g.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.42), blueMat);
    blue.position.set(0.3, 1.55, 0);
    g.add(blue);
    g.userData.redLight = redMat;
    g.userData.blueLight = blueMat;
  }
  g.userData.wheels = wheels;
  return g;
}

export function createCar(color, x, z, heading = 0, isCop = false) {
  const mesh = buildCarMesh(color, isCop);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  mesh.traverse((o) => { o.castShadow = true; });
  sceneRef.add(mesh);
  return {
    mesh,
    x,
    z,
    heading,
    speed: 0,
    hp: 100,
    isCop,
    isPlayer: false,
    isTail: false,
    dead: false,
    wheelSpin: 0,
    drifting: false,
    driftScore: 0,
    lastBanked: 0,
    grip: CAR.grip,
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
    const p = randomRoadPoint(rng);
    const color = PALETTE.trafficCar[Math.floor(rng() * PALETTE.trafficCar.length)];
    const heading = p.axis === 'x'
      ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2)
      : (rng() < 0.5 ? 0 : Math.PI);
    const car = createCar(color, p.x, p.z, heading);
    car.cruise = 9 + rng() * 6;
    car.axis = p.axis;
    car.dir = heading === Math.PI / 2 || heading === 0 ? 1 : -1;
    car.line = p.axis === 'x' ? p.z : p.x;
    placeInLane(car);
    traffic.push(car);
  }
}

// Round 5 lanes: traffic keeps right, TRAFFIC.lane metres off the centre line.
// Road along x (axis 'x', z = line) or along z (axis 'z', x = line); dir is +1/-1.
function laneHeading(axis, dir) {
  if (axis === 'x') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

function placeInLane(car) {
  const off = TRAFFIC.lane * car.dir;
  if (car.axis === 'x') car.z = car.line + off;
  else car.x = car.line - off;
  car.heading = laneHeading(car.axis, car.dir);
  syncMesh(car);
}

function respawnNear(car, px, pz) {
  const a = rng() * Math.PI * 2;
  const r = 90 + rng() * 60;
  const half = WORLD.size / 2 - 20;
  const p = snapToRoad(clamp(px + Math.cos(a) * r, -half, half), clamp(pz + Math.sin(a) * r, -half, half));
  car.axis = p.axis;
  car.line = p.axis === 'x' ? p.z : p.x;
  car.x = p.x;
  car.z = p.z;
  car.dir = rng() < 0.5 ? 1 : -1;
  car.speed = car.cruise;
  placeInLane(car);
}

function syncMesh(car) {
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  car.wheelSpin += car.speed * 0.05;
  for (const wheel of car.mesh.userData.wheels || []) {
    wheel.rotation.x = car.wheelSpin;
  }
  if (car.isCop && car.mesh.userData.redLight) {
    const phase = Math.floor(performance.now() / 260) % 2 === 0;
    car.mesh.userData.redLight.emissiveIntensity = phase ? 1 : 0.1;
    car.mesh.userData.blueLight.emissiveIntensity = phase ? 0.1 : 1;
  }
}

export function driveCar(car, dt, throttle, steer, handbrake) {
  if (car.dead) return 0;
  if (throttle > 0) {
    car.speed += CAR.accel * dt;
  } else if (throttle < 0) {
    if (car.speed > 0) car.speed -= CAR.brake * dt;
    else car.speed -= CAR.reverseAccel * dt;
  }
  if (handbrake) {
    const dec = CAR.brake * 0.6 * dt;
    car.speed = Math.abs(car.speed) <= dec ? 0 : car.speed - Math.sign(car.speed) * dec;
  }
  const drifting = handbrake && Math.abs(car.speed) > DRIFT.minSpeed;
  const grip = car.grip || CAR.grip;
  const drag = drifting ? 0.1 : 0.25;
  car.speed -= car.speed * drag * dt;
  car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
  if (Math.abs(car.speed) < 0.05 && throttle === 0) car.speed = 0;
  const speedFactor = clamp(Math.abs(car.speed) / 12, 0, 1);
  const turnMult = drifting ? 1.8 : 1;
  car.heading += steer * CAR.turnRate * speedFactor * Math.sign(car.speed) * dt * turnMult * (grip / CAR.grip);
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
  const collided = hit.x !== nx || hit.z !== nz;
  car.x = hit.x;
  car.z = hit.z;
  if (collided) {
    car.speed *= -0.25;
    car.hp -= 4;
    if (car.drifting) {
      car.driftScore = 0;
      car.drifting = false;
    }
    if (car.hp <= 0) car.dead = true;
  }
  syncMesh(car);
  return Math.abs(car.speed) * dt;
}

// Traffic follows its lane, turns at intersections, brakes for whatever is ahead
// (the player, other cars, `obstacles` such as cops and roadblocks) and is recycled
// near the player once it drifts TRAFFIC.recycle metres away. Parked and stolen
// cars are skipped; the mission tail car drives the same lanes but is never recycled.
export function updateTraffic(dt, playerX, playerZ, obstacles = []) {
  const half = WORLD.size / 2 - 10;
  const B = WORLD.block;
  for (const car of traffic) {
    if (car.dead || car.isPlayer || car.parked) continue;
    if (car.line === undefined) {
      const p = snapToRoad(car.x, car.z);
      car.axis = p.axis;
      car.line = p.axis === 'x' ? p.z : p.x;
      car.dir = 1;
      placeInLane(car);
    }
    if (!car.isTail && Math.hypot(car.x - playerX, car.z - playerZ) > TRAFFIC.recycle) {
      respawnNear(car, playerX, playerZ);
      continue;
    }
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    let target = car.stunned > 0 ? 0 : car.cruise;
    car.stunned = Math.max(0, (car.stunned || 0) - dt);
    const check = (ox, oz) => {
      const dx = ox - car.x;
      const dz = oz - car.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > 14) return;
      if (Math.abs(dx * fz - dz * fx) < 2.4) target = Math.min(target, Math.max(0, (ahead - 5.5) * 1.6));
    };
    check(playerX, playerZ);
    for (const o of obstacles) check(o.x, o.z);
    for (const o of traffic) if (o !== car && !o.dead) check(o.x, o.z);
    car.speed += clamp(target - car.speed, -24 * dt, 7 * dt);

    const prev = car.axis === 'x' ? car.x : car.z;
    const next = prev + car.dir * car.speed * dt;
    if (car.axis === 'x') car.x = next;
    else car.z = next;
    const k = Math.floor(next / B);
    const crossed = Math.floor(prev / B) !== k ? (car.dir > 0 ? k * B : (k + 1) * B) : null;
    if (Math.abs(next) > half) {
      car.dir = -car.dir;
      if (car.axis === 'x') car.x = clamp(car.x, -half, half);
      else car.z = clamp(car.z, -half, half);
      placeInLane(car);
    } else if (crossed !== null && Math.abs(crossed) <= half - B && rng() < TRAFFIC.turnChance) {
      const cross = car.line;
      car.axis = car.axis === 'x' ? 'z' : 'x';
      car.line = crossed;
      car.dir = rng() < 0.5 ? 1 : -1;
      if (car.axis === 'x') car.x = cross;
      else car.z = cross;
      placeInLane(car);
    } else {
      syncMesh(car);
    }
  }
}

export function nearestCar(x, z, range, exclude) {
  let best = null;
  let bestD = range;
  for (const car of traffic) {
    if (car === exclude || car.dead) continue;
    const d = Math.hypot(car.x - x, car.z - z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

export function removeCar(car) {
  if (sceneRef) sceneRef.remove(car.mesh);
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
  flash.position.set(car.x, 1, car.z);
  sceneRef.add(flash);
  setTimeout(() => sceneRef.remove(flash), 450);
}
