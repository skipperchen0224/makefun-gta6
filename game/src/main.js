// Main game: scene, player, camera, combat and the loop that wires every module together.
// Stages the dossier shots via ?shot=start|play|combat|night|end; ?mp=1 joins the lobby.
import * as THREE from 'three';
import { PLAYER, CAR, DRIFT, ARMOR, WEATHER, PLACES, KEYS, PALETTE, TRAFFIC, POLICE, STORY, PICKUP_KINDS, clamp, mulberry32 } from './config.js';
import { initInput, justPressed, mouseClicked, mouseDown, driveAxes, walkAxes, takeLook, takeZoom, resetFrame } from './input.js';
import { initAudio, resumeAudio, playGunshot, playPickup, playMissionDone, playFail, playCrash, playBusted, playHorn, playSwap, playSkid, rainStart, rainStop, engineStart, engineSet, engineStop, sirenStart, sirenStop } from './audio.js';
import { loadSave, writeSave, clearSave } from './save.js';
import { WEAPONS, initWeapons, currentWeapon, selectWeapon, startReload, updateWeapons, consumeRound, restockAmmo, ammoLabel, ammoSnapshot, ammoOf } from './weapons.js';
import { initPickups, updatePickups, addPickup } from './pickups.js';
import { buildCity, setNightMode as setCityNight, updateCityVisibility, resolveCircleCollision, randomRoadPoint, segmentBlocked, glowMaterial } from './city.js';
import { initVehicles, spawnPlayerCar, spawnTraffic, createCar, driveCar, updateTraffic, nearestCar, explodeCar, setNightMode as setVehiclesNight, traffic } from './vehicles.js';
import { initPeds, spawnPeds, spawnHostileSquad, scarePeds, updatePeds, hitPed, getPeds, setRain } from './peds.js';
import { initWanted, getStars, onWantedChange, addCrime, forceStars, updateWanted, clearWanted, evadeProgress } from './wanted.js';
import { initCops, setNightMode as setCopsNight, updateCops, damageCop, getCops, clearCops, alertTo, getRoadblocks, spawnRoadblock, spawnIntercept } from './cops.js';
import { initMissions, onMissionEvent, nextMissionId, getActiveId, getSquadLeft, setSquadLeft, startMission, updateMissions, objectiveText, getMissionBrief, missionById } from './missions.js';
import { initHud, setCash, setHealth, setArmor, setStars, setMission, setSpeed, setHelp, setCharacter, setClock, setWeather, setDrift, setMp, showMessage, showBanner, showTitle, showEnd, hideEnd, drawMinimap, setEvading, setWeapon, setCarHealth, showStory, showPaused, setTitleSave } from './hud.js';
import { characterDef, otherCharacter, buildCharacterMesh } from './characters.js';
import { initWeather, setWeather as setWeatherKind, setHour, getWeather, isNight, getClockLabel, getWeatherLabel, onNight, updateWeather } from './weather.js';
import { initParticles, spawnSmoke, spawnSparks, runParticleSystem } from './ecs.js';
import { setBgmMood, startBgm, stopBgm, isBgmPlaying } from './bgm.js';
import { initMultiplayer, isMultiplayer, multiplayerCount, updateMultiplayer, sendWave } from './multiplayer.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') || '';
// Staged screenshot runs never touch the player's real save.
function saveProgress() { if (!shotMode) writeSave(state); }
let seed = Number.parseInt(params.get('seed') || '1', 10);
if (!Number.isFinite(seed)) seed = 1;
const rng = mulberry32(seed * 7919 + 13);

const state = {
  status: 'title',
  cash: 500,
  hp: PLAYER.hp,
  armor: 0,
  character: 'lucia',
  bestDrift: 0,
  completed: [],
  bestWanted: 0,
  playSeconds: 0,
  inCar: false,
  currentCar: null,
  playerCar: null,
  speed: 0,
  shootCooldown: 0,
  committingCrime: false,
  tailTarget: null,
  shake: 0,
  camScale: 1,
  lastHurtSec: -999,
  skidTimer: 0,
  hornCooldown: 0,
  mpOn: false,
  hudTimer: 0,
  lastWeather: 'clear',
  paused: false,
  boxedTime: 0,
};
Object.defineProperty(state, 'ammo', { get: ammoSnapshot, enumerable: true });

let renderer;
let scene;
let camera;
let clock;
let sun;
let hemi;
let ambient;
let playerMesh = null;
let camYaw = Math.PI;
let camPitch = 0.32;
const playerPos = { x: 0, z: 0, heading: Math.PI };
let raycaster;
const tracers = [];
let carGlow = null;
let frameCount = 0;
let crashCooldown = 0;

function buildPlayerMesh() {
  playerMesh = buildCharacterMesh(state.character);
  playerMesh.traverse((o) => { o.castShadow = true; });
}

function swapCharacter(id) {
  if (id === state.character) return;
  const def = characterDef(id);
  state.character = id;
  if (playerMesh) scene.remove(playerMesh);
  buildPlayerMesh();
  playerMesh.position.set(playerPos.x, 0, playerPos.z);
  playerMesh.rotation.y = playerPos.heading;
  playerMesh.visible = !state.inCar;
  scene.add(playerMesh);
  state.hp = Math.min(state.hp, def.hp);
  state.armor = Math.min(state.armor, def.armorMax);
  if (state.currentCar) state.currentCar.grip = def.grip;
  setCharacter(def.name.toUpperCase(), def.tag);
  setHealth(state.hp);
  setArmor(state.armor, def.armorMax);
  setMission(objectiveText(state.completed, state.character));
  playSwap();
  showBanner(`${def.name} — ${def.tag}`);
  showMessage(def.blurb);
  saveProgress();
}

