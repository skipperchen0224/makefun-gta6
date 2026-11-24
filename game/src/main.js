// Main game: scene, player, camera, combat, main loop. Boots three.js,
// wires every module together, and stages the four dossier shot modes
// (?shot=start|play|combat|night). Round 5 plugs in the new systems: three
// guns with reloads (weapons.js), street-corner supply caches (pickups.js),
// a crew that shoots back, cops that route around buildings and set
// roadblocks, pause, story cards, and a combat screenshot.
import * as THREE from 'three';
import { WORLD, PLAYER, CAR, DRIFT, ARMOR, WEATHER, ECONOMY, MISSIONS, PLACES, KEYS, PALETTE, STORY, clamp, lerp, mulberry32 } from './config.js';
import { initInput, isDown, justPressed, mouseDown, mouseClicked, driveAxes, walkAxes, takeLook, takeZoom, resetFrame, clearHeld } from './input.js';
import { initAudio, resumeAudio, playGunshot, playPickup, playMissionDone, playFail, playCrash, playBusted, playHorn, playSwap, playSkid, playReload, rainStart, rainStop, engineStart, engineSet, engineStop, sirenStart, sirenStop } from './audio.js';
import { hasSave, loadSave, writeSave, clearSave } from './save.js';
import { buildCity, resolveCircleCollision, landmarkAt, updateCityVisibility, enableSunShadows, followSunShadow, setCityNight, randomRoadPoint, snapToRoad } from './city.js';
import { initVehicles, spawnPlayerCar, spawnTraffic, traffic, createCar, driveCar, nearestCar, explodeCar, updateTraffic, setVehicleNight } from './vehicles.js';
import { initPeds, spawnPeds, spawnHostileSquad, scarePeds, updatePeds, hitPed, getPeds, countHostilesUp, runOverPed, setRain } from './peds.js';
import { initWanted, getStars, onWantedChange, addCrime, forceStars, updateWanted, clearWanted, isEvading } from './wanted.js';
import { initCops, setNightMode as setCopsNight, alertTo, updateCops, damageCop, getCops, clearCops, anyCopSees, stageChase } from './cops.js';
import { initMissions, onMissionEvent, missionById, nextMissionId, getActiveId, startMission, updateMissions, objectiveText, setSquadLeft, getSquadLeft, updateSquadFire, getMissionBrief } from './missions.js';
import { initHud, setCash, setHealth, setArmor, setStars, setStarsEvading, setMission, setSpeed, setHelp, setCharacter, setClock, setWeather, setDrift, setMp, setWeapon, setCarHealth, showDialogue, setSaveSummary, showMessage, showBanner, showTitle, showEnd, hideEnd, drawMinimap } from './hud.js';
import { characterDef, otherCharacter, buildCharacterMesh } from './characters.js';
import { initWeather, setWeather as setWeatherKind, setHour, getWeather, isNight, getClockLabel, getWeatherLabel, onNight, updateWeather } from './weather.js';
import { initParticles, spawnSmoke, spawnSparks, runParticleSystem } from './ecs.js';
import { isBgmPlaying, setBgmMood, startBgm, stopBgm } from './bgm.js';
import { initMultiplayer, isMultiplayer, multiplayerCount, updateMultiplayer, sendWave } from './multiplayer.js';
import { initWeapons, currentWeapon, currentMag, currentReserve, isReloading, switchWeapon, canFire, consumeShot, startReload, updateWeapons, refillAmmo, serializeWeapons, deserializeWeapons, aimAssist } from './weapons.js';
import { initPickups, dropPickup, updatePickups, pickupLabel } from './pickups.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') || '';
const seed = Number(params.get('seed')) || 1;
const rng = mulberry32(seed * 7919 + 13);

const state = {
  status: 'title', cash: 500, hp: PLAYER.hp, armor: 0, character: 'lucia',
  bestDrift: 0, completed: [], bestWanted: 0, playSeconds: 0,
  inCar: false, car: null, myCar: null, speed: 0, shootCooldown: 0,
  committingCrime: false, tailCar: null, shotStart: performance.now(),
  shake: 0, camZoom: 1, lastHurt: 0, skidTimer: 0, hornCooldown: 0,
  mp: false, hudTimer: 0, lastWeather: 'clear', paused: false,
  shotDriven: 0, tracersDrawn: 0, combatShots: 0,
};

let renderer, scene, camera, clock;
let sun, hemi;
let playerMesh, playerHeading = Math.PI, camYaw = Math.PI, camPitch = 0.32;
const player = { x: 0, z: 100, heading: Math.PI };
const raycaster = new THREE.Raycaster();
let tracer = null;
let tracerTimer = null;
let frame = 0;

