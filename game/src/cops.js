// Police: spawn on the roads, chase by heading, ram at speed, and call the
// helicopter at five stars. Round 5: no more spawning inside buildings,
// blocked cops route along the street grid, shots need a line of sight,
// 3+ stars buys a roadblock every 22 s, 4 stars adds two flankers from
// ahead, sitting next to a cop in a car for 2 s gets you arrested, and the
// helicopter spotlight never leaves the player.
import * as THREE from 'three';
import { PALETTE, WANTED_RULES, clamp } from './config.js';
import { createCar } from './vehicles.js';
import { resolveCircleCollision, snapToRoad, hasLineOfSight } from './city.js';

const cops = [];
let sceneRef = null;
let heli = null;
let heliCone = null;
let heliSpot = null;
let heliAngle = 0;
let spawnCooldown = 0;
let flankCooldown = 0;
let roadblockTimer = 0;
let nightMode = false;

export function initCops(scene) {
  sceneRef = scene;
  cops.length = 0;
  spawnCooldown = 0;
  flankCooldown = 8;
  roadblockTimer = WANTED_RULES.roadblockEvery;
  if (heli) { scene.remove(heli); heli = null; heliCone = null; }
  if (heliSpot) { scene.remove(heliSpot); heliSpot = null; }
}

export function setNightMode(on) {
  nightMode = on;
  if (heliCone) heliCone.visible = on;
}

function wantedToCount(stars) {
  if (stars <= 0) return 0;
  return Math.min(1 + stars, 6);
}

// Round 5: cops spawn on a road near the player, never inside a building.
function spawnCopNear(px, pz, angle, dist = 0) {
  const r = dist || 55 + Math.random() * 25;
  const p = snapToRoad(px + Math.cos(angle) * r, pz + Math.sin(angle) * r);
  const car = createCar(PALETTE.copCar, p.x, p.z, Math.atan2(px - p.x, pz - p.z), true);
  car.cruise = 0;
  car.hp = 60;
  car.alertX = null;
  car.alertZ = null;
  car.alertUntil = 0;
  car.arrestTimer = 0;
  car.roadblock = false;
  car.roadblockUntil = 0;
  cops.push(car);
  return car;
}

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