function respawn() {
  const spawn = PLACES.spawn;
  playerPos.x = spawn.x;
  playerPos.z = spawn.z;
  playerPos.heading = Math.PI;
  camYaw = Math.PI;
  const def = characterDef(state.character);
  state.hp = def.hp;
  state.armor = 0;
  state.inCar = false;
  state.currentCar = null;
  state.shake = 0;
}

function startGame() {
  resumeAudio();
  engineStart();
  state.status = 'playing';
  showTitle(false);
  hideEnd();
  if (!shotMode) showMessage('Welcome to Palmetto City — press E for a job, F to get in a car.');
  if (!shotMode && state.completed.length === 0) showStory(...STORY[0]);
}

function enterCar(car) {
  state.inCar = true;
  state.currentCar = car;
  car.isPlayer = true;
  car.grip = characterDef(state.character).grip;
  if (playerMesh) playerMesh.visible = false;
  setHelp('WASD drive · SPACE drift · F exit · H horn · Q swap lead');
  playPickup();
}

function exitCar() {
  const car = state.currentCar;
  if (!car) return;
  car.isPlayer = false;
  if (car !== state.playerCar) car.parked = true;
  const ex = car.x + Math.cos(car.heading) * 2.4;
  const ez = car.z - Math.sin(car.heading) * 2.4;
  const hit = resolveCircleCollision(ex, ez, PLAYER.radius);
  playerPos.x = hit.x;
  playerPos.z = hit.z;
  playerPos.heading = car.heading;
  state.inCar = false;
  state.currentCar = null;
  if (playerMesh) {
    playerMesh.visible = true;
    playerMesh.position.set(playerPos.x, 0, playerPos.z);
    playerMesh.rotation.y = playerPos.heading;
  }
  setHelp('WASD move · SHIFT run · F enter car · CLICK shoot · E job · Q swap lead');
}

function hurtPlayer(amount) {
  if (state.status !== 'playing') return;
  const absorbed = Math.min(state.armor, amount);
  state.armor -= absorbed;
  state.hp -= (amount - absorbed);
  state.lastHurtSec = performance.now() / 1000;
  addShake(0.22);
  const def = characterDef(state.character);
  setArmor(state.armor, def.armorMax);
  setHealth(state.hp);
  if (state.hp <= 0) wasted();
}

function addShake(amount) {
  state.shake = Math.min(1, state.shake + amount);
}

// Tracers are thin glowing boxes (a 1 px Line vanishes at 1080p), plus a muzzle flash.
const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
const tracerMats = {};
function drawTracer(a, b, color = 0xffe9a8) {
  if (!tracerMats[color]) {
    tracerMats[color] = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  }
  const line = new THREE.Mesh(tracerGeo, tracerMats[color]);
  line.scale.set(0.07, 0.07, a.distanceTo(b));
  line.position.copy(a).add(b).multiplyScalar(0.5);
  line.lookAt(b);
  scene.add(line);
  const flash = new THREE.Mesh(tracerGeo, tracerMats[color]);
  flash.scale.setScalar(0.45);
  flash.position.copy(a);
  scene.add(flash);
  const until = performance.now() + (shotMode ? 600 : 90);
  tracers.push({ line, until }, { line: flash, until: until - (shotMode ? 300 : 40) });
}

function selectGun(i) {
  const w = selectWeapon(i, state.completed.length);
  if (w) {
    playSwap();
    showMessage(`${w.name} drawn.`);
  } else {
    showMessage(`${WEAPONS[i].name} locked — finish ${WEAPONS[i].unlock} of Mama Rosa's jobs.`);
  }
}

// Downed crew drop ammo or cash; a wrecked cruiser leaves armour behind.
function dropLoot(x, z, kind) {
  addPickup(kind || (rng() < 0.5 ? 'ammo' : 'cash'), x, z, true);
}

function shoot() {
  if (state.shootCooldown > 0 || state.inCar) return;
  const w = currentWeapon();
  if (!consumeRound()) {
    const a = ammoOf(w.id);
    if (a.mag === 0 && a.reserve === 0) showMessage(`${w.name} is dry — grab a yellow ammo pickup or press 1/2/3.`);
    return;
  }
  state.shootCooldown = w.cooldown;
  playGunshot();
  addCrime('shoot');
  state.committingCrime = true;
  const kick = w.id === 'shotgun' ? 2.6 : w.id === 'smg' ? 0.5 : 1;
  camPitch = clamp(camPitch + 0.018 * kick, 0.08, 1.1);
  addShake(0.1 * kick);
  const targets = [];
  for (const ped of getPeds()) {
    if (ped.state !== 'down') targets.push(ped.mesh);
  }
  for (const cop of getCops()) targets.push(cop.mesh);
  for (const car of traffic) {
    if (!car.dead) targets.push(car.mesh);
  }
  for (let i = 0; i < w.pellets; i++) firePellet(w, targets);
}

