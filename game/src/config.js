export const WORLD = {
  SIZE: 400,
  BLOCK: 40,
  ROAD_W: 10
};

export const COLORS = {
  GROUND: 0x181818,
  ROAD: 0x2b2b2b,
  SIDEWALK: 0x6e6e6e,
  BUILDING: 0x334455,
  BUILDING_ACCENT: 0x112233,
  WATER: 0x103050,
  PLAYER: 0x3366cc,
  COP: 0x112244,
  TRAFFIC: [0xcc2222, 0x22cc22, 0xcccc22, 0xcccccc, 0x2222cc],
  PED: 0x996633,
  BEACON: 0xffaa00,
  MARKER: 0x00ffff
};

export const TUNING = {
  PLAYER_SPEED: 5.5,
  PLAYER_SPRINT: 9.5,
  PLAYER_ACCEL: 12.0,
  GRAVITY: 25.0,
  JUMP_FORCE: 9.0,
  CAR_ACCEL: 18.0,
  CAR_MAX_SPEED: 35.0,
  CAR_BRAKE: 25.0,
  CAR_STEER: 2.2,
  COP_SPEED: 14.0,
  COP_CATCH_DIST: 2.5,
  HEALTH_MAX: 100
};

export const SAVE_KEY = 'palmetto_heat_save_v1';

export const MISSIONS = [
  {
    name: "Palmetto Promenade",
    stages: [
      { type: 'goto', x: 80, z: 80, radius: 6, seconds: 0, text: "Drive to the waterfront promenade." },
      { type: 'pickup', x: 120, z: 40, radius: 5, seconds: 0, text: "Collect the package from the contact." },
      { type: 'deliver', x: -100, z: -100, radius: 6, seconds: 0, text: "Deliver the package to the drop point." }
    ],
    reward: 1000
  },
  {
    name: "Heat Wave",
    stages: [
      { type: 'steal', x: -60, z: 120, radius: 8, seconds: 0, text: "Steal the marked sports car." },
      { type: 'follow', x: 0, z: 0, radius: 15, seconds: 60, text: "Tail the informant without getting too close or losing them." },
      { type: 'goto', x: 150, z: -150, radius: 8, seconds: 0, text: "Escape to the safehouse." }
    ],
    reward: 2500
  },
  {
    name: "Downtown Dash",
    stages: [
      { type: 'race', x: -140, z: -140, radius: 7, seconds: 45, text: "Checkpoint 1: Reach the financial district." },
      { type: 'race', x: 140, z: -140, radius: 7, seconds: 30, text: "Checkpoint 2: Speed through the neon strip." },
      { type: 'race', x: 0, z: 160, radius: 7, seconds: 30, text: "Finish: Cross the finish line at the pier." }
    ],
    reward: 4000
  },
  {
    name: "Bayside Blues",
    stages: [
      { type: 'goto', x: -120, z: 40, radius: 6, seconds: 0, text: "Investigate the abandoned warehouse." },
      { type: 'evade', x: 0, z: 0, radius: 0, seconds: 45, text: "Lose the police pursuit!" },
      { type: 'deliver', x: 100, z: 100, radius: 6, seconds: 0, text: "Return the stolen asset to the bay." }
    ],
    reward: 6000
  },
  {
    name: "Under Pressure",
    stages: [
      { type: 'pickup', x: 60, z: -80, radius: 5, seconds: 40, text: "Grab the briefcase before time runs out." },
      { type: 'evade', x: 0, z: 0, radius: 0, seconds: 60, text: "Shake the heat completely." },
      { type: 'deliver', x: -150, z: 150, radius: 8, seconds: 0, text: "Deliver to the boss at the marina." }
    ],
    reward: 8500
  },
  {
    name: "Palmetto Heat",
    stages: [
      { type: 'goto', x: 0, z: 0, radius: 10, seconds: 0, text: "Head to City Hall for the final showdown." },
      { type: 'steal', x: -80, z: -80, radius: 8, seconds: 0, text: "Hijack the chief's cruiser." },
      { type: 'evade', x: 0, z: 0, radius: 0, seconds: 90, text: "Survive the ultimate lockdown and escape the city!" }
    ],
    reward: 15000
  }
];