// Round 5: any cop within 70 m with a clear line of sight counts as seen.
export function anyCopSees(player) {
  for (const cop of cops) {
    if (cop.dead) continue;
    const dx = cop.x - player.x, dz = cop.z - player.z;
    if (dx * dx + dz * dz > 70 * 70) continue;
    if (hasLineOfSight(cop.x, cop.z, player.x, player.z)) return true;
  }
  return false;
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
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(7, 30, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff2cc, transparent: true, opacity: 0.14,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  cone.position.y = -16;
  cone.rotation.x = Math.PI;
  cone.visible = nightMode;
  g.add(cone);
  heliCone = cone;
  return g;
}

// Round 5: two cop cars parked across the intersection ahead of the player.
function placeRoadblock(player, lifetimeSeconds = WANTED_RULES.roadblockLifetime) {
  const ahead = 70;
  const hx = Math.sin(player.heading || 0), hz = Math.cos(player.heading || 0);
  const cx = player.x + hx * ahead, cz = player.z + hz * ahead;
  const s = snapToRoad(cx, cz);
  const ix = Math.round(s.x / 40) * 40, iz = Math.round(s.z / 40) * 40;
  const alongX = s.axis === 'x';
  const now = performance.now();
  for (const off of [-4, 4]) {
    const x = alongX ? ix + off * 0 : ix + off;
    const z = alongX ? iz + off : iz;
    const car = createCar(PALETTE.copCar, alongX ? ix : x, alongX ? z : iz, alongX ? 0 : Math.PI / 2, true);
    car.cruise = 0;
    car.hp = 60;
    car.alertX = null; car.alertZ = null; car.alertUntil = 0;
    car.arrestTimer = 0;
    car.roadblock = true;
    car.roadblockUntil = now + lifetimeSeconds * 1000;
    // Staging hook: a roadblock car sits across the road, lights flashing.
    car.mesh.rotation.y = alongX ? Math.PI / 2 : 0;
    cops.push(car);
  }
}

// Staging helper for the dossier chase shots: a roadblock in the intersection
// ahead of the player plus two flankers coming head-on, with a long lifetime
// so the slow screenshot render still catches them in frame.
export function stageChase(player) {
  placeRoadblock(player, 600);
  const hx = Math.sin(player.heading || 0), hz = Math.cos(player.heading || 0);
  spawnCopNear(player.x + hx * 60, player.z + hz * 60, Math.random() * Math.PI * 2, 12);
  spawnCopNear(player.x + hx * 70, player.z + hz * 70, Math.random() * Math.PI * 2, 12);
}

export function updateCops(dt, stars, player, onArrest, onCopShot) {
  spawnCooldown -= dt;
  flankCooldown -= dt;
  const want = wantedToCount(stars);
  const patrol = cops.filter((c) => !c.roadblock).length;
  if (patrol < want && spawnCooldown <= 0) {
    spawnCopNear(player.x, player.z, Math.random() * Math.PI * 2);
    spawnCooldown = 2.5;
  }
  if (patrol > want) {
    const i = cops.findIndex((c) => !c.roadblock && !c.dead);
    if (i !== -1) { sceneRef.remove(cops[i].mesh); cops.splice(i, 1); }
  }
  // Round 5: 4 stars sends two extra units in from ahead to cut you off.
  if (stars >= 4 && flankCooldown <= 0) {
    const hx = Math.sin(player.heading || 0), hz = Math.cos(player.heading || 0);
    spawnCopNear(player.x + hx * 60, player.z + hz * 60, Math.random() * Math.PI * 2, 12);
    spawnCopNear(player.x + hx * 70, player.z + hz * 70, Math.random() * Math.PI * 2, 12);
    flankCooldown = 25;
  }
  // Round 5: a roadblock every 22 s at 3+ stars; each lasts 40 s.
  if (stars >= 3) {
    roadblockTimer -= dt;
    if (roadblockTimer <= 0) {
      placeRoadblock(player);
      roadblockTimer = WANTED_RULES.roadblockEvery;
    }
  } else {
    roadblockTimer = WANTED_RULES.roadblockEvery;
  }
  const now = performance.now();
  for (let i = cops.length - 1; i >= 0; i--) {
    const c = cops[i];
    if (c.roadblock && now >= c.roadblockUntil) {
      sceneRef.remove(c.mesh);
      cops.splice(i, 1);
    }
  }

  if (stars >= WANTED_RULES.heliAtStars && !heli) {
    heli = buildHeli();
    sceneRef.add(heli);
    heliSpot = new THREE.Mesh(
      new THREE.CircleGeometry(9, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff2cc, transparent: true, opacity: 0.13, depthWrite: false }),
    );
    heliSpot.rotation.x = -Math.PI / 2;
    heliSpot.position.y = 0.06;
    sceneRef.add(heliSpot);
  } else if (stars < WANTED_RULES.heliAtStars && heli) {
    sceneRef.remove(heli);
    heli = null;
    heliCone = null;
    if (heliSpot) { sceneRef.remove(heliSpot); heliSpot = null; }
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
    // Round 5: the spotlight stays glued to the player, day or night.
    if (heliSpot) heliSpot.position.set(player.x, 0.06, player.z);
  }

  for (const cop of cops) {
    if (cop.dead) continue;
    if (cop.roadblock) continue; // parked across the road, lights flashing
    const hasAlert = cop.alertUntil > performance.now() && cop.alertX !== null;
    let tx = hasAlert ? cop.alertX : player.x;
    let tz = hasAlert ? cop.alertZ : player.z;
    // Round 5: no line of sight means no straight-line chase — route along
    // the street grid instead of driving through buildings.
    if (!hasAlert && !hasLineOfSight(cop.x, cop.z, player.x, player.z)) {
      const s = snapToRoad(cop.x, cop.z);
      const onRoad = s.axis === 'x' ? Math.abs(cop.z - s.z) < 3 : Math.abs(cop.x - s.x) < 3;
      if (!onRoad) { tx = s.x; tz = s.z; }
      else if (s.axis === 'x') { tx = cop.x + Math.sign(player.x - cop.x) * 20; tz = s.z; }
      else { tx = s.x; tz = cop.z + Math.sign(player.z - cop.z) * 20; }
    }
    const dx = tx - cop.x;
    const dz = tz - cop.z;
    const dist = Math.hypot(player.x - cop.x, player.z - cop.z) || 1;
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

    // Arrest on foot: slow, and a cop right on top of them.
    if (!player.inCar && dist < 2.6 && Math.abs(player.speed || 0) < 2.5) {
      onArrest();
    }
    // Round 5: stopped in a car next to a cop for 2 s and you are pulled over.
    if (player.inCar && dist < 3.5 && Math.abs(player.speed || 0) < 1) {
      cop.arrestTimer += dt;
      if (cop.arrestTimer >= 2) onArrest('Pulled over at the roadside');
    } else {
      cop.arrestTimer = 0;
    }
    // Shooting at 3+ stars, only with a line of sight.
    if (stars >= WANTED_RULES.copShootAtStars && dist < 55 && hasLineOfSight(cop.x, cop.z, player.x, player.z)) {
      cop.shotTimer = (cop.shotTimer ?? 0.6) - dt;
      if (cop.shotTimer <= 0) {
        cop.shotTimer = 0.9 + Math.random() * 0.7;
        onCopShot(dist);
      }
    }
  }
}

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
  if (heli) { sceneRef.remove(heli); heli = null; heliCone = null; }
  if (heliSpot) { sceneRef.remove(heliSpot); heliSpot = null; }
}