function buildPlayerMesh() {
  return buildCharacterMesh(state.character);
}

function swapCharacter(id) {
  if (id === state.character) return;
  state.character = id;
  if (playerMesh) scene.remove(playerMesh);
  playerMesh = buildPlayerMesh();
  playerMesh.position.set(player.x, 0, player.z);
  playerMesh.rotation.y = playerHeading;
  playerMesh.visible = !state.inCar;
  scene.add(playerMesh);
  const def = characterDef(id);
  state.hp = Math.min(state.hp, def.hp);
  state.armor = Math.min(state.armor, def.armorMax);
  if (state.car) state.car.grip = def.grip;
  setCharacter(def.name.toUpperCase(), def.tag);
  setHealth(state.hp);
  setArmor(state.armor, def.armorMax);
  setMission(objectiveText(state.completed, id));
  playSwap();
  showBanner(`${def.name} — ${def.tag}`);
  showMessage(def.blurb);
  writeSave({ ...state, ammo: serializeWeapons() });
}

function respawn() {
  const p = landmarkAt('spawn');
  player.x = p.x; player.z = p.z;
  playerHeading = Math.PI;
  camYaw = Math.PI;
  const def = characterDef(state.character);
  state.hp = def.hp;
  state.armor = 0;
  state.inCar = false;
  state.car = null;
  state.shake = 0;
}

function startGame() {
  resumeAudio();
  engineStart();
  state.status = 'playing';
  showTitle(false);
  hideEnd();
  if (!shotMode) showMessage('Welcome to Palmetto City — press E to start a mission, F to get in a car');
}

function enterCar(car) {
  state.inCar = true;
  state.car = car;
  car.isPlayer = true;
  car.grip = characterDef(state.character).grip;
  playerMesh.visible = false;
  setHelp('WASD drive · SPACE drift · F exit · H horn · Q swap lead');
  playPickup();
}

function exitCar() {
  const car = state.car;
  if (!car) return;
  car.isPlayer = false;
  const nx = car.x + Math.cos(car.heading) * 2.4;
  const nz = car.z - Math.sin(car.heading) * 2.4;
  const hit = resolveCircleCollision(nx, nz, PLAYER.radius);
  player.x = hit.x; player.z = hit.z;
  playerHeading = car.heading;
  state.inCar = false;
  state.car = null;
  playerMesh.visible = true;
  playerMesh.position.set(player.x, 0, player.z);
  playerMesh.rotation.y = playerHeading;
  setHelp('WASD move · SHIFT sprint · F enter car · CLICK shoot · E mission · Q swap lead');
}

function hurtPlayer(amount) {
  if (state.status !== 'playing') return;
  const absorbed = Math.min(state.armor, amount);
  state.armor -= absorbed;
  state.hp -= (amount - absorbed);
  state.lastHurt = performance.now() / 1000;
  state.shake = Math.min(1, state.shake + 0.22);
  const def = characterDef(state.character);
  setArmor(state.armor, def.armorMax);
  setHealth(state.hp);
  if (state.hp <= 0) wasted();
}

function addShake(amount) {
  state.shake = Math.min(1, state.shake + amount);
}

