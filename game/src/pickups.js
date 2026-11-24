// Round 5 pickups: 16 fixed street-corner caches (health / armour / ammo /
// cash), enemy drops, and cop-car armour drops. Caches respawn after 45 s;
// drops vanish after 30 s. This is the combat resource loop.
import * as THREE from 'three';
import { PICKUPS, mulberry32 } from './config.js';
import { snapToRoad } from './city.js';

const KINDS = {
  health: { color: 0x37c978, label: 'Health +40' },
  armor: { color: 0x4da3ff, label: 'Armour +50' },
  ammo: { color: 0xffd34d, label: 'Ammo refilled' },
  cash: { color: 0x7ee787, label: 'Cash +$150' },
};

const pickups = [];
let sceneRef = null;
let rng = mulberry32(11);

function makeMesh(kind) {
  const g = new THREE.Group();
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55),
    new THREE.MeshLambertMaterial({ color: KINDS[kind].color, emissive: KINDS[kind].color, emissiveIntensity: 0.45 }),
  );
  gem.position.y = 1.1;
  g.add(gem);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.95, 24),
    new THREE.MeshBasicMaterial({ color: KINDS[kind].color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  g.add(ring);
  g.userData.gem = gem;
  return g;
}

export function initPickups(scene, seed = 11) {
  sceneRef = scene;
  rng = mulberry32(seed);
  for (const p of pickups) sceneRef.remove(p.mesh);
  pickups.length = 0;
  spawnFixedPickups();
}

function addPickup(x, z, kind, fixed) {
  const mesh = makeMesh(kind);
  mesh.position.set(x, 0, z);
  sceneRef.add(mesh);
  const p = { mesh, x, z, kind, fixed: !!fixed, respawnAt: 0, despawnAt: fixed ? 0 : performance.now() / 1000 + PICKUPS.dropLifetime };
  pickups.push(p);
  return p;
}

function spawnFixedPickups() {
  const kinds = Object.keys(KINDS);
  for (let i = 0; i < PICKUPS.fixedCount; i++) {
    const snapped = snapToRoad((rng() * 2 - 1) * 200, (rng() * 2 - 1) * 200);
    const off = (rng() < 0.5 ? -1 : 1) * 8;
    const x = snapped.axis === 'x' ? snapped.x + (rng() * 2 - 1) * 40 : snapped.x + off;
    const z = snapped.axis === 'z' ? snapped.z + (rng() * 2 - 1) * 40 : snapped.z + off;
    addPickup(x, z, kinds[i % kinds.length], true);
  }
}

// A downed enemy drops ammo or cash; a blown cop car drops armour.
export function dropPickup(x, z, kind) {
  if (!KINDS[kind]) kind = 'cash';
  return addPickup(x, z, kind, false);
}

export function getPickups() { return pickups; }

// Walk over a cache to take it; fixed ones come back after 45 s.
export function updatePickups(dt, px, pz, onTake) {
  const now = performance.now() / 1000;
  for (const p of pickups) {
    if (!p.mesh.visible) {
      if (p.fixed && p.respawnAt > 0 && now >= p.respawnAt) {
        p.mesh.visible = true;
        p.respawnAt = 0;
      }
      continue;
    }
    if (!p.fixed && p.despawnAt > 0 && now >= p.despawnAt) {
      p.mesh.visible = false;
      continue;
    }
    p.mesh.userData.gem.rotation.y += dt * 2;
    p.mesh.userData.gem.position.y = 1.1 + Math.sin(now * 2 + p.x) * 0.15;
    const dx = p.x - px;
    const dz = p.z - pz;
    if (dx * dx + dz * dz < 2.2 * 2.2) {
      p.mesh.visible = false;
      if (p.fixed) p.respawnAt = now + PICKUPS.respawnSeconds;
      if (onTake) onTake(p.kind, p);
    }
  }
}

export function pickupLabel(kind) { return KINDS[kind]?.label || kind; }
