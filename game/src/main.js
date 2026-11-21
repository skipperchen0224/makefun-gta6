// Palmetto Heat — the main game: scene, player, camera, combat, main loop.
// Boots three.js, wires every module together, and stages the four
// screenshot modes the dossier wants (?shot=start|play|end|night). New
// systems in this round: dual leads (Q swaps), armour, drift scoring with
// tyre smoke, screen shake and shooting recoil, the weather day/night
// cycle, synthwave BGM (M), an ECS particle system, and an optional
// WebSocket multiplayer lobby (?mp=1).

import * as THREE from 'three';
import {
  WORLD, PLAYER, CAR, DRIFT, ARMOR, WEATHER, ECONOMY, PLACES, KEYS, PALETTE,
  clamp, mulberry32,
} from './config.js';
import {
  initInput, justPressed, mouseClicked, driveAxes, walkAxes, takeLook, takeZoom, resetFrame,
} from './input.js';
import {
  initAudio, resumeAudio, engineStart, engineSet, sirenStart, sirenStop,
  playGunshot, playPickup, playMissionDone, playFail, playCrash, playBusted,
  playHorn, playSwap, playSkid, rainStart, rainStop,
} from './audio.js';
import { hasSave, loadSave, writeSave } from './save.js';
import {
  buildCity, randomRoadPoint, resolveCircleCollision,
  setNightMode as setCityNight, updateCityVisibility,
} from './city.js';
import {
  initVehicles, createCar, createPlayerCar, spawnTraffic, traffic,
  driveCar, updateTraffic, nearestCar, explodeCar,
  setNightMode as setVehicleNight,
} from './vehicles.js';
import {
  initPeds, spawnPeds, spawnHostileSquad, scarePeds, updatePeds, hitPed,
  getPeds, countHostilesUp, setRain,
} from './peds.js';
import {
  initWanted, getStars, addCrime, forceStars, updateWanted, clearWanted, onWantedChange,
} from './wanted.js';
import {
  initCops, updateCops, damageCop, getCops, clearCops,
  setNightMode as setCopNight, alertTo,
} from './cops.js';
import {
  initMissions, onMissionEvent, missionById, nextMissionId, getActiveId,
  startMission, updateMissions, objectiveText, setSquadLeft, getMissionBrief,
} from './missions.js';
import {
  initHud, setCash, setHealth, setArmor, setStars, setMission, setSpeed, setHelp,
  setCharacter, setClock, setWeather as setWeatherHud, setDrift, setMp,
  showMessage, showBanner, showTitle, showEnd, hideEnd, drawMinimap,
} from './hud.js';
import { characterDef, otherCharacter, buildCharacterMesh } from './characters.js';
import {
  initWeather, setWeather as setWeatherKind, setHour, getWeather, isNight,
  getClockLabel, getWeatherLabel, onNight, updateWeather,
} from './weather.js';
import { initParticles, spawnSmoke, spawnSparks, runParticleSystem } from './ecs.js';
import { isBgmPlaying, startBgm, stopBgm, setBgmMood } from './bgm.js';
import {
  initMultiplayer, isMultiplayer, multiplayerCount, updateMultiplayer, sendWave,
} from './multiplayer.js';

// ---- URL params ------------------------------------------------------------
const params = new URLSearchParams(location.search);
const shot = params.get('shot') || '';
const seed = Number.parseInt(params.get('seed') || '1', 10) || 1;
const rng = mulberry32(seed * 7919 + 13);

// ---- game state ------------------------------------------------------------
const state = {
  status: 'title', // title | playing | busted | wasted
  cash: 500,
  hp: PLAYER.hp,
  armor: 0,
  character: 'lucia', // lucia | jason, Q swaps
  bestDrift: 0,
  completed: [],
  bestWanted: 0,
  playSeconds: 0,
  inCar: false,
  car: null,
  myCar: null,
  speed: 0,
  shootCooldown: 0,
  committingCrime: false,
  tailTarget: null,
  startedAt: performance.now(),
  shotTimer: 0,
  shake: 0,
  camZoom: 1,
  lastHurtAt: 0,
  skidTimer: 0,
  hornCooldown: 0,
  mpEnabled: false,
  hudTimer: 0,
  lastWeather: 'clear',
};