// Round 5 shooting: chest-high origin, 12-degree aim assist, thick glowing
// tracer + muzzle sparks, per-weapon damage / pellets / fire rate. Sprites
// never enter the raycast list (that used to crash it).
function shoot(aimOverride) {
  const now = performance.now() / 1000;
  if (state.shootCooldown > 0 || state.inCar) return;
  const weapon = currentWeapon();
  updateWeapons(now);
  if (isReloading()) return;
  if (currentMag() <= 0) {
    if (currentReserve() > 0) {
      startReload(now);
      playReload();
    }
    return;
  }
  if (!canFire(now)) return;
  state.shootCooldown = weapon.interval;
  consumeShot();
  playGunshot();
  addCrime('shoot');
  state.committingCrime = true;
  camPitch = clamp(camPitch + 0.018, 0.08, 1.1);
  addShake(0.1);
  const origin = new THREE.Vector3(player.x, 1.5, player.z);
  const forward = new THREE.Vector3();
  if (aimOverride) forward.copy(aimOverride);
  else camera.getWorldDirection(forward);
  const targets = [];
  for (const p of getPeds()) {
    if (p.state !== 'down') targets.push({ x: p.x, y: 1.2, z: p.z });
  }
  for (const c of getCops()) targets.push({ x: c.x, y: 1.0, z: c.z });
  for (const c of traffic) {
    if (!c.dead) targets.push({ x: c.x, y: 1.0, z: c.z });
  }
  const aim = aimAssist(origin, forward, targets);
  const dir = new THREE.Vector3(aim.x, aim.y, aim.z).normalize();
  const muzzle = origin.clone().addScaledVector(dir, 0.8);
  spawnSparks(muzzle.x, muzzle.y, muzzle.z);
  const meshes = [];
  const collectMeshes = (group) => group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const p of getPeds()) collectMeshes(p.mesh);
  for (const c of getCops()) collectMeshes(c.mesh);
  for (const c of traffic) collectMeshes(c.mesh);
  // Sprites (headlight glow) are never raycast: Sprite.raycast needs a
  // camera and throws without one, so only real meshes go in the list.
  raycaster.camera = camera;
  raycaster.set(origin, dir);
  raycaster.far = 120;
  const hits = raycaster.intersectObjects(meshes, true)
    .filter((h) => !h.object.isSprite && !h.object.isPoints);
  let end = origin.clone().addScaledVector(dir, 60);
  for (let pellet = 0; pellet < weapon.pellets; pellet++) {
    if (pellet === 0 && hits.length > 0) {
      const hit = hits[0];
      end = hit.point.clone();
      let top = hit.object;
      while (top.parent && top.parent !== scene) top = top.parent;
      const ped = getPeds().find((p) => p.mesh === top);
      if (ped) {
        const result = hitPed(ped, weapon.damage);
        if (result === 'down') {
          if (ped.hostile) {
            addCrime('hurtPed');
            setSquadLeft(countHostilesUp());
            dropPickup(ped.x, ped.z, Math.random() < 0.5 ? 'ammo' : 'cash');
            showMessage('Crew member down — ' + countHostilesUp() + ' left');
          } else {
            addCrime('killPed');
            showMessage('The police noticed that.');
          }
        }
      } else {
        const cop = getCops().find((c) => c.mesh === top);
        if (cop) {
          if (damageCop(cop, weapon.damage)) {
            addCrime('ramCop');
            dropPickup(cop.x, cop.z, 'armor');
            showMessage('Cop car knocked out — armour dropped');
          }
        } else {
          const car = traffic.find((c) => c.mesh === top);
          if (car) {
            car.hp -= weapon.damage;
            spawnSparks(end.x, end.y, end.z);
            if (car.hp <= 0 && !car.dead) {
              explodeCar(car);
              addCrime('shoot');
              playCrash();
            }
          }
        }
      }
    }
  }
  if (hits.length === 0) scarePeds(player.x, player.z, 50);
  else spawnSparks(end.x, end.y, end.z);
  drawTracer(muzzle, end);
}

