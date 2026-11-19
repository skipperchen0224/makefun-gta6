// Palmetto Heat — global tuning and mission table.
// One place for every number a designer would tweak: world size, car feel,
// wanted rules, payouts and the six story missions Mama Rosa hands out.

export const WORLD = {
  size: 480,          // playable square, metres, centred on (0, 0)
  block: 40,          // city block pitch; roads run every `block` metres
  roadWidth: 10,
  buildingGap: 3,
};

export const PLAYER = {
  hp: 100,
  walkSpeed: 7,
  runSpeed: 11,
  radius: 0.7,
};

export const CAR = {
  accel: 22,          // m/s^2 at full throttle
  reverseAccel: 12,
  maxSpeed: 42,       // ~150 km/h
  maxReverse: 10,
  brake: 34,
  turnRate: 1.9,      // rad/s at full lock, scaled by speed
  grip: 3.2,          // lateral damping
  handbrakeGrip: 0.9,
  radius: 2.2,
};

export const WANTED_RULES = {
  maxStars: 5,
  decaySeconds: 15,   // quiet time before one star drops
  stealCar: 1,
  shoot: 1,
  hurtPed: 1,
  killPed: 2,
  ramCop: 2,
  copShootAtStars: 3, // cops open fire at 3+ stars
  heliAtStars: 5,
};

export const ECONOMY = {
  startCash: 500,
  missionReward: [400, 600, 800, 900, 1000, 2500],
};

// Six story missions. `kind` drives the state machine in missions.js;
// `place` is a named map spot resolved by city.js; `timeLimit` is seconds (0 = none).
export const MISSIONS = [
  { id: 1, name: 'First Pickup', kind: 'goto', place: 'diner', blurb: 'Mama Rosa needs a package from the diner. Drive there.', timeLimit: 0 },
  { id: 2, name: 'Courier Run', kind: 'timed', place: 'pier', blurb: 'Deliver the package to the pier before the clock runs out.', timeLimit: 75 },
  { id: 3, name: 'Tail the Courier', kind: 'tail', place: 'downtown', blurb: 'Stay on the courier’s tail until he cracks.', timeLimit: 90 },
  { id: 4, name: 'Lose the Heat', kind: 'escape', place: 'safehouse', blurb: 'Three stars on you. Shake the cops, then reach the safehouse.', timeLimit: 120 },
  { id: 5, name: 'Street Sweep', kind: 'shoot', place: 'alley', blurb: 'Five of the rival crew are in the alley. Clear them out, on foot.', timeLimit: 0 },
  { id: 6, name: 'The Big Getaway', kind: 'getaway', place: 'safehouse', blurb: 'Five stars, one car, one safehouse. Survive the ride home.', timeLimit: 150 },
];

export const PLACES = {
  diner: { x: -100, z: -60, label: 'Mama Rosa’s Diner' },
  pier: { x: 180, z: 160, label: 'Palmetto Pier' },
  downtown: { x: 60, z: -100, label: 'Downtown' },
  safehouse: { x: -160, z: 140, label: 'Safehouse' },
  alley: { x: 20, z: 100, label: 'The Alley' },
  spawn: { x: 0, z: 100, label: 'Spawn' },
};

export const KEYS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  brake: 'Space',
  enterCar: 'KeyF',
  shoot: 'Mouse0',
  sprint: 'ShiftLeft',
  restart: 'KeyR',
};

// Sun-soaked Palmetto City palette: warm plaster, teal sea air, hot asphalt.
export const PALETTE = {
  sky: 0x8ec9e8,
  fog: 0xa8d4e6,
  ground: 0x9aa578,
  road: 0x3a3f46,
  roadLine: 0xf5d76e,
  sidewalk: 0xb9b3a4,
  building: [0xe8b48c, 0xd9a0a0, 0xf2d5a0, 0xa8c8b8, 0xc9b8d9, 0xe8e0cc, 0x9fc3d9],
  windowLit: 0xffe9a8,
  windowDark: 0x2c3e50,
  palmTrunk: 0x8a6b4a,
  palmLeaf: 0x3f8f4f,
  playerCar: 0xff7a1a,
  trafficCar: [0x3f6fb5, 0xc23b2e, 0xe8e8e8, 0x2e8b6a, 0x7a5fc0, 0xd9a441],
  copCar: 0x1c2733,
  copLight: [0xff2222, 0x2244ff],
};

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }

// Deterministic RNG so screenshots are reproducible: seed comes from ?seed=.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
