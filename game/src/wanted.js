// Wanted level, 0 to 5 stars. Crimes add heat; quiet time decays it.
// Round 5: decay only starts after 8 straight seconds with no cop seeing
// you — that is the lose-the-heat game. While you are unseen and wanted,
// the stars flash blue. Listeners (HUD, cops) subscribe to level changes.
import { WANTED_RULES, clamp } from './config.js';

let stars = 0;
let quietTimer = 0;
let listeners = [];
let evading = false;

export function initWanted() {
  stars = 0;
  quietTimer = 0;
  listeners = [];
  evading = false;
}

export function getStars() { return stars; }
export function isWanted() { return stars > 0; }
export function isEvading() { return evading; }
export function onWantedChange(fn) { listeners.push(fn); }

function setStars(n) {
  const next = clamp(Math.round(n), 0, WANTED_RULES.maxStars);
  if (next === stars) return;
  stars = next;
  quietTimer = 0;
  for (const fn of listeners) {
    try { fn(stars); } catch { /* a listener must never break the game */ }
  }
}

export function addHeat(amount) {
  if (amount <= 0) return;
  setStars(stars + amount);
}

export function addCrime(kind) {
  const table = {
    steal: WANTED_RULES.stealCar,
    shoot: WANTED_RULES.shoot,
    hurtPed: WANTED_RULES.hurtPed,
    killPed: WANTED_RULES.killPed,
    ramCop: WANTED_RULES.ramCop,
    reckless: WANTED_RULES.reckless,
  };
  addHeat(table[kind] ?? 1);
}

export function forceStars(n) { setStars(n); }

// Call every frame. `seen` is true while any cop has eyes on the player.
// Unseen for loseSightSeconds straight and one star drops, then the count
// restarts — staying hidden is how you shake the heat.
export function updateWanted(dt, committingCrime, seen = false) {
  evading = stars > 0 && !seen && !committingCrime;
  if (committingCrime || seen) {
    quietTimer = 0;
    return;
  }
  if (stars === 0) return;
  quietTimer += dt;
  if (quietTimer >= WANTED_RULES.loseSightSeconds) {
    quietTimer = 0;
    setStars(stars - 1);
  }
}

export function clearWanted() { setStars(0); }