// ---- module variables ------------------------------------------------------
let renderer;
let scene;
let camera;
let clock;
let sun;
let hemi;
let ambient;
let playerMesh = null;
let playerHeading = Math.PI;
let camYaw = Math.PI;
let camPitch = 0.32;
const player = { x: 0, z: 0, heading: Math.PI };
const raycaster = new THREE.Raycaster();
let tracer = null;
let tracerUntil = 0;
let frame = 0;

window.__shotReady = false;

// ---- player ----------------------------------------------------------------

/** Build the on-foot mesh for the current lead, at the player's spot. */
function buildPlayerMesh() {
  const mesh = buildCharacterMesh(state.character);
  mesh.position.set(player.x, 0, player.z);
  mesh.rotation.y = player.heading;
  return mesh;
}

/** Swap leads mid-run: new mesh, new caps, new grip, new voice. */
function swapCharacter(id) {
  if (id === state.character) return;
  const def = characterDef(id);
  state.character = id;
  if (playerMesh) scene.remove(playerMesh);
  playerMesh = buildPlayerMesh();
  playerMesh.visible = !state.inCar;
  scene.add(playerMesh);
  state.hp = Math.min(state.hp, def.hp);
  state.armor = Math.min(state.armor, def.armorMax);
  if (state.car) state.car.grip = def.grip;
  setCharacter(def.name.toUpperCase(), def.tag);
  setHealth(state.hp);
  setArmor(state.armor, def.armorMax);
  setMission(objectiveText(state.completed, state.character));
  playSwap();
  showBanner(`${def.name} — ${def.tag}`);
  showMessage(def.blurb);
  writeSave(state);
}

/** Back to the spawn plaza, full health, no car, no shake. */
function respawn() {
  const spawn = PLACES.spawn;
  player.x = spawn.x;
  player.z = spawn.z;
  player.heading = Math.PI;
  playerHeading = Math.PI;
  camYaw = Math.PI;
  state.hp = characterDef(state.character).hp;
  state.armor = 0;
  state.inCar = false;
  state.car = null;
  state.shake = 0;
  if (playerMesh) {
    playerMesh.position.set(player.x, 0, player.z);
    playerMesh.rotation.y = player.heading;
  }
}

/** Leave the title screen and start playing. */
function startGame() {
  if (state.status !== 'title') return;
  resumeAudio();
  engineStart();
  state.status = 'playing';
  showTitle(false);
  hideEnd();
  if (!shot) showMessage('欢迎来到棕榈城，按 E 开始任务，按 F 上车');
}

/** Get in a car: hide the lead, hand the car their grip, show drive help. */
function enterCar(car) {
  state.inCar = true;
  state.car = car;
  car.isPlayer = true;
  car.grip = characterDef(state.character).grip;
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  player.x = car.x;
  player.z = car.z;
  player.heading = car.heading;
  if (playerMesh) playerMesh.visible = false;
  setHelp('WASD 开车、空格漂移、F 下车、H 喇叭、Q 换主角');
  playPickup();
}

/** Get out on the car's left side, back on foot. */
function exitCar() {
  if (!state.car) return;
  const car = state.car;
  car.isPlayer = false;
  const out = resolveCircleCollision(
    car.x + Math.cos(car.heading) * 2.4,
    car.z - Math.sin(car.heading) * 2.4,
    PLAYER.radius,
  );
  player.x = out.x;
  player.z = out.z;
  player.heading = car.heading;
  state.inCar = false;
  state.car = null;
  if (playerMesh) {
    playerMesh.visible = true;
    playerMesh.position.set(player.x, 0, player.z);
    playerMesh.rotation.y = player.heading;
  }
  setHelp('WASD 移动、Shift 跑、F 上车、点击开枪、E 任务、Q 换主角');
}

/** Damage the lead: armour eats it first, then health, then the screen shakes. */
function damagePlayer(amount) {
  if (state.status !== 'playing') return;
  const absorbed = Math.min(state.armor, amount);
  state.armor -= absorbed;
  state.hp -= (amount - absorbed);
  state.lastHurtAt = state.playSeconds;
  addShake(0.22);
  setArmor(state.armor, characterDef(state.character).armorMax);
  setHealth(state.hp);
  if (state.hp <= 0) waste();
}