// Round 5 aim assist: the closest live target within 12 degrees of where the camera
// faces, in range and in line of sight, gets the shot; otherwise fire straight ahead.
function aimTarget(range) {
  let best = null;
  let bestScore = Infinity;
  const consider = (x, z, y) => {
    const d = Math.hypot(x - playerPos.x, z - playerPos.z);
    if (d > range || d < 0.5) return;
    let off = Math.atan2(x - playerPos.x, z - playerPos.z) - camYaw;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    if (Math.abs(off) > 0.21 || segmentBlocked(playerPos.x, playerPos.z, x, z)) return;
    const score = d * (1 + Math.abs(off) * 6);
    if (score < bestScore) { bestScore = score; best = new THREE.Vector3(x, y, z); }
  };
  for (const p of getPeds()) if (p.state !== 'down') consider(p.x, p.z, 1.1);
  for (const c of getCops()) consider(c.x, c.z, 0.9);
  for (const c of traffic) if (!c.dead && c !== state.playerCar) consider(c.x, c.z, 0.9);
  return best;
}

// One ray per pellet from the chest, jittered by the weapon's spread, out to its range.
function firePellet(w, targets) {
  const origin = new THREE.Vector3(playerPos.x, 1.3, playerPos.z);
  const aim = aimTarget(w.range);
  const dir = aim ? aim.sub(origin).normalize() : new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
  dir.x += (Math.random() * 2 - 1) * w.spread;
  dir.y += (Math.random() * 2 - 1) * w.spread * 0.5;
  dir.z += (Math.random() * 2 - 1) * w.spread;
  raycaster.set(origin, dir.normalize());
  raycaster.far = w.range;
  const hits = raycaster.intersectObjects(targets, true);
  const from = new THREE.Vector3(playerPos.x, 1.5, playerPos.z);
  if (hits.length === 0) {
    const dir = new THREE.Vector3();
    raycaster.ray.at(w.range, dir);
    drawTracer(from, dir);
    return;
  }
  const hit = hits[0];
  const point = hit.point.clone();
  drawTracer(from, point);
  spawnSparks(point.x, point.y, point.z);
  scarePeds(point.x, point.z, 50);
  let top = hit.object;
  while (top.parent && top.parent !== scene) top = top.parent;
  const ped = getPeds().find((p) => p.mesh === top);
  if (ped) {
    const result = hitPed(ped, w.damage / 34);
    if (result === 'down') pedDown(ped, 'shot');
    return;
  }
  const cop = getCops().find((c) => c.mesh === top);
  if (cop) {
    if (damageCop(cop, w.damage)) {
      addCrime('killPed');
      explodeCar(cop);
      dropLoot(cop.x, cop.z, 'armor');
      showMessage('Cop car destroyed — the whole department is coming.');
    }
    return;
  }
  const car = traffic.find((c) => c.mesh === top);
  if (car) {
    car.hp -= w.damage;
    if (car.hp <= 0 && !car.dead) {
      explodeCar(car);
      addCrime('reckless');
      showMessage('You blew up a car — someone called that in.');
    }
  }
}

function pedDown(ped, how) {
  addCrime(ped.hostile ? 'hurtPed' : 'killPed');
  if (ped.hostile) {
    setSquadLeft(getPeds().filter((p) => p.hostile && p.state !== 'down').length);
    dropLoot(ped.x, ped.z);
    showMessage(how === 'run' ? 'You ran a crew member down.' : 'Crew member down — grab the drop.');
  } else {
    showMessage(how === 'run' ? 'You ran someone over — the cops are on it.' : 'A bystander went down — the cops noticed that.');
  }
}

// Round 5: the rival crew shoot back. Each gunman in range with a clear line
// fires every 1.1-1.9 s; 55 % of shots land on foot, 30 % against a moving car.
function updateHostiles(dt) {
  for (const p of getPeds()) {
    if (!p.hostile || p.state === 'down') continue;
    const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
    p.shotTimer = (p.shotTimer ?? 0.8 + rng()) - dt;
    if (d > 42 || p.shotTimer > 0) continue;
    p.shotTimer = 1.1 + rng() * 0.8;
    if (segmentBlocked(p.x, p.z, playerPos.x, playerPos.z)) continue;
    const landed = rng() < (state.inCar && state.speed > 8 ? 0.3 : 0.55);
    const aim = new THREE.Vector3(playerPos.x + (landed ? 0 : (rng() - 0.5) * 4), 1.3, playerPos.z + (landed ? 0 : (rng() - 0.5) * 4));
    drawTracer(new THREE.Vector3(p.x, 1.4, p.z), aim, 0xff5a3c);
    playGunshot();
    if (landed) {
      if (state.inCar && state.currentCar) state.currentCar.hp -= 5;
      else hurtPlayer(6);
    }
  }
}

function collectPickup(kind) {
  const def = characterDef(state.character);
  const k = PICKUP_KINDS[kind];
  if (kind === 'health') state.hp = Math.min(def.hp, state.hp + k.amount);
  else if (kind === 'armor') state.armor = Math.min(def.armorMax, state.armor + k.amount);
  else if (kind === 'ammo') restockAmmo();
  else if (kind === 'cash') state.cash += k.amount;
  setHealth(state.hp);
  setArmor(state.armor, def.armorMax);
  setCash(state.cash);
  playPickup();
  showMessage(k.label);
  saveProgress();
}