function drawTracer(from, to, ms = 150) {
  // In shot modes the renderer runs at a fraction of a frame per second, so
  // a 150 ms tracer would never survive to the captured frame; hold it 30 s
  // and keep earlier tracers too, so the firefight reads in the still.
  // The tracer is pure white, thick enough to read against pale road.
  if (shotMode) {
    ms = 30000;
  } else if (tracer) {
    scene.remove(tracer);
    if (tracerTimer) clearTimeout(tracerTimer);
  }
  const len = from.distanceTo(to);
  if (len < 0.1) return;
  const geo = new THREE.CylinderGeometry(0.09, 0.09, len, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
  tracer = new THREE.Mesh(geo, mat);
  tracer.position.copy(from).add(to).multiplyScalar(0.5);
  const dir = to.clone().sub(from).normalize();
  tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  scene.add(tracer);
  state.tracersDrawn += 1;
  const m = tracer;
  tracerTimer = setTimeout(() => {
    if (tracer === m) { scene.remove(m); tracer = null; }
  }, ms);
}

function missionCtx() {
  return {
    spawnSquad: (x, z, n) => spawnHostileSquad(x, z, n),
    spawnTailTarget,
    forceStars: (n) => forceStars(n),
  };
}

function tryStartMission() {
  const id = nextMissionId(state.completed);
  if (id === 0) {
    showMessage('All missions complete — free roam!');
    return;
  }
  const m = missionById(id);
  if (startMission(id, missionCtx())) {
    showBanner(`${m.id}. ${m.name}`);
    showMessage(getMissionBrief(m.id, state.character));
    playPickup();
  }
}

function spawnTailTarget() {
  const p = randomRoadPoint(rng);
  const heading = p.axis === 'x' ? Math.PI / 2 : 0;
  const car = createCar(0xd9a441, p.x, p.z, heading);
  car.cruise = 13;
  state.tailCar = car;
  traffic.push(car);
  return car;
}

function spawnMissionCar(point) {
  const car = createCar(0xd9a441, point.x, point.z, point.axis === 'x' ? Math.PI / 2 : 0);
  car.cruise = 13;
  state.tailCar = car;
  traffic.push(car);
  return car;
}

function busted(reason) {
  if (state.status !== 'playing') return;
  state.status = 'busted';
  playBusted();
  sirenStop();
  engineSet(0, false);
  state.cash = Math.max(0, state.cash - 150);
  state.armor = 0;
  clearWanted();
  showEnd('BUSTED', `${reason || 'The Palmetto PD took you in'} — $150 bail. Press R to get back out there.`);
  setCash(state.cash);
  setArmor(0, characterDef(state.character).armorMax);
  writeSave({ ...state, ammo: serializeWeapons() });
}

function wasted() {
  if (state.status !== 'playing') return;
  state.status = 'wasted';
  playFail();
  sirenStop();
  engineSet(0, false);
  state.armor = 0;
  showEnd('WASTED', 'Palmetto City chewed you up. Press R to try again.');
  setArmor(0, characterDef(state.character).armorMax);
  writeSave({ ...state, ammo: serializeWeapons() });
}

function restart() {
  hideEnd();
  clearCops();
  respawn();
  state.status = 'playing';
  setHealth(state.hp);
  setArmor(state.armor, characterDef(state.character).armorMax);
  showMessage('Back on the streets — stay sharp.');
  engineStart();
}

// Round 5 staging. play/night park the player car on the avenue where the
// cops cannot ram it during the shot (ram damage is off in shot modes),
// and the roadblock goes in ahead of the car, not at the spawn. combat is
// a side-on SMG firefight; night is a 5-star storm.
function stageShot() {
  state.shotStart = performance.now();
  window.__shotReady = false;
  if (shotMode === 'start') {
    camera.position.set(-40, 90, 190);
    camera.lookAt(40, 0, -40);
    showTitle(true);
    return;
  }
  if (shotMode === 'play') {
    startGame();
    const car = state.myCar;
    car.x = 0; car.z = -40; car.heading = Math.PI; car.speed = 22;
    car.mesh.position.set(0, 0, -40);
    car.mesh.rotation.y = Math.PI;
    player.x = 0; player.z = -40; playerHeading = Math.PI;
    enterCar(car);
    forceStars(3);
    stageChase({ x: 0, z: -40, heading: Math.PI });
    startMission(1, missionCtx());
    camYaw = Math.PI;
    return;
  }
  if (shotMode === 'combat') {
    startGame();
    switchWeapon(1, 99); // SMG, unlocked for the shot
    refillAmmo();
    player.x = 20; player.z = 76; playerHeading = 0;
    playerMesh.position.set(20, 0, 76);
    playerMesh.rotation.y = 0;
    camYaw = 1.15;
    startMission(5, missionCtx());
    forceStars(1);
    // Park bystanders 60 m behind the player, away from the firing lane, so
    // the dossier tracer runs the full distance to a crew member instead of
    // clipping a passer-by. (60 m, not further: past 190 m updatePeds would
    // teleport them straight back next to the player.)
    const squad = getPeds().filter((p) => p.hostile && p.state !== 'down');
    if (squad.length > 0) {
      const t = squad[0];
      const dx = t.x - player.x, dz = t.z - player.z;
      const d = Math.hypot(dx, dz) || 1;
      const bx = player.x - (dx / d) * 60, bz = player.z - (dz / d) * 60;
      for (const p of getPeds()) {
        if (!p.hostile) { p.x = bx + (Math.random() - 0.5) * 20; p.z = bz + (Math.random() - 0.5) * 20; }
      }
    }
    return;
  }
  if (shotMode === 'night') {
    startGame();
    setHour(22.5);
    setWeatherKind('storm');
    state.lastWeather = 'storm';
    const car = state.myCar;
    car.x = 0; car.z = -40; car.heading = Math.PI; car.speed = 22;
    car.mesh.position.set(0, 0, -40);
    car.mesh.rotation.y = Math.PI;
    player.x = 0; player.z = -40; playerHeading = Math.PI;
    enterCar(car);
    forceStars(5);
    stageChase({ x: 0, z: -40, heading: Math.PI });
    startMission(6, missionCtx());
    camYaw = Math.PI;
    return;
  }
  if (shotMode === 'end') {
    startGame();
    respawn();
    player.x = 0; player.z = 60;
    playerMesh.position.set(0, 0, 60);
    forceStars(5);
    busted('Surrounded on the avenue');
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
  scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 180, 520);
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(0, 60, 160);
  camera.lookAt(0, 0, 0);
  sun = new THREE.DirectionalLight(0xfff2d9, 2.6);
  sun.position.set(120, 180, 60);
  scene.add(sun);
  scene.add(sun.target);
  enableSunShadows(sun);
  hemi = new THREE.HemisphereLight(0x8ec9e8, 0x9a8a6a, 0.5);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xa8c4d4, 0.9);
  scene.add(amb);
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
  initWeapons(0);
  initPickups(scene, seed);
  onNight((night) => {
    amb.intensity = night ? 0.5 : 0.9;
    amb.color.setHex(night ? 0x8fb4ff : 0xa8c4d4);
    setCityNight(night);
    setVehicleNight(night);
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
    initWeapons(saved.completed.length);
    if (saved.ammo) deserializeWeapons(saved.ammo);
    setSaveSummary(`Save: $${state.cash} · ${state.completed.length}/6 missions · best ${state.bestWanted}★ — click to continue, N for a new game`);
  }
  respawn();
  if (saved) state.armor = saved.armor; // respawn zeroes armour; the save keeps it
  playerMesh = buildPlayerMesh();
  playerMesh.position.set(player.x, 0, player.z);
  scene.add(playerMesh);
  state.myCar = spawnPlayerCar(6, 96);
  state.myCar.grip = characterDef(state.character).grip;
  spawnTraffic(18);
  spawnPeds(28);
  state.mp = initMultiplayer(scene, {
    charId: () => state.character,
    onEvent: (evt) => {
      if (evt.type === 'chat' || evt.type === 'wave') showMessage(evt.text, 3600);
      else if (evt.type === 'mp') showMessage(evt.text, 3600);
    },
  });
  onWantedChange((stars) => {
    setStars(stars);
    state.bestWanted = Math.max(state.bestWanted, stars);
    if (stars >= 1) sirenStart();
    else sirenStop();
    if (stars >= 3) {
      showMessage('The whole department is on you now.');
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
      showBanner(`Mission complete — +$${evt.reward}`);
      playMissionDone();
      const card = STORY[Math.min(state.completed.length - 1, STORY.length - 1)];
      if (card) showDialogue(card.who, card.line);
      writeSave({ ...state, ammo: serializeWeapons() });
    } else if (evt.type === 'fail') {
      showBanner(`Mission failed — ${evt.reason}`);
      playFail();
    } else if (evt.type === 'start') {
      setMission(objectiveText(state.completed, state.character));
    }
  });
  setCash(state.cash);
  setHealth(state.hp);
  setArmor(state.armor, characterDef(state.character).armorMax);
  setStars(0);
  const def = characterDef(state.character);
  setCharacter(def.name.toUpperCase(), def.tag);
  setClock('10:30');
  setWeather('Clear');
  setMission(objectiveText(state.completed, state.character));
  setHelp('Click to start · WASD move · F enter car · CLICK shoot · Q swap lead');
  document.getElementById('title-screen').addEventListener('click', () => {
    if (state.status === 'title') startGame();
  });
  if (shotMode) stageShot();
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  initInput(renderer.domElement);
  clock = new THREE.Clock();
  loop();
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  frame += 1;
  if (state.status === 'playing') state.playSeconds += dt;
  const look = takeLook();
  camYaw -= look.dx * 0.0032;
  camPitch = clamp(camPitch + look.dy * 0.0022, 0.08, 1.1);
  state.camZoom = clamp(state.camZoom + takeZoom() * 0.12, 0.75, 1.6);

  if (state.status === 'title') {
    if (justPressed('Enter') || mouseClicked()) startGame();
    if (justPressed(KEYS.newGame)) {
      clearSave();
      state.cash = 500; state.completed = []; state.bestWanted = 0;
      state.playSeconds = 0; state.armor = 0; state.bestDrift = 0;
      initWeapons(0);
      setSaveSummary('');
      setCash(500);
      startGame();
    }
  } else if (state.status === 'playing') {
    if (justPressed(KEYS.pause)) {
      state.paused = !state.paused;
      clearHeld();
      showMessage(state.paused ? 'Paused — press P to resume' : 'Back in it.', state.paused ? 999999 : 2000);
    }
    if (!state.paused) {
      if (justPressed(KEYS.enterCar)) {
        if (state.inCar) exitCar();
        else {
          const car = nearestCar(player.x, player.z, 6, state.myCar) || (state.myCar && !state.myCar.dead && Math.hypot(state.myCar.x - player.x, state.myCar.z - player.z) < 6 ? state.myCar : null);
          if (car) {
            enterCar(car);
            if (car !== state.myCar && !car.isCop) {
              addCrime('steal');
              showMessage('Nice ride. The owner disagrees.');
            }
          }
        }
      }
      if (justPressed(KEYS.swapChar)) swapCharacter(otherCharacter(state.character));
      if (justPressed(KEYS.music)) {
        if (isBgmPlaying()) { stopBgm(); showMessage('Music off'); }
        else if (startBgm()) showMessage('Palmetto Nights FM — on');
      }
      if (justPressed(KEYS.wave) && state.mp) sendWave();
      if (justPressed('Digit1')) { if (switchWeapon(0, state.completed.length)) showMessage('Pistol'); }
      if (justPressed('Digit2')) {
        const w = switchWeapon(1, state.completed.length);
        showMessage(w ? 'SMG' : 'SMG unlocks after 3 missions');
      }
      if (justPressed('Digit3')) {
        const w = switchWeapon(2, state.completed.length);
        showMessage(w ? 'Shotgun' : 'Shotgun unlocks after 4 missions');
      }
      if (justPressed(KEYS.reload) && !state.inCar) {
        if (startReload(performance.now() / 1000)) playReload();
      }
      if (justPressed('KeyE')) tryStartMission();
      if (!state.inCar && (currentWeapon().auto ? mouseDown() : mouseClicked())) shoot();
      // Round 5 combat staging: the player fires at the crew on a timer so
      // the shot shows tracers; stops with two crew left so the job stays live.
      if (shotMode === 'combat' && countHostilesUp() > 2) {
        state.combatShots += dt;
        if (state.combatShots > 0.45) {
          state.combatShots = 0;
          const squad = getPeds().filter((p) => p.hostile && p.state !== 'down');
          if (squad.length > 0) {
            const target = squad[0];
            const dir = new THREE.Vector3(target.x - player.x, 1.2 - 1.5, target.z - player.z).normalize();
            shoot(dir);
          }
        }
      }
      if (state.inCar && justPressed(KEYS.horn) && state.hornCooldown <= 0) {
        state.hornCooldown = 1.2;
        playHorn();
        scarePeds(player.x, player.z, 25);
        const near = getCops().some((c) => Math.hypot(c.x - player.x, c.z - player.z) < 25);
        if (near) { addCrime('reckless'); showMessage('The police heard that.'); }
        else showMessage('Beep beep.');
      }
    }
  } else if (state.status === 'busted' || state.status === 'wasted') {
    if (justPressed(KEYS.restart)) restart();
  }
  state.hornCooldown = Math.max(0, state.hornCooldown - dt);

  if (!state.paused) {
    // Movement.
    if (state.status === 'playing' && !state.paused) {
      if (state.inCar && state.car) {
        const axes = driveAxes();
        const driven = driveCar(state.car, dt, axes.throttle, axes.steer, axes.brake);
        state.speed = state.car.speed;
        player.x = state.car.x;
        player.z = state.car.z;
        playerHeading = state.car.heading;
        camYaw = lerp(camYaw, state.car.heading, 1 - Math.pow(0.001, dt));
        if (shotMode === 'play' || shotMode === 'night') {
          state.car.speed = 22; // staging pins the speed for the shot
          state.shotDriven += driven;
        }
        if (Math.abs(state.speed) > 3 && state.car.hp <= 0) playCrash();
        engineSet(Math.abs(state.speed) / CAR.maxSpeed, true);
        if (state.car.drifting) {
          const bx = state.car.x - Math.sin(state.car.heading) * 2;
          const bz = state.car.z - Math.cos(state.car.heading) * 2;
          spawnSmoke(bx, 0.3, bz, 1);
          state.skidTimer -= dt;
          if (state.skidTimer <= 0) { playSkid(); state.skidTimer = 0.5; }
          setDrift(state.car.driftScore);
        } else {
          setDrift(0);
        }
        if (state.car.lastBanked > 0) {
          const cash = Math.round(state.car.lastBanked * DRIFT.cashPerPoint);
          state.cash += cash;
          state.bestDrift = Math.max(state.bestDrift, state.car.lastBanked);
          setCash(state.cash);
          showMessage(`Drift banked +$${cash}`);
          state.car.lastBanked = 0;
          const near = getCops().some((c) => Math.hypot(c.x - player.x, c.z - player.z) < 40);
          if (near) { addCrime('reckless'); alertTo(player.x, player.z); }
          writeSave({ ...state, ammo: serializeWeapons() });
        }
      } else {
        const axes = walkAxes();
        const def = characterDef(state.character);
        const speed = axes.sprint ? def.runSpeed : def.walkSpeed;
        const moving = axes.x !== 0 || axes.z !== 0;
        if (moving) {
          const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
          const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
          let mx = fx * axes.z + rx * axes.x;
          let mz = fz * axes.z + rz * axes.x;
          const len = Math.hypot(mx, mz) || 1;
          mx /= len; mz /= len;
          const hit = resolveCircleCollision(player.x + mx * speed * dt, player.z + mz * speed * dt, PLAYER.radius);
          player.x = hit.x;
          player.z = hit.z;
          playerHeading = Math.atan2(mx, mz);
          playerMesh.position.set(player.x, 0, player.z);
          playerMesh.rotation.y = playerHeading;
          state.speed = speed;
        } else {
          state.speed = 0;
        }
        engineSet(0, false);
      }
      // Running a ped over counts as a knockdown.
      if (state.inCar && Math.abs(state.speed) > 5) {
        for (const p of getPeds()) {
          if (p.state === 'down') continue;
          const dx = p.x - player.x, dz = p.z - player.z;
          if (dx * dx + dz * dz < 2.4 * 2.4) {
            if (runOverPed(p) === 'down') {
              if (p.hostile) {
                setSquadLeft(countHostilesUp());
                dropPickup(p.x, p.z, 'cash');
                showMessage('Ran one over — ' + countHostilesUp() + ' left');
              } else {
                addCrime('killPed');
              }
            }
          }
        }
      }
    }

    // Weather, clock, rain.
    updateWeather(dt, camera.position);
    followSunShadow(sun, player.x, player.z);
    state.hudTimer += dt;
    if (state.hudTimer > 0.5) {
      state.hudTimer = 0;
      setClock(getClockLabel());
      setWeather(getWeatherLabel());
    }
    const wet = getWeather() !== 'clear';
    if (getWeather() !== state.lastWeather) {
      setRain(wet);
      if (wet) {
        rainStart();
        showMessage(getWeather() === 'storm' ? 'Storm rolling in — drive careful.' : 'Rain on the avenue.');
      } else {
        rainStop();
      }
      state.lastWeather = getWeather();
    }

    // Armour regrows after a quiet stretch.
    if (state.status === 'playing' && performance.now() / 1000 - state.lastHurt > ARMOR.regenDelay) {
      const def = characterDef(state.character);
      if (state.armor < def.armorMax) {
        state.armor = Math.min(def.armorMax, state.armor + ARMOR.regenRate * dt);
        setArmor(state.armor, def.armorMax);
      }
    }

    // World systems.
    if (state.status === 'playing' || state.status === 'title') {
      const blockers = [];
      if (state.inCar && state.car) blockers.push({ x: state.car.x, z: state.car.z });
      for (const c of getCops()) blockers.push({ x: c.x, z: c.z });
      updateTraffic(dt, player.x, player.z, blockers);
      updatePeds(dt, player.x, player.z, state.inCar, state.speed);
    }
    runParticleSystem(dt);
    if (state.mp) {
      updateMultiplayer(dt, { x: player.x, z: player.z, heading: playerHeading, inCar: state.inCar, char: state.character, stars: getStars() });
      setMp(`MP · ${multiplayerCount()} online`);
    } else {
      setMp('');
    }

    if (state.status === 'playing' && !state.paused) {
      state.shootCooldown = Math.max(0, state.shootCooldown - dt);
      updateWeapons(performance.now() / 1000);
      const seen = anyCopSees(player);
      updateWanted(dt, state.committingCrime, seen);
      setStarsEvading(isEvading());
      state.committingCrime = false;
      updateCops(dt, getStars(), { x: player.x, z: player.z, inCar: state.inCar, speed: state.speed, heading: playerHeading }, (reason) => busted(reason), (dist) => hurtPlayer(dist < 25 ? 9 : 4));
      // Cop rams the player's car; skipped in shot modes so the staged car survives.
      if (state.inCar && state.car && !shotMode) {
        for (const cop of getCops()) {
          const d = Math.hypot(cop.x - player.x, cop.z - player.z);
          if (d < 5.5 && Math.abs(cop.speed) > 6) {
            state.car.hp -= 60 * dt;
            addShake(0.3);
            if (state.car.hp <= 0 && !state.car.dead) {
              explodeCar(state.car);
              exitCar();
              hurtPlayer(20);
              showMessage('Your car is wrecked!');
              playCrash();
            }
          }
        }
        for (const other of traffic) {
          if (other === state.car || other.dead) continue;
          const d = Math.hypot(other.x - player.x, other.z - player.z);
          if (d < 4.6) {
            state.car.speed *= 0.94;
            other.speed = 0;
          }
        }
      }
      if (state.tailCar) {
        const t = state.tailCar;
        t.x += Math.sin(t.heading) * t.cruise * dt;
        t.z += Math.cos(t.heading) * t.cruise * dt;
        if (Math.abs(t.x) > 230 || Math.abs(t.z) > 230) t.heading += Math.PI;
        t.mesh.position.set(t.x, 0, t.z);
        t.mesh.rotation.y = t.heading;
      }
      updateSquadFire(dt, { x: player.x, z: player.z, inCar: state.inCar, speed: state.speed }, (hit, ped) => {
        const from = new THREE.Vector3(ped.x, 1.4, ped.z);
        const to = new THREE.Vector3(player.x, 1.4, player.z);
        drawTracer(from, to, 150);
        playGunshot();
        if (hit) hurtPlayer(8);
      });
      updateMissions(dt, {
        px: player.x, pz: player.z, inCar: state.inCar, speed: state.speed,
        stars: getStars(), squadLeft: getSquadLeft(), targetCar: state.tailCar, dt,
      });
      if (getActiveId() === 0) state.tailCar = null;
      setMission(objectiveText(state.completed, state.character));
      updatePickups(dt, player.x, player.z, (kind) => {
        const def = characterDef(state.character);
        if (kind === 'health') state.hp = Math.min(def.hp, state.hp + 40);
        if (kind === 'armor') state.armor = Math.min(def.armorMax, state.armor + 50);
        if (kind === 'ammo') refillAmmo();
        if (kind === 'cash') { state.cash += 150; setCash(state.cash); }
        setHealth(state.hp);
        setArmor(state.armor, def.armorMax);
        showMessage(pickupLabel(kind));
        playPickup();
      });
      const weapon = currentWeapon();
      setWeapon(weapon.name, currentMag(), currentReserve(), isReloading());
      setCarHealth(state.car ? state.car.hp : 0, state.inCar);
    }
  }

  // Camera.
  state.shake = Math.max(0, state.shake - 1.4 * dt);
  if (state.status !== 'title' || shotMode !== 'start') {
    const follow = state.inCar && state.car ? state.car : player;
    const heading = state.inCar && state.car ? state.car.heading : camYaw;
    const dist = (state.inCar ? 11 : 7.5) * state.camZoom;
    const height = (state.inCar ? 4.4 : 3.2) * state.camZoom + Math.sin(camPitch) * 2.5;
    const tx = follow.x - Math.sin(heading) * dist;
    const tz = follow.z - Math.cos(heading) * dist;
    const k = 1 - Math.pow(0.0001, dt);
    camera.position.x += (tx - camera.position.x) * k;
    camera.position.y += (height - camera.position.y) * k;
    camera.position.z += (tz - camera.position.z) * k;
    const sh = state.shake * state.shake * 0.55;
    camera.position.x += (Math.random() - 0.5) * sh;
    camera.position.y += (Math.random() - 0.5) * sh;
    camera.lookAt(follow.x, state.inCar ? 1.6 : 1.4, follow.z);
  }

  // HUD: speed, health, minimap.
  if (state.status === 'playing') {
    setSpeed(Math.abs(state.speed) * 3.6);
    setHealth(state.hp);
  }
  if (state.status === 'playing' || state.status === 'busted' || state.status === 'wasted') {
    let objective = null;
    const active = getActiveId();
    if (active) objective = landmarkAt(missionById(active).place);
    else {
      const next = nextMissionId(state.completed);
      if (next) objective = landmarkAt(missionById(next).place);
    }
    drawMinimap({
      player: { x: player.x, z: player.z, heading: playerHeading },
      traffic, cops: getCops(), objective,
    });
  }

  // Autosave about every 20 s.
  if (state.status === 'playing' && Math.floor(state.playSeconds) % 20 === 0 && frame % 60 === 0) {
    writeSave({ ...state, ammo: serializeWeapons() });
  }

  // Shot readiness: play/night fire on distance driven (40 m), not frames.
  if (shotMode && !window.__shotReady) {
    const elapsed = performance.now() - state.shotStart;
    if (shotMode === 'start' || shotMode === 'end') {
      if (elapsed > 1400) window.__shotReady = true;
    } else if (shotMode === 'play' || shotMode === 'night') {
      if (state.shotDriven >= 40) window.__shotReady = true;
    } else if (shotMode === 'combat') {
      if (elapsed > 2500 && state.tracersDrawn >= 2) window.__shotReady = true;
    }
  }

  updateCityVisibility(camera);
  renderer.render(scene, camera);
  resetFrame();
}

boot();
