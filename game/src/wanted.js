// Palmetto Heat — wanted level, 0 to 5 stars.
// Crimes add heat; quiet time decays it. Listeners (HUD, cops) subscribe to
// level changes. The rules live in config.js; this module only keeps score.
// Round 4: reckless driving (a drift or a horn blast in a cop's face) adds its own star.
// New in this round: reckless driving counts too — drifting past a cop car
// or leaning on the horn in their face adds a star of its own.

import { WANTED_RULES, clamp } from './config.js';

let stars = 0;
let quietTimer = 0;
let listeners = [];

export function initWanted() {
  stars = 0;
  quietTimer = 0;
  listeners = [];
}

export function getStars() { return stars; }

export function isWanted() { return stars > 0; }

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

// Call every frame: while the player stays clean, stars bleed away.
export function updateWanted(dt, committingCrime) {
  if (committingCrime) {
    quietTimer = 0;
    return;
  }
  if (stars === 0) return;
  quietTimer += dt;
  if (quietTimer >= WANTED_RULES.decaySeconds) {
    setStars(stars - 1);
  }
}

export function clearWanted() { setStars(0); }