/** Add screen shake, capped at 1. */
function addShake(amount) {
  state.shake = Math.min(1, state.shake + amount);
}

// ---- combat ----------------------------------------------------------------

/** Fire one shot from the screen centre, with recoil, tracer and sparks. */
function shoot() {
  if (state.shootCooldown > 0 || state.inCar) return;
  state.shootCooldown = 0.28;
  playGunshot();
  addCrime('shoot');
  state.committingCrime = true;
  camPitch = clamp(camPitch + 0.018, 0.08, 1.1);
  addShake(0.1);
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const targets = [
    ...getPeds().map((p) => p.mesh),
    ...getCops().map((c) => c.mesh),
    ...traffic.map((c) => c.mesh),
  ];
  const hits = raycaster.intersectObjects(targets, true);
  const from = new THREE.Vector3(player.x, 1.5, player.z);
  const to = hits.length > 0
    ? hits[0].point.clone()
    : raycaster.ray.at(60, new THREE.Vector3());
  drawTracer(from, to);
  if (hits.length === 0) return;
  spawnSparks(to.x, to.y, to.z);
  scarePeds(player.x, player.z, 50);
  let top = hits[0].object;
  while (top.parent && top.parent !== scene) top = top.parent;
  const ped = getPeds().find((p) => p.mesh === top);
  if (ped) {
    const result = hitPed(ped, 1);
    if (result === 'down') {
      if (ped.hostile) {
        addCrime('hurtPed');
        setSquadLeft(countHostilesUp());
        showMessage('敌对分子倒下了');
      } else {
        addCrime('killPed');
        showMessage('警察注意到了');
      }
    }
    return;
  }
  const cop = getCops().find((c) => c.mesh === top);
  if (cop) {
    if (damageCop(cop, 34)) {
      addCrime('shoot');
      showMessage('警车被击毁了');
    }
    return;
  }
  const car = traffic.find((c) => c.mesh === top);
  if (car) {
    car.hp -= 34;
    if (car.hp <= 0) {
      explodeCar(car);
      addCrime('shoot');
    }
  }
}

/** A fading tracer line from muzzle to impact, gone in 90 ms. */
function drawTracer(a, b) {
  if (tracer) scene.remove(tracer);
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  tracer = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xffe9a8, transparent: true, opacity: 0.9,
  }));
  scene.add(tracer);
  tracerUntil = performance.now() + 90;
}

// ---- missions --------------------------------------------------------------

/** Pick up the next job from Mama Rosa, with the three mission callbacks. */
function tryStartMission() {
  const id = nextMissionId(state.completed);
  if (id === 0) {
    showMessage('全部任务完成，自由漫游吧！');
    return;
  }
  const m = missionById(id);
  const ctx = {
    spawnSquad: (x, z, n) => spawnHostileSquad(x, z, n),
    spawnTailTarget,
    forceStars,
  };
  if (startMission(id, ctx)) {
    showBanner(`任务 ${id}：${m.name}`);
    showMessage(getMissionBrief(id, state.character));
    playPickup();
  }
}

/** The tail mission's mark: a yellow courier car on a random road. */
function spawnTailTarget() {
  const spot = randomRoadPoint(rng);
  const heading = spot.axis === 'x' ? Math.PI / 2 : 0;
  const car = createCar(0xffe14d, spot.x, spot.z, heading, false);
  car.cruise = 13;
  state.tailTarget = car;
  return car;
}

// ---- busted / wasted -------------------------------------------------------

/** Arrested: bail $150, armour gone, wanted cleared, back to the end screen. */
function bust(reason) {
  if (state.status !== 'playing') return;
  state.status = 'busted';
  playBusted();
  sirenStop();
  engineSet(0, false);
  state.cash = Math.max(0, state.cash - 150);
  state.armor = 0;
  clearWanted();
  showEnd('BUSTED', `${reason} — 警察带走了你，$150 保释。按 R 回去。`);
  setCash(state.cash);
  setArmor(state.armor, characterDef(state.character).armorMax);
  writeSave(state);
}