// Night glow over every head/tail lamp and cop light bar: one Points cloud.
const GLOW_MAX = 160;
function updateCarGlow(night) {
  carGlow.visible = night;
  if (!night) return;
  const pos = carGlow.geometry.attributes.position.array;
  const col = carGlow.geometry.attributes.color.array;
  let n = 0;
  const put = (x, y, z, r, g, b) => {
    if (n >= GLOW_MAX) return;
    pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
    col[n * 3] = r; col[n * 3 + 1] = g; col[n * 3 + 2] = b;
    n += 1;
  };
  const flash = Math.floor(performance.now() / 260) % 2 === 0;
  const cars = [...traffic, ...getCops(), ...getRoadblocks()];
  if (state.playerCar) cars.push(state.playerCar);
  for (const c of cars) {
    if (c.dead || Math.hypot(c.x - camera.position.x, c.z - camera.position.z) > 140) continue;
    const s = Math.sin(c.heading);
    const k = Math.cos(c.heading);
    for (const side of [-0.6, 0.6]) {
      put(c.x + s * 2.3 + k * side, 0.66, c.z + k * 2.3 - s * side, 1, 0.92, 0.7);
      put(c.x - s * 2.3 + k * side, 0.66, c.z - k * 2.3 - s * side, 0.9, 0.08, 0.05);
    }
    if (c.isCop) put(c.x, 1.7, c.z, flash ? 1 : 0.1, 0.1, flash ? 0.1 : 1);
  }
  carGlow.geometry.setDrawRange(0, n);
  carGlow.geometry.attributes.position.needsUpdate = true;
  carGlow.geometry.attributes.color.needsUpdate = true;
}

function missionCtx() {
  return {
    spawnSquad: (x, z, n) => spawnHostileSquad(x, z, n),
    spawnTailTarget: () => spawnTailTargetCar(),
    forceStars: (n) => forceStars(n),
  };
}

function tryStartMission() {
  const nextId = nextMissionId(state.completed);
  if (nextId === 0) {
    showMessage('All missions complete — free roam, Palmetto City is yours.');
    return;
  }
  if (!startMission(nextId, missionCtx())) return;
  const m = missionById(nextId);
  showBanner(`${m.id}. ${m.name}`);
  showMessage(getMissionBrief(m.id, state.character));
  playPickup();
}

function spawnMissionCar(point) {
  const heading = point.axis === 'x' ? Math.PI / 2 : 0;
  const car = createCar(0xffd34d, point.x, point.z, heading);
  car.cruise = 13;
  car.speed = 13;
  car.isTail = true;
  traffic.push(car);
  return car;
}

function spawnTailTargetCar() {
  const car = spawnMissionCar(randomRoadPoint(rng));
  state.tailTarget = car;
  return car;
}

function busted(reason) {
  if (state.status !== 'playing') return;
  state.status = 'busted';
  playBusted();
  sirenStop();
  engineStop();
  state.cash = Math.max(0, state.cash - 150);
  state.armor = 0;
  clearWanted();
  showEnd('BUSTED', `${reason} The cops took you in — $150 bail.`);
  setCash(state.cash);
  setArmor(state.armor, characterDef(state.character).armorMax);
  saveProgress();
}

function wasted() {
  if (state.status !== 'playing') return;
  state.status = 'wasted';
  playFail();
  sirenStop();
  engineStop();
  state.armor = 0;
  showEnd('WASTED', 'Palmetto City chewed you up. Press R to try again.');
  setArmor(state.armor, characterDef(state.character).armorMax);
  saveProgress();
}

function restart() {
  hideEnd();
  clearCops();
  respawn();
  state.status = 'playing';
  const def = characterDef(state.character);
  setHealth(state.hp);
  setArmor(state.armor, def.armorMax);
  showMessage('Back on the street — stay sharp.');
  engineStart();
  state.boxedTime = 0;
}

function stageShot(mode) {
  window.__shotReady = false;
  if (mode === 'start') {
    camera.position.set(-40, 90, 190);
    camera.lookAt(40, 0, -40);
    showTitle(true);
    setClock(getClockLabel());
    setWeather(getWeatherLabel());
    setTimeout(() => { window.__shotReady = true; }, 1400);
    return;
  }
  if (mode === 'play') {
    startGame();
    const car = spawnPlayerCar(0, -40);
    car.speed = 22;
    enterCar(car);
    forceStars(3);
    if (startMission(1, missionCtx())) {
      const m = missionById(1);
      showBanner(`${m.id}. ${m.name}`);
      showMessage(getMissionBrief(m.id, state.character));
      playPickup();
    }
    camYaw = Math.PI;
    setClock(getClockLabel());
    setWeather(getWeatherLabel());
    setTimeout(() => {
      const c = state.currentCar;
      spawnRoadblock({ x: c.x, z: c.z, heading: c.heading }, 45);
      spawnIntercept({ x: c.x, z: c.z, heading: c.heading }, 2, 35, 0.25);
    }, 2000);
    setTimeout(() => { window.__shotReady = true; }, 2600);
    return;
  }
  if (mode === 'end') {
    startGame();
    respawn();
    playerPos.x = 0;
    playerPos.z = 60;
    if (playerMesh) {
      playerMesh.position.set(0, 0, 60);
      playerMesh.rotation.y = Math.PI;
    }
    forceStars(5);
    busted('Surrounded on the avenue.');
    setClock(getClockLabel());
    setWeather(getWeatherLabel());
    setTimeout(() => { window.__shotReady = true; }, 1400);
    return;
  }
  if (mode === 'combat') {
    // Street Sweep at golden hour: SMG out, the crew shooting back, loot on the floor.
    startGame();
    setHour(16.6);
    state.completed = [1, 2, 3, 4];
    selectWeapon(1, state.completed.length);
    const place = PLACES.alley;
    const spot = resolveCircleCollision(place.x, place.z + 22, PLAYER.radius);
    playerPos.x = spot.x;
    playerPos.z = spot.z;
    startMission(5, missionCtx());
    const m = missionById(5);
    showBanner(`${m.id}. ${m.name}`);
    showMessage(getMissionBrief(m.id, state.character));
    state.shotAim = true;
    camYaw = Math.atan2(place.x - playerPos.x, place.z - playerPos.z);
    playerPos.heading = camYaw;
    camera.position.set(playerPos.x - Math.sin(camYaw) * 7.5, 4, playerPos.z - Math.cos(camYaw) * 7.5);
    setClock(getClockLabel());
    setWeather(getWeatherLabel());
    setTimeout(() => { window.__shotReady = true; }, 2600);
    return;
  }
  if (mode === 'night') {
    startGame();
    setHour(22.5);
    setWeatherKind('storm');
    rainStart();
    setRain(true);
    state.lastWeather = 'storm';
    const car = spawnPlayerCar(0, -40);
    car.speed = 22;
    enterCar(car);
    forceStars(5);
    if (startMission(6, missionCtx())) {
      const m = missionById(6);
      showBanner(`${m.id}. ${m.name}`);
      showMessage(getMissionBrief(m.id, state.character));
      playPickup();
    }
    camYaw = Math.PI;
    setBgmMood('night');
    setClock(getClockLabel());
    setWeather(getWeatherLabel());
    setTimeout(() => {
      const c = state.currentCar;
      spawnIntercept({ x: c.x, z: c.z, heading: c.heading }, 2, 40, 0.2);
    }, 2000);
    setTimeout(() => { window.__shotReady = true; }, 2600);
  }
}

