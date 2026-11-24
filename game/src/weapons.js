// Round 5 weapons: pistol / SMG / shotgun, magazines, reserves, reloads, aim assist.
// Pistol from the start; SMG unlocks after 3 missions, shotgun after 4.
import { WEAPONS } from './config.js';

let current = 0;
let mags = [];
let reserves = [];
let reloading = false;
let reloadEndsAt = 0;
let unlockedCache = 0;

export function initWeapons(completedCount = 0) {
  current = 0;
  mags = WEAPONS.map((w) => w.mag);
  reserves = WEAPONS.map((w) => w.reserveMax);
  reloading = false;
  reloadEndsAt = 0;
  unlockedCache = completedCount;
}

export function weaponUnlocked(idx, completedCount) {
  return completedCount >= WEAPONS[idx].unlockMissions;
}

export function currentWeapon() { return WEAPONS[current]; }
export function currentWeaponIndex() { return current; }
export function currentMag() { return mags[current]; }
export function currentReserve() { return reserves[current]; }
export function isReloading() { return reloading; }

// Switch to a slot the player has unlocked; returns the weapon or null.
export function switchWeapon(idx, completedCount) {
  if (idx < 0 || idx >= WEAPONS.length) return null;
  if (!weaponUnlocked(idx, completedCount)) return null;
  if (idx === current) return WEAPONS[current];
  current = idx;
  reloading = false;
  return WEAPONS[current];
}

// True when the trigger may fire right now (ammo in the mag, not reloading).
export function canFire(now) {
  if (reloading && now >= reloadEndsAt) finishReload();
  return !reloading && mags[current] > 0;
}

export function consumeShot() {
  if (mags[current] > 0) mags[current] -= 1;
}

export function startReload(now) {
  if (reloading) return false;
  const w = WEAPONS[current];
  if (mags[current] >= w.mag || reserves[current] <= 0) return false;
  reloading = true;
  reloadEndsAt = now + w.reloadTime;
  return true;
}

function finishReload() {
  reloading = false;
  const w = WEAPONS[current];
  const need = w.mag - mags[current];
  const take = Math.min(need, reserves[current]);
  mags[current] += take;
  reserves[current] -= take;
}

export function updateWeapons(now) {
  if (reloading && now >= reloadEndsAt) finishReload();
}

// A pickup (or a fresh start) tops every reserve back up.
export function refillAmmo() {
  for (let i = 0; i < WEAPONS.length; i++) reserves[i] = WEAPONS[i].reserveMax;
}

export function addReserve(idx, amount) {
  if (idx < 0 || idx >= WEAPONS.length) return;
  reserves[idx] = Math.min(WEAPONS[idx].reserveMax, reserves[idx] + amount);
}

// Save / load: mags + reserves ride in the save file so a reload keeps them.
export function serializeWeapons() {
  return { current, mags: mags.slice(), reserves: reserves.slice() };
}

export function deserializeWeapons(data) {
  if (!data) return;
  if (Array.isArray(data.mags)) {
    for (let i = 0; i < WEAPONS.length; i++) {
      if (Number.isFinite(data.mags[i])) mags[i] = Math.max(0, Math.min(WEAPONS[i].mag, data.mags[i]));
    }
  }
  if (Array.isArray(data.reserves)) {
    for (let i = 0; i < WEAPONS.length; i++) {
      if (Number.isFinite(data.reserves[i])) reserves[i] = Math.max(0, Math.min(WEAPONS[i].reserveMax, data.reserves[i]));
    }
  }
  if (Number.isInteger(data.current) && data.current >= 0 && data.current < WEAPONS.length) {
    current = data.current;
  }
  reloading = false;
}

// Aim assist: from a chest-high origin along `forward`, pick the nearest
// target inside a 12-degree cone and bend the shot toward it. The old code
// fired from the camera centre, so the ray crossed the player and dug into
// the ground; firing from the chest with a gentle correction fixes the aim.
export function aimAssist(origin, forward, targets) {
  const maxCos = Math.cos((12 * Math.PI) / 180);
  let best = null;
  let bestCos = maxCos;
  for (const t of targets) {
    const dx = t.x - origin.x;
    const dy = (t.y ?? 1.2) - origin.y;
    const dz = t.z - origin.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.001) continue;
    const cos = (dx * forward.x + dy * forward.y + dz * forward.z) / len;
    if (cos > bestCos) {
      bestCos = cos;
      best = { x: dx / len, y: dy / len, z: dz / len, dist: len };
    }
  }
  if (!best) return { x: forward.x, y: forward.y, z: forward.z };
  // Blend toward the target: close targets get a full correction, far ones a nudge.
  const w = Math.min(1, (bestCos - maxCos) / (1 - maxCos) + 0.35);
  const k = Math.min(1, w);
  return {
    x: forward.x + (best.x - forward.x) * k,
    y: forward.y + (best.y - forward.y) * k,
    z: forward.z + (best.z - forward.z) * k,
  };
}