/** Killed: the city chewed you up, back to the end screen. */
function waste() {
  if (state.status !== 'playing') return;
  state.status = 'wasted';
  playFail();
  sirenStop();
  engineSet(0, false);
  state.armor = 0;
  showEnd('WASTED', '棕榈城把你嚼碎了。按 R 再试。');
  setArmor(state.armor, characterDef(state.character).armorMax);
  writeSave(state);
}

/** Back on the street after BUSTED / WASTED (or a mid-run reset). */
function restart() {
  hideEnd();
  clearCops();
  respawn();
  state.status = 'playing';
  setHealth(state.hp);
  setArmor(state.armor, characterDef(state.character).armorMax);
  showMessage('回到街头、保持警惕');
  engineStart();
}

// ---- screenshots -----------------------------------------------------------

/** Stage one of the four dossier shots, then raise the ready flag. */
function stageShot(mode) {
  window.__shotReady = false;
  const ctx = {
    spawnSquad: (x, z, n) => spawnHostileSquad(x, z, n),
    spawnTailTarget,
    forceStars,
  };
  if (mode === 'start') {
    camera.position.set(-40, 90, 190);
    camera.lookAt(40, 0, -40);
    showTitle(true);
    setTimeout(() => { window.__shotReady = true; }, 1400);
    return;
  }
  if (mode === 'play') {
    startGame();
    state.myCar.x = 0;
    state.myCar.z = -40;
    state.myCar.heading = Math.PI;
    state.myCar.speed = 22;
    enterCar(state.myCar);
    forceStars(2);
    startMission(1, ctx);
    camYaw = Math.PI;
    setTimeout(() => { window.__shotReady = true; }, 2600);
    return;
  }
  if (mode === 'end') {
    startGame();
    respawn();
    player.x = 0;
    player.z = 60;
    if (playerMesh) playerMesh.position.set(player.x, 0, player.z);
    forceStars(5);
    bust('在大道上被包围');
    setTimeout(() => { window.__shotReady = true; }, 1400);
    return;
  }
  if (mode === 'night') {
    startGame();
    setHour(22.5);
    setWeatherKind('storm');
    state.lastWeather = 'storm';
    setRain(true);
    rainStart();
    state.myCar.x = 0;
    state.myCar.z = -40;
    state.myCar.heading = Math.PI;
    state.myCar.speed = 22;
    enterCar(state.myCar);
    forceStars(3);
    startMission(6, ctx);
    camYaw = Math.PI;
    setBgmMood('night');
    setTimeout(() => { window.__shotReady = true; }, 2600);
  }
}

// ---- boot ------------------------------------------------------------------