function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  window.__renderer = renderer;
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game-canvas').appendChild(renderer.domElement);
  window.__shotReady = false;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 180, 520);
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(0, 60, 160);
  camera.lookAt(0, 0, 0);
  sun = new THREE.DirectionalLight(0xfff2d9, 2.6);
  sun.position.set(120, 180, 60);
  // Round 5: real-time sun shadows in a 140 m box that follows the player.
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 520 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GLOW_MAX * 3), 3));
  glowGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(GLOW_MAX * 3), 3));
  carGlow = new THREE.Points(glowGeo, glowMaterial(3.2, 0xffffff, true));
  carGlow.frustumCulled = false;
  carGlow.visible = false;
  scene.add(carGlow);
  ambient = new THREE.AmbientLight(0xbfcbd8, 0.9);
  scene.add(ambient);
  hemi = new THREE.HemisphereLight(0x8ec9e8, 0x9a7b4f, 0.5);
  scene.add(hemi);
  raycaster = new THREE.Raycaster();
  initInput(renderer.domElement);

  buildCity(scene, seed);
  initVehicles(scene, seed);
  initPeds(scene, seed);
  initWanted();
  initCops(scene);
  initMissions(scene);
  initHud();
  initAudio();
  initParticles(scene);
  initPickups(scene, seed);
  initWeather(scene, sun, hemi, WEATHER.startHour);
  onNight((night) => {
    ambient.intensity = night ? 0.5 : 0.9;
    ambient.color.setHex(night ? 0x9fb4d8 : 0xbfcbd8);
    if (scene.fog) scene.fog.color.setHex(night ? 0x1a2436 : PALETTE.fog);
    setCityNight(night);
    setVehiclesNight(night);
    setCopsNight(night);
    setBgmMood(night ? 'night' : 'day');
  });

  const saved = loadSave();
  if (saved) {
    state.cash = saved.cash;
    state.completed = saved.completed;
    state.bestWanted = saved.bestWanted;
    state.playSeconds = saved.playSeconds;
    state.character = saved.character;
    state.armor = saved.armor;
    state.bestDrift = saved.bestDrift;
  }
  initWeapons(saved && saved.ammo);
  if (saved && !shotMode) {
    const mins = Math.floor(saved.playSeconds / 60);
    setTitleSave(`SAVE FOUND · ${saved.completed.length}/6 jobs · $${saved.cash} · ${mins} min played — click to continue, N for a new game`);
  }
  respawn();
  buildPlayerMesh();
  playerMesh.position.set(playerPos.x, 0, playerPos.z);
  playerMesh.rotation.y = playerPos.heading;
  scene.add(playerMesh);
  state.playerCar = spawnPlayerCar(6, 96);
  state.playerCar.grip = characterDef(state.character).grip;
  spawnTraffic(TRAFFIC.cars);
  spawnPeds(TRAFFIC.peds);

  if (params.get('mp') === '1') {
    state.mpOn = initMultiplayer(scene, {
      charId: () => state.character,
      onEvent: (evt) => showMessage(evt.text, evt.type === 'mp' ? 3600 : 2600),
    });
  }

  let lastStars = 0;
  onWantedChange((stars) => {
    setStars(stars);
    if (stars >= 4 && stars > lastStars && state.status === 'playing') {
      spawnIntercept({ x: playerPos.x, z: playerPos.z, heading: playerPos.heading }, 2);
      showMessage('Units moving to intercept ahead of you.');
    }
    lastStars = stars;
    state.bestWanted = Math.max(state.bestWanted, stars);
    if (stars >= 1) sirenStart();
    else sirenStop();
    if (stars >= 3) {
      showMessage('Three stars — every cop in Palmetto City is looking for you.');
      setBgmMood('chase');
    } else {
      setBgmMood(isNight() ? 'night' : 'day');
    }
  });

  onMissionEvent((evt) => {
    if (evt.type === 'complete') {
      state.cash += evt.reward;
      state.completed.push(evt.mission.id);
      setCash(state.cash);
      showBanner(`Mission complete +$${evt.reward}`);
      playMissionDone();
      saveProgress();
      const line = STORY[evt.mission.id];
      if (line) setTimeout(() => showStory(...line), 1800);
    } else if (evt.type === 'fail') {
      showBanner(`Mission failed — ${evt.reason}`);
      playFail();
    } else if (evt.type === 'start') {
      setMission(objectiveText(state.completed, state.character));
    }
  });

  const def = characterDef(state.character);
  setCash(state.cash);
  setHealth(state.hp);
  setArmor(state.armor, def.armorMax);
  setStars(0);
  setCharacter(def.name.toUpperCase(), def.tag);
  setClock(getClockLabel());
  setWeather(getWeatherLabel());
  setMission(objectiveText(state.completed, state.character));
  setHelp('Click to start · WASD move · F enter car · E job · CLICK shoot · Q swap lead');

  document.getElementById('title-screen').addEventListener('click', () => {
    if (state.status === 'title') startGame();
  });
  if (shotMode) stageShot(shotMode);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  clock = new THREE.Clock();
  animate();
}

