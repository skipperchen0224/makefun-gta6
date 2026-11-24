// Round 5 weapons: pistol, SMG and shotgun, each with a magazine, a reserve and a reload.
// Keys 1/2/3 pick a gun, R reloads, an empty trigger reloads on its own. The SMG unlocks
// after three of Mama Rosa's jobs and the shotgun after four, so the arsenal grows with the story.

export const WEAPONS = [
  { id: 'pistol', name: 'Pistol', key: 'Digit1', damage: 34, cooldown: 0.28, mag: 12, reserve: 72, pellets: 1, spread: 0.006, range: 90, unlock: 0, auto: false },
  { id: 'smg', name: 'SMG', key: 'Digit2', damage: 17, cooldown: 0.085, mag: 30, reserve: 150, pellets: 1, spread: 0.028, range: 70, unlock: 3, auto: true },
  { id: 'shotgun', name: 'Shotgun', key: 'Digit3', damage: 22, cooldown: 0.8, mag: 6, reserve: 30, pellets: 6, spread: 0.075, range: 35, unlock: 4, auto: false },
];
const RELOAD_SECONDS = 1.3;

const ammo = {};
let current = 0;
let reloadLeft = 0;

export function initWeapons(saved) {
  for (const w of WEAPONS) {
    const s = saved && saved[w.id];
    ammo[w.id] = {
      mag: s ? Math.min(w.mag, Math.max(0, s.mag | 0)) : w.mag,
      reserve: s ? Math.max(0, s.reserve | 0) : w.reserve,
    };
  }
  current = 0;
  reloadLeft = 0;
}

export function currentWeapon() { return WEAPONS[current]; }
export function ammoOf(id) { return ammo[id]; }
export function isReloading() { return reloadLeft > 0; }
export function unlocked(w, completed) { return completed >= w.unlock; }

// Switch to weapon index i if the story has unlocked it. Returns the weapon or null.
export function selectWeapon(i, completed) {
  const w = WEAPONS[i];
  if (!w || !unlocked(w, completed)) return null;
  if (i !== current) reloadLeft = 0;
  current = i;
  return w;
}

export function startReload() {
  const w = WEAPONS[current];
  const a = ammo[w.id];
  if (reloadLeft > 0 || a.mag >= w.mag || a.reserve <= 0) return false;
  reloadLeft = RELOAD_SECONDS;
  return true;
}

export function updateWeapons(dt) {
  if (reloadLeft <= 0) return false;
  reloadLeft -= dt;
  if (reloadLeft > 0) return false;
  const w = WEAPONS[current];
  const a = ammo[w.id];
  const take = Math.min(w.mag - a.mag, a.reserve);
  a.mag += take;
  a.reserve -= take;
  return true;
}

// Spend one round. Returns false (and starts a reload) when the magazine is dry.
export function consumeRound() {
  const a = ammo[WEAPONS[current].id];
  if (reloadLeft > 0) return false;
  if (a.mag <= 0) { startReload(); return false; }
  a.mag -= 1;
  if (a.mag === 0) startReload();
  return true;
}

// An ammo pickup tops every gun's reserve back up to its starting stock.
export function restockAmmo() {
  for (const w of WEAPONS) ammo[w.id].reserve = Math.max(ammo[w.id].reserve, w.reserve);
}

export function ammoLabel() {
  const w = WEAPONS[current];
  const a = ammo[w.id];
  return `${w.name.toUpperCase()} ${a.mag}/${a.reserve}${reloadLeft > 0 ? ' · RELOADING' : ''}`;
}

export function ammoSnapshot() {
  const out = {};
  for (const w of WEAPONS) out[w.id] = { mag: ammo[w.id].mag, reserve: ammo[w.id].reserve };
  return out;
}