function start() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  if (shot) window.__renderer = renderer;
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('game-canvas').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 180, 520);
  if (shot) window.__scene = scene;

  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(0, 60, 160);
  camera.lookAt(0, 0, 0);

  sun = new THREE.DirectionalLight(0xfff2d9, 2.6);
  sun.position.set(120, 180, 60);
  scene.add(sun);
  ambient = new THREE.AmbientLight(0xcfd8e0, 0.9);
  scene.add(ambient);
  hemi = new THREE.HemisphereLight(0x8ec9e8, 0xc9b18a, 0.5);
  scene.add(hemi);

  buildCity(scene, seed);
  initVehicles(scene, seed);
  initPeds(scene, seed);
  initWanted();
  initCops(scene);
  initMissions(scene);
  initHud();
  initAudio();
  initParticles(scene);
  initWeather(scene, sun, hemi, WEATHER.startHour);

  // Night falls: lamps, headlights, searchlight, mood — and back at dawn.
  onNight((night) => {
    ambient.intensity = night ? 0.5 : 0.9;
    ambient.color.setHex(night ? 0x9fb4d8 : 0xcfd8e0);
    scene.fog.color.setHex(night ? 0x1a2436 : PALETTE.fog);
    setCityNight(night);
    setVehicleNight(night);
    setCopNight(night);
    setBgmMood(night ? 'night' : 'day');
  });

  const save = loadSave();
  if (save) {
    state.cash = save.cash;
    state.completed = save.completed;
    state.bestWanted = save.bestWanted;
    state.playSeconds = save.playSeconds;
    state.character = save.character;
    state.armor = save.armor;
    state.bestDrift = save.bestDrift;
  } else if (hasSave()) {
    state.cash = 500;
  }

  respawn();
  playerMesh = buildPlayerMesh();
  scene.add(playerMesh);
  state.myCar = createPlayerCar(6, 96);
  state.myCar.grip = characterDef(state.character).grip;
  spawnTraffic(10);
  spawnPeds(16);

  state.mpEnabled = initMultiplayer(scene, {
    charId: () => state.character,
    onEvent: (ev) => showMessage(ev.text, ev.type === 'mp' ? 3600 : 2600),
  });

  onWantedChange((stars) => {
    setStars(stars);
    state.bestWanted = Math.max(state.bestWanted, stars);
    if (stars >= 1) sirenStart();
    else sirenStop();
    if (stars >= 3) {
      showMessage('三颗星了，全城警察都在找你');
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
      showBanner(`任务完成 +$${evt.reward}`);
      playMissionDone();
      writeSave(state);
    } else if (evt.type === 'fail') {
      showBanner(`任务失败：${evt.reason}`);
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
  setWeatherHud(getWeatherLabel());
  setMission(objectiveText(state.completed, state.character));
  setHelp('点击开始、WASD 移动、F 上车、E 任务、点击开枪、Q 换主角');
  initInput(renderer.domElement);

  document.getElementById('title-screen').addEventListener('click', () => {
    if (state.status === 'title') startGame();
  });

  if (shot) stageShot(shot);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  clock = new THREE.Clock();
  loop();
}

// ---- main loop -------------------------------------------------------------

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  frame++;
  if (state.status === 'playing') state.playSeconds += dt;

  // Input edges.
  if (state.status === 'title') {
    if (justPressed(KEYS.restart) || mouseClicked()) startGame();
  } else if (state.status === 'playing') {
    if (justPressed('KeyE')) tryStartMission();
    if (justPressed(KEYS.restart)) restart();
    if (justPressed(KEYS.swapChar)) swapCharacter(otherCharacter(state.character));
    if (justPressed(KEYS.music)) {
      if (isBgmPlaying()) {
        stopBgm();
        showMessage('音乐关了');
      } else if (startBgm()) {
        showMessage('Palmetto Nights FM — 开播');
      }
    }
    if (justPressed(KEYS.wave) && isMultiplayer()) sendWave();
    if (justPressed(KEYS.horn) && state.inCar && state.hornCooldown <= 0) {
      state.hornCooldown = 1.2;
      playHorn();
      scarePeds(player.x, player.z, 25);
      const nearCop = getCops().some((c) => {
        const dx = c.x - player.x;
        const dz = c.z - player.z;
        return dx * dx + dz * dz < 25 * 25;
      });
      if (nearCop) {
        addCrime('reckless');
        alertTo(player.x, player.z);
        showMessage('警察注意到了');
      }
    }
    if (justPressed(KEYS.enterCar)) {
      if (state.inCar) {
        exitCar();
      } else {
        const found = nearestCar(player.x, player.z, 6, null)
          || (state.myCar && !state.myCar.dead
            && Math.hypot(state.myCar.x - player.x, state.myCar.z - player.z) < 6
            ? state.myCar : null);
        if (found) {
          if (found !== state.myCar && !found.isCop) {
            addCrime('steal');
            showMessage('你偷了这辆车');
          }
          enterCar(found);
        }
      }
    }
    if (mouseClicked()) shoot();
  } else if (justPressed(KEYS.restart)) {
    restart();
  }
  state.hornCooldown = Math.max(0, state.hornCooldown - dt);

  // Look and zoom.
  const look = takeLook();
  camYaw -= look.dx * 0.0032;
  camPitch = clamp(camPitch + look.dy * 0.0022, 0.08, 1.1);
  const zoom = takeZoom();
  if (zoom !== 0) state.camZoom = clamp(state.camZoom + zoom * 0.12, 0.75, 1.6);

  // Movement.
  if (state.status === 'playing') {
    const def = characterDef(state.character);
    if (state.inCar && state.car) {
      const car = state.car;
      const hpBefore = car.hp;
      const axes = driveAxes();
      const dist = driveCar(car, dt, axes.throttle, axes.steer, axes.brake);
      state.speed = car.speed;
      player.x = car.x;
      player.z = car.z;
      player.heading = car.heading;
      let diff = car.heading - camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      camYaw += diff * (1 - Math.pow(0.001, dt));
      if (dist > 0 && Math.abs(car.speed) > 3 && car.hp < hpBefore) playCrash();
      engineSet(Math.abs(car.speed) / CAR.maxSpeed, true);
      if (car.drifting) {
        const bx = car.x - Math.sin(car.heading) * 1.45;
        const bz = car.z - Math.cos(car.heading) * 1.45;
        const sx = Math.cos(car.heading);
        const sz = -Math.sin(car.heading);
        spawnSmoke(bx + sx * 0.95, 0.3, bz + sz * 0.95, 1);
        spawnSmoke(bx - sx * 0.95, 0.3, bz - sz * 0.95, 1);
        state.skidTimer -= dt;
        if (state.skidTimer <= 0) {
          playSkid();
          state.skidTimer = 0.5;
        }
      }
      setDrift(car.drifting ? car.driftScore : 0);
      if (car.lastBanked > 0) {
        const amount = Math.round(car.lastBanked * DRIFT.cashPerPoint);
        state.cash += amount;
        state.bestDrift = Math.max(state.bestDrift, car.lastBanked);
        setCash(state.cash);
        const nearCop = getCops().some((c) => {
          const dx = c.x - player.x;
          const dz = c.z - player.z;
          return dx * dx + dz * dz < 40 * 40;
        });
        if (nearCop) {
          addCrime('reckless');
          alertTo(player.x, player.z);
          showMessage(`漂移结算 +$${amount}，警察注意到了你`);
        } else {
          showMessage(`漂移结算 +$${amount}`);
        }
        car.lastBanked = 0;
        writeSave(state);
      }
    } else {
      const axes = walkAxes();
      const speed = axes.sprint ? def.runSpeed : def.walkSpeed;
      const mx = Math.sin(camYaw) * axes.z + Math.cos(camYaw) * axes.x;
      const mz = Math.cos(camYaw) * axes.z - Math.sin(camYaw) * axes.x;
      const len = Math.hypot(mx, mz);
      if (len > 0.01) {
        const nx = player.x + (mx / Math.max(1, len)) * speed * dt;
        const nz = player.z + (mz / Math.max(1, len)) * speed * dt;
        const hit = resolveCircleCollision(nx, nz, PLAYER.radius);
        player.x = hit.x;
        player.z = hit.z;
        player.heading = Math.atan2(mx, mz);
        state.speed = speed;
      } else {
        state.speed = 0;
      }
      if (playerMesh) {
        playerMesh.position.set(player.x, 0, player.z);
        playerMesh.rotation.y = player.heading;
      }
      engineSet(0, false);
    }
  }

  // Weather and the clock.
  updateWeather(dt, camera.position);
  state.hudTimer += dt;
  if (state.hudTimer >= 0.5) {
    state.hudTimer = 0;
    setClock(getClockLabel());
    setWeatherHud(getWeatherLabel());
  }
  const wet = getWeather() !== 'clear';
  if (wet && state.lastWeather === 'clear') {
    setRain(true);
    rainStart();
    showMessage(getWeather() === 'storm' ? '风暴来了，开车小心' : '大道上下雨了');
  } else if (!wet && state.lastWeather !== 'clear') {
    setRain(false);
    rainStop();
  }
  state.lastWeather = getWeather();
  if (isMultiplayer()) setMp(`MP · ${multiplayerCount()} online`);
  else setMp('');

  // Armour regrows after a quiet stretch.
  if (state.status === 'playing') {
    const def = characterDef(state.character);
    if (state.playSeconds - state.lastHurtAt > ARMOR.regenDelay && state.armor < def.armorMax) {
      state.armor = Math.min(def.armorMax, state.armor + ARMOR.regenRate * dt);
      setArmor(state.armor, def.armorMax);
    }
  }

  // World systems.
  if (state.status === 'playing' || state.status === 'title') {
    updateTraffic(dt, player.x, player.z);
    updatePeds(dt, player.x, player.z, state.inCar, state.speed);
  }
  runParticleSystem(dt);
  if (isMultiplayer()) {
    updateMultiplayer(dt, {
      x: player.x, z: player.z, heading: player.heading,
      inCar: state.inCar, char: state.character, stars: getStars(),
    });
  }

  if (state.status === 'playing') {
    state.shootCooldown = Math.max(0, state.shootCooldown - dt);
    updateWanted(dt, state.committingCrime);
    state.committingCrime = false;
    updateCops(dt, getStars(),
      { x: player.x, z: player.z, inCar: state.inCar, speed: state.speed },
      () => bust('警察把你按倒在地'),
      (d) => damagePlayer(d < 25 ? 9 : 4));
    // Cop rams the player's car.
    if (state.inCar && state.car) {
      for (const cop of getCops()) {
        const dx = cop.x - player.x;
        const dz = cop.z - player.z;
        if (dx * dx + dz * dz < 5.5 * 5.5 && Math.abs(cop.speed) > 6) {
          state.car.hp -= 60 * dt;
          addShake(0.3);
          if (state.car.hp <= 0) {
            const wreck = state.car;
            explodeCar(wreck);
            exitCar();
            damagePlayer(20);
            showMessage('警车把你撞爆了！');
            playCrash();
            break;
          }
        }
      }
      // Traffic bumps.
      for (const other of traffic) {
        if (other === state.car || other.dead) continue;
        const dx = other.x - player.x;
        const dz = other.z - player.z;
        if (dx * dx + dz * dz < 4.6 * 4.6) {
          state.car.speed *= 0.94;
          other.speed = 0;
        }
      }
    }
    // The tail target keeps cruising its road.
    if (state.tailTarget && !state.tailTarget.dead) {
      const t = state.tailTarget;
      t.x += Math.sin(t.heading) * t.cruise * dt;
      t.z += Math.cos(t.heading) * t.cruise * dt;
      if (Math.abs(t.x) > 230 || Math.abs(t.z) > 230) {
        t.heading += Math.PI;
        t.x = clamp(t.x, -230, 230);
        t.z = clamp(t.z, -230, 230);
      }
      t.mesh.position.set(t.x, 0, t.z);
      t.mesh.rotation.y = t.heading;
    }
    const finished = updateMissions(dt, {
      px: player.x, pz: player.z, inCar: state.inCar, speed: state.speed,
      stars: getStars(), squadLeft: countHostilesUp(), targetCar: state.tailTarget, dt,
    });
    if (finished) state.tailTarget = null;
    setMission(objectiveText(state.completed, state.character));
  }

  // Camera: shake decays, then follow the car or the lead.
  state.shake = Math.max(0, state.shake - 1.4 * dt);
  if (state.status !== 'title' && shot !== 'start') {
    const target = state.inCar && state.car ? state.car : player;
    const heading = state.inCar && state.car ? state.car.heading : camYaw;
    const dist = (state.inCar ? 11 : 7.5) * state.camZoom;
    const height = (state.inCar ? 4.4 : 3.2) * state.camZoom + Math.sin(camPitch) * 2.5;
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
    setSpeed(Math.abs(state.speed) * 3.6);
    setHealth(state.hp);
  }
  if (state.status === 'playing' || state.status === 'busted' || state.status === 'wasted') {
    const activeId = getActiveId();
    let objective = null;
    if (activeId) {
      const m = missionById(activeId);
      if (m) objective = PLACES[m.place];
    } else {
      const next = nextMissionId(state.completed);
      if (next) {
        const m = missionById(next);
        if (m) objective = PLACES[m.place];
      }
    }
    drawMinimap({
      player: { x: player.x, z: player.z, heading: player.heading },
      traffic,
      cops: getCops(),
      objective,
    });
  }

  // Tracer expiry.
  if (tracer && performance.now() > tracerUntil) {
    scene.remove(tracer);
    tracer = null;
  }

  // Autosave about every 20 seconds.
  if (state.status === 'playing' && Math.floor(state.playSeconds) % 20 === 0 && frame % 60 === 0) {
    writeSave(state);
  }

  // Screenshot staging pins the car at 22 m/s so it never coasts away.
  if ((shot === 'play' || shot === 'night') && state.inCar && state.car) {
    state.car.speed = 22;
  }

  updateCityVisibility(camera);
  renderer.render(scene, camera);
  resetFrame();
}

start();