boot();

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  frameCount += 1;
  if (state.status === 'playing') state.playSeconds += dt;

  // Edge-triggered input.
  if (state.status === 'title' && justPressed(KEYS.newGame) && !shotMode) {
    clearSave();
    location.reload();
    return;
  }
  if (state.status === 'playing' && justPressed(KEYS.pause)) {
    state.paused = !state.paused;
    showPaused(state.paused);
    if (state.paused) engineSet(0, false);
  }
  if (state.paused) {
    resetFrame();
    renderer.render(scene, camera);
    return;
  }
  if (state.status === 'title' && (justPressed('Enter') || mouseClicked())) {
    startGame();
  } else if (state.status === 'playing') {
    if (justPressed(KEYS.restart) && startReload()) showMessage('Reloading…', 1200);
    WEAPONS.forEach((w, i) => { if (justPressed(w.key)) selectGun(i); });
    if (justPressed(KEYS.swapChar)) swapCharacter(otherCharacter(state.character));
    if (justPressed(KEYS.music)) {
      if (isBgmPlaying()) {
        stopBgm();
        showMessage('Music off.');
      } else if (startBgm()) {
        showMessage('Music on — synthwave.');
      }
    }
    if (justPressed(KEYS.wave) && state.mpOn) sendWave();
    if (justPressed(KEYS.horn) && state.inCar && state.hornCooldown <= 0) {
      state.hornCooldown = 1.2;
      playHorn();
      scarePeds(playerPos.x, playerPos.z, 25);
      const near = getCops().some((c) => Math.hypot(c.x - playerPos.x, c.z - playerPos.z) < 25);
      if (near) {
        addCrime('reckless');
        alertTo(playerPos.x, playerPos.z);
        showMessage('You leaned on the horn in a cop’s face — they noticed.');
      } else {
        showMessage('Honk!');
      }
    }
    if (justPressed(KEYS.enterCar)) {
      if (state.inCar) {
        exitCar();
      } else {
        let target = nearestCar(playerPos.x, playerPos.z, 6, null);
        if (!target && state.playerCar && !state.playerCar.dead
          && Math.hypot(state.playerCar.x - playerPos.x, state.playerCar.z - playerPos.z) < 6) {
          target = state.playerCar;
        }
        if (target) {
          enterCar(target);
          if (target !== state.playerCar && !target.isCop) {
            addCrime('steal');
            showMessage('You stole a car — someone called that in.');
          }
        }
      }
    }
    if (mouseClicked() || (currentWeapon().auto && mouseDown())) shoot();
  } else if ((state.status === 'busted' || state.status === 'wasted') && justPressed(KEYS.restart)) {
    restart();
  }
  state.hornCooldown = Math.max(0, state.hornCooldown - dt);
  crashCooldown = Math.max(0, crashCooldown - dt);

  // Camera look and zoom.
  const look = takeLook();
  camYaw -= look.dx * 0.0032;
  camPitch = clamp(camPitch + look.dy * 0.0022, 0.08, 1.1);
  state.camScale = clamp(state.camScale + takeZoom() * 0.12, 0.75, 1.6);

  // Movement.
  if (state.status === 'playing') {
    if (state.inCar && state.currentCar) {
      const car = state.currentCar;
      const axes = driveAxes();
      const dist = driveCar(car, dt, axes.throttle, axes.steer, axes.brake);
      if (shotMode === 'play' || shotMode === 'night') car.speed = 22;
      if (car.dead || car.hp <= 0) {
        // Round 5: a car wrecked against the walls blows up and throws you clear.
        explodeCar(car);
        spawnSmoke(car.x, 1, car.z, 6);
        exitCar();
        hurtPlayer(15);
        playCrash();
        addShake(0.8);
        showMessage('Your ride is wrecked — find another.');
      }
    }
    if (state.inCar && state.currentCar) {
      const car = state.currentCar;
      playerPos.x = car.x;
      playerPos.z = car.z;
      playerPos.heading = car.heading;
      camYaw = lerpAngle(camYaw, car.heading, 1 - Math.pow(0.001, dt));
      state.speed = Math.abs(car.speed);
      if (state.speed > 3 && car.hp <= 0 && crashCooldown <= 0) {
        playCrash();
        crashCooldown = 0.5;
      }
      engineSet(state.speed / CAR.maxSpeed, true);
      if (car.drifting) {
        const bx = car.x - Math.sin(car.heading) * 1.6;
        const bz = car.z - Math.cos(car.heading) * 1.6;
        spawnSmoke(bx - Math.cos(car.heading) * 0.9, 0.3, bz + Math.sin(car.heading) * 0.9, 1);
        spawnSmoke(bx + Math.cos(car.heading) * 0.9, 0.3, bz - Math.sin(car.heading) * 0.9, 1);
        state.skidTimer -= dt;
        if (state.skidTimer <= 0) {
          playSkid();
          state.skidTimer = 0.5;
        }
        setDrift(Math.floor(car.driftScore));
      } else {
        setDrift(0);
      }
      if (car.lastBanked > 0) {
        const payout = Math.round(car.lastBanked * DRIFT.cashPerPoint);
        state.cash += payout;
        state.bestDrift = Math.max(state.bestDrift, car.lastBanked);
        setCash(state.cash);
        showMessage(`Drift banked +$${payout}.`);
        const nearCop = getCops().some((c) => Math.hypot(c.x - playerPos.x, c.z - playerPos.z) < 40);
        if (nearCop) {
          addCrime('reckless');
          alertTo(playerPos.x, playerPos.z);
          showMessage('A cop watched that drift — reckless driving.');
        }
        car.lastBanked = 0;
        saveProgress();
      }
    } else if (!state.inCar) {
      const def = characterDef(state.character);
      const axes = walkAxes();
      const speed = axes.sprint ? def.runSpeed : def.walkSpeed;
      let mx = Math.sin(camYaw) * axes.z + Math.cos(camYaw) * axes.x;
      let mz = Math.cos(camYaw) * axes.z - Math.sin(camYaw) * axes.x;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      if (len > 0) {
        const nx = playerPos.x + mx * speed * dt;
        const nz = playerPos.z + mz * speed * dt;
        const hit = resolveCircleCollision(nx, nz, PLAYER.radius);
        playerPos.x = hit.x;
        playerPos.z = hit.z;
        playerPos.heading = Math.atan2(mx, mz);
        state.speed = speed;
      } else {
        state.speed = 0;
      }
      if (state.shotAim) {
        playerPos.heading = camYaw;
        if (frameCount % 4 === 0) shoot();
      }
      if (playerMesh) {
        playerMesh.position.set(playerPos.x, 0, playerPos.z);
        playerMesh.rotation.y = playerPos.heading;
      }
      engineSet(0, false);
    }
  }

  // Weather, clock, rain, multiplayer, armour.
  updateWeather(dt, camera.position);
  sun.position.x += playerPos.x;
  sun.position.z += playerPos.z;
  sun.target.position.set(playerPos.x, 0, playerPos.z);
  updateCarGlow(isNight());
  state.hudTimer += dt;
  if (state.hudTimer >= 0.5) {
    state.hudTimer = 0;
    setClock(getClockLabel());
    setWeather(getWeatherLabel());
  }
  const w = getWeather();
  if (w !== state.lastWeather) {
    state.lastWeather = w;
    if (w !== 'clear') {
      rainStart();
      setRain(true);
      showMessage(w === 'storm' ? 'Storm rolling in — drive careful.' : 'Rain on the avenue.');
    } else {
      rainStop();
      setRain(false);
    }
  }
  if (state.mpOn && isMultiplayer()) {
    setMp(`${multiplayerCount()} driver(s) online`);
  } else {
    setMp('');
  }
  if (state.status === 'playing') {
    const def = characterDef(state.character);
    if (performance.now() / 1000 - state.lastHurtSec > ARMOR.regenDelay && state.armor < def.armorMax) {
      state.armor = Math.min(def.armorMax, state.armor + ARMOR.regenRate * dt);
      setArmor(state.armor, def.armorMax);
    }
  }

  // World systems.
  if (state.status === 'playing' || state.status === 'title') {
    const obstacles = [...getCops(), ...getRoadblocks()];
    if (state.playerCar && state.playerCar !== state.currentCar) obstacles.push(state.playerCar);
    updateTraffic(dt, playerPos.x, playerPos.z, obstacles);
    updatePeds(dt, playerPos.x, playerPos.z, state.inCar, state.speed);
    runParticleSystem(dt);
    if (state.mpOn) {
      updateMultiplayer(dt, {
        x: playerPos.x, z: playerPos.z, heading: playerPos.heading,
        inCar: state.inCar, char: state.character, stars: getStars(),
      });
    }
  }

  if (state.status === 'playing') {
    state.shootCooldown = Math.max(0, state.shootCooldown - dt);
    updateWeapons(dt);
    // Round 5: stars only cool off while no cop has eyes on you (cops.js line of sight).
    const seen = updateCops(dt, getStars(), {
      x: playerPos.x, z: playerPos.z, inCar: state.inCar, speed: state.speed, heading: playerPos.heading,
    }, () => busted('Caught on foot.'), (dist) => hurtPlayer(dist < 25 ? 9 : 4));
    updateWanted(dt, state.committingCrime || seen);
    state.committingCrime = false;
    setEvading(getStars() > 0 && !seen && evadeProgress() > 0.3);
    updateHostiles(dt);
    updatePickups(dt, playerPos.x, playerPos.z, state.inCar, collectPickup);
    if (state.status !== 'playing') {
      // Busted or wasted this frame.
    } else if (state.inCar && state.currentCar) {
      const car = state.currentCar;
      // Boxed in: stopped with a cruiser at the door for POLICE.bustSeconds.
      const copClose = getStars() > 0 && [...getCops(), ...getRoadblocks()].some((c) => Math.hypot(c.x - car.x, c.z - car.z) < 6.5);
      state.boxedTime = copClose && state.speed < 1.5 ? state.boxedTime + dt : 0;
      if (state.boxedTime > POLICE.bustSeconds) busted('Boxed in — they pulled you out of the car.');
      // Roadblock cruisers are solid.
      for (const rb of getRoadblocks()) {
        const dx = car.x - rb.x;
        const dz = car.z - rb.z;
        const d = Math.hypot(dx, dz);
        if (d < 3.8 && d > 0.01) {
          if (Math.abs(car.speed) > 4) {
            car.hp -= Math.abs(car.speed) * 0.9;
            spawnSparks(rb.x, 1, rb.z);
            playCrash();
            addShake(0.6);
          }
          car.x = rb.x + (dx / d) * 3.8;
          car.z = rb.z + (dz / d) * 3.8;
          car.speed *= -0.3;
        }
      }
      // Run-over: fast car through a pedestrian.
      if (state.speed > 7) {
        for (const p of getPeds()) {
          if (p.state === 'down' || Math.hypot(p.x - car.x, p.z - car.z) > 2.2) continue;
          hitPed(p, 99);
          pedDown(p, 'run');
          spawnSparks(p.x, 1, p.z);
          addShake(0.3);
        }
      }
    }

    if (state.inCar && state.currentCar) {
      const car = state.currentCar;
      for (const cop of getCops()) {
        if (!state.currentCar) break;
        if (Math.hypot(cop.x - car.x, cop.z - car.z) < 5.5 && Math.abs(cop.speed) > 6) {
          car.hp -= 60 * dt;
          addShake(0.5 * dt);
          if (car.hp <= 0) {
            explodeCar(car);
            exitCar();
            hurtPlayer(20);
            showMessage('A cop rammed your car apart.');
            playCrash();
          }
        }
      }
      if (state.currentCar) {
        for (const other of traffic) {
          if (other === state.currentCar || other.dead) continue;
          if (Math.hypot(other.x - car.x, other.z - car.z) < 4.6) {
            car.speed *= 0.94;
            other.speed = 0;
            other.stunned = 1.5;
          }
        }
      }
    }
    const finished = updateMissions(dt, {
      px: playerPos.x, pz: playerPos.z, inCar: state.inCar,
      speed: state.speed, stars: getStars(), squadLeft: getSquadLeft(),
      targetCar: state.tailTarget, dt,
    });
    if (finished && state.tailTarget) {
      // The courier goes back to being ordinary traffic once the job ends either way.
      state.tailTarget.isTail = false;
      state.tailTarget = null;
    }
    setMission(objectiveText(state.completed, state.character));
  }

  // Camera follow.
  state.shake = Math.max(0, state.shake - 1.4 * dt);
  if (!(state.status === 'title' && shotMode === 'start')) {
    const target = state.inCar && state.currentCar ? state.currentCar : playerPos;
    const heading = state.inCar && state.currentCar ? state.currentCar.heading : camYaw;
    const dist = (state.inCar ? 11 : 7.5) * state.camScale;
    const height = (state.inCar ? 4.4 : 3.2) * state.camScale + Math.sin(camPitch) * 2.5;
    const desired = new THREE.Vector3(
      target.x - Math.sin(heading) * dist,
      height,
      target.z - Math.cos(heading) * dist,
    );
    camera.position.lerp(desired, 1 - Math.pow(0.0001, dt));
    const s = state.shake * state.shake * 0.55;
    camera.position.x += (Math.random() * 2 - 1) * s;
    camera.position.y += (Math.random() * 2 - 1) * s;
    camera.position.z += (Math.random() * 2 - 1) * s;
    camera.lookAt(target.x, state.inCar ? 1.6 : 1.4, target.z);
  }

  // HUD.
  if (state.status === 'playing') {
    setSpeed(Math.round(state.speed * 3.6));
    setHealth(state.hp);
    setWeapon(state.inCar ? 'DRIVING · F to bail' : ammoLabel());
    setCarHealth(state.inCar && state.currentCar ? state.currentCar.hp : null);
  }
  if (state.status === 'playing' || state.status === 'busted' || state.status === 'wasted') {
    let objective = null;
    const activeId = getActiveId();
    if (activeId) {
      const m = missionById(activeId);
      if (m) objective = PLACES[m.place];
    } else {
      const nextId = nextMissionId(state.completed);
      if (nextId) {
        const m = missionById(nextId);
        if (m) objective = PLACES[m.place];
      }
    }
    drawMinimap({
      player: { x: playerPos.x, z: playerPos.z, heading: playerPos.heading },
      traffic: traffic.map((c) => ({ x: c.x, z: c.z })),
      cops: getCops().map((c) => ({ x: c.x, z: c.z })),
      objective: objective ? { x: objective.x, z: objective.z } : null,
    });
  }

  const now = performance.now();
  for (let i = tracers.length - 1; i >= 0; i--) {
    if (now < tracers[i].until) continue;
    scene.remove(tracers[i].line);
    tracers.splice(i, 1);
  }
  if (state.status === 'playing' && Math.floor(state.playSeconds) % 20 === 0 && frameCount % 60 === 0) {
    saveProgress();
  }
  updateCityVisibility(camera);
  renderer.render(scene, camera);
  resetFrame();
}
