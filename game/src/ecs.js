// Palmetto Heat — a tiny entity-component-system.
// The older modules each own their objects; new effects go through this
// instead: an entity is an id, components are plain data in maps, systems
// are functions over component queries. First landing: the particle system
// (tyre smoke, muzzle sparks, rain splashes) on one pooled THREE.Points,
// so a hundred puffs cost one draw call and zero allocation per frame.

import * as THREE from 'three';

let nextId = 1;
const entities = new Set();
const components = new Map(); // name -> Map<id, data>

export function createEntity() {
  const id = nextId++;
  entities.add(id);
  return id;
}

export function destroyEntity(id) {
  entities.delete(id);
  for (const m of components.values()) m.delete(id);
}

export function addComponent(id, name, data) {
  if (!components.has(name)) components.set(name, new Map());
  components.get(name).set(id, data);
  return data;
}

export function getComponent(id, name) {
  return components.get(name)?.get(id);
}

export function removeComponent(id, name) {
  components.get(name)?.delete(id);
}

// Every entity that carries all of the named components.
export function query(...names) {
  const out = [];
  for (const id of entities) {
    let ok = true;
    for (const n of names) {
      if (!components.get(n)?.has(id)) { ok = false; break; }
    }
    if (ok) out.push(id);
  }
  return out;
}

// ---- particle system -------------------------------------------------------
const MAX_PARTICLES = 512;
const KIND_SMOKE = 0;
const KIND_SPARK = 1;
const KIND_SPLASH = 2;

let pool = null;

export function initParticles(scene) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX_PARTICLES * 3);
  const col = new Float32Array(MAX_PARTICLES * 3);
  for (let i = 0; i < MAX_PARTICLES; i++) pos[i * 3 + 1] = -999;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.9, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  points.frustumCulled = false;
  scene.add(points);
  pool = {
    points,
    pos,
    col,
    baseCol: new Float32Array(MAX_PARTICLES * 3),
    vel: new Float32Array(MAX_PARTICLES * 3),
    life: new Float32Array(MAX_PARTICLES),
    maxLife: new Float32Array(MAX_PARTICLES),
    kind: new Uint8Array(MAX_PARTICLES),
    cursor: 0,
  };
}

function emit(x, y, z, vx, vy, vz, life, kind, r, g, b) {
  if (!pool) return;
  const i = pool.cursor;
  pool.cursor = (pool.cursor + 1) % MAX_PARTICLES;
  pool.pos[i * 3] = x;
  pool.pos[i * 3 + 1] = y;
  pool.pos[i * 3 + 2] = z;
  pool.vel[i * 3] = vx;
  pool.vel[i * 3 + 1] = vy;
  pool.vel[i * 3 + 2] = vz;
  pool.life[i] = life;
  pool.maxLife[i] = life;
  pool.kind[i] = kind;
  pool.baseCol[i * 3] = r;
  pool.baseCol[i * 3 + 1] = g;
  pool.baseCol[i * 3 + 2] = b;
}

// Grey puffs that rise and spread: tyre smoke from a drift.
export function spawnSmoke(x, y, z, strength = 1) {
  const n = Math.max(1, Math.round(2 * strength));
  for (let k = 0; k < n; k++) {
    emit(
      x + (Math.random() - 0.5) * 0.6, y + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 1.4, 0.8 + Math.random() * 0.9, (Math.random() - 0.5) * 1.4,
      0.6 + Math.random() * 0.4, KIND_SMOKE, 0.62, 0.62, 0.62,
    );
  }
}

// Fast orange flecks: a gunshot hitting metal or a cop car sparking.
export function spawnSparks(x, y, z) {
  for (let k = 0; k < 6; k++) {
    emit(
      x, y, z,
      (Math.random() - 0.5) * 9, 1 + Math.random() * 4, (Math.random() - 0.5) * 9,
      0.25 + Math.random() * 0.2, KIND_SPARK, 1.0, 0.72, 0.2,
    );
  }
}

// Pale blue drops kicked up where rain hits the road.
export function spawnSplash(x, y, z) {
  for (let k = 0; k < 3; k++) {
    emit(
      x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.5) * 2, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2,
      0.3 + Math.random() * 0.2, KIND_SPLASH, 0.75, 0.85, 0.95,
    );
  }
}

// The particle system: one pass over the pool, no allocation. Smoke rises
// and drags, sparks fall, splashes pop and die; every colour fades with
// remaining life so dead particles vanish instead of popping out.
export function runParticleSystem(dt) {
  if (!pool) return;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (pool.life[i] <= 0) continue;
    pool.life[i] -= dt;
    if (pool.life[i] <= 0) {
      pool.pos[i * 3 + 1] = -999;
      pool.col[i * 3] = 0;
      pool.col[i * 3 + 1] = 0;
      pool.col[i * 3 + 2] = 0;
      continue;
    }
    const k = pool.kind[i];
    if (k === KIND_SMOKE) {
      pool.vel[i * 3 + 1] += 0.5 * dt;
      pool.vel[i * 3] *= 0.985;
      pool.vel[i * 3 + 2] *= 0.985;
    } else {
      pool.vel[i * 3 + 1] -= 6 * dt;
    }
    pool.pos[i * 3] += pool.vel[i * 3] * dt;
    pool.pos[i * 3 + 1] += pool.vel[i * 3 + 1] * dt;
    pool.pos[i * 3 + 2] += pool.vel[i * 3 + 2] * dt;
    const f = pool.life[i] / pool.maxLife[i];
    pool.col[i * 3] = pool.baseCol[i * 3] * f;
    pool.col[i * 3 + 1] = pool.baseCol[i * 3 + 1] * f;
    pool.col[i * 3 + 2] = pool.baseCol[i * 3 + 2] * f;
  }
  pool.points.geometry.attributes.position.needsUpdate = true;
  pool.points.geometry.attributes.color.needsUpdate = true;
}
