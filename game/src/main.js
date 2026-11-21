// Palmetto Heat — main game: scene, player, camera, combat, main loop.
// Boots three.js, wires every module together, and stages the four dossier
// screenshot modes (?shot=start|play|end|night). This round's new systems:
// dual leads (Q swaps Lucia and Jason), armour, drift scoring with tyre
// smoke, camera shake and gun recoil, the weather day/night cycle, synthwave
// BGM (M), the ECS particle system, and the optional WebSocket lobby (?mp=1).

import * as THREE from 'three';
import { PLAYER, CAR, DRIFT, ARMOR, WEATHER, PLACES, KEYS, PALETTE, clamp, mulberry32 } from './config.js';
import { initInput, justPressed, mouseClicked, driveAxes, walkAxes, takeLook, takeZoom, resetFrame } from './input.js';
import { initAudio, resumeAudio, playGunshot, playPickup, playMissionDone, playFail, playCrash, playBusted, playHorn, playSwap, playSkid, rainStart, rainStop, engineStart, engineSet, engineStop, sirenStart, sirenStop } from './audio.js';
import { loadSave, writeSave } from './save.js';
import { buildCity, setNightMode as setCityNight, updateCityVisibility, resolveCircleCollision, randomRoadPoint } from './city.js';
import { initVehicles, spawnPlayerCar, spawnTraffic, createCar, driveCar, updateTraffic, nearestCar, explodeCar, setNightMode as setVehiclesNight, traffic } from './vehicles.js';
import { initPeds, spawnPeds, spawnHostileSquad, scarePeds, updatePeds, hitPed, getPeds, setRain } from './peds.js';
import { initWanted, getStars, onWantedChange, addCrime, forceStars, updateWanted, clearWanted } from './wanted.js';
import { initCops, setNightMode as setCopsNight, updateCops, damageCop, getCops, clearCops, alertTo } from './cops.js';
import { initMissions, onMissionEvent, nextMissionId, getActiveId, getSquadLeft, setSquadLeft, startMission, updateMissions, objectiveText, getMissionBrief, missionById } from './missions.js';
import { initHud, setCash, setHealth, setArmor, setStars, setMission, setSpeed, setHelp, setCharacter, setClock, setWeather, setDrift, setMp, showMessage, showBanner, showTitle, showEnd, hideEnd, drawMinimap } from './hud.js';
import { characterDef, otherCharacter, buildCharacterMesh } from './characters.js';
import { initWeather, setWeather as setWeatherKind, setHour, getWeather, isNight, getClockLabel, getWeatherLabel, onNight, updateWeather } from './weather.js';
import { initParticles, spawnSmoke, spawnSparks, runParticleSystem } from './ecs.js';
import { setBgmMood, startBgm, stopBgm, isBgmPlaying } from './bgm.js';
import { initMultiplayer, isMultiplayer, multiplayerCount, updateMultiplayer, sendWave } from './multiplayer.js';

const params = new URLSearchParams(location.search);
const shot = params.get('shot') || '';
const seedRaw = parseInt(params.get('seed') || '1', 10);
const seed = Number.isNaN(seedRaw) ? 1 : seedRaw;
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
  car: null,
  myCar: null,
  speed: 0,
  shootCooldown: 0,
  committingCrime: false,
  tailTarget: null,
  startTime: performance.now(),
  shotTime: 0,
  shake: 0,
  camZoom: 1,
  lastHurtAt: 0,
  skidTimer: 0,
  hornCooldown: 0,
  mpOn: false,
  hudTimer: 0,
  lastWeather: 'clear',
};

let renderer, scene, camera, clock;
let sun, hemi, ambient;
let playerMesh = null;
let playerHeading = Math.PI;
let camYaw = Math.PI;
let camPitch = 0.32;
const player = { x: 0, z: 0, heading: Math.PI };
let raycaster, tracer = null, tracerUntil = 0;
let frameCount = 0;

function saveState() {
  return {
    cash: state.cash,
    completed: state.completed,
    bestWanted: state.bestWanted,
    playSeconds: state.playSeconds,
    character: state.character,
    armor: state.armor,
    bestDrift: state.bestDrift,
  };
}

function missionCtx() {
  return {
    spawnSquad: (x, z, n) => spawnHostileSquad(x, z, n),
    spawnTailTarget: () => spawnTailTargetCar(),
    forceStars: (n) => forceStars(n),
  };
}

function buildPlayerMesh() {
  return buildCharacterMesh(state.character);
}

function swapCharacter(id) {
  if (id === state.character) return;
  state.character = id;
  const def = characterDef(id);
  if (playerMesh) scene.remove(playerMesh);
  playerMesh = buildPlayerMesh();
  playerMesh.position.set(player.x, 0, player.z);
  playerMesh.rotation.y = player.heading;
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
  writeSave(saveState());
}

function respawnToSpawn() {
  const spawn = PLACES.spawn;
  player.x = spawn.x;
  player.z = spawn.z;
  player.heading = Math.PI;
  camYaw = Math.PI;
  const def = characterDef(state.character);
  state.hp = def.hp;
  state.armor = 0;
  state.inCar = false;
  state.car = null;
  state.shake = 0;
}

function startGame() {
  if (state.status !== 'title') return;
  resumeAudio();
  engineStart();
  state.status = 'playing';
  showTitle(false);
  hideEnd();
  if (!shot) showMessage('欢迎来到棕榈城，按 E 开始任务，按 F 上车');
}

function enterCar(car) {
  state.inCar = true;
  state.car = car;
  car.isPlayer = true;
  car.grip = characterDef(state.character).grip;
  playerMesh.visible = false;
  setHelp('WASD 开车、空格漂移、F 下车、H 喇叭、Q 换主角');
  playPickup();
}

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
  playerMesh.visible = true;
  playerMesh.position.set(player.x, 0, player.z);
  playerMesh.rotation.y = player.heading;
  setHelp('WASD 移动、Shift 跑、F 上车、点击开枪、E 任务、Q 换主角');
}

function hurtPlayer(amount) {
  if (state.status !== 'playing') return;
  const absorbed = Math.min(state.armor, amount);
  state.armor -= absorbed;
  state.hp -= (amount - absorbed);
  state.lastHurtAt = performance.now() / 1000;
  addShake(0.22);
  const def = characterDef(state.character);
  setArmor(state.armor, def.armorMax);
  setHealth(state.hp);
  if (state.hp <= 0) wastePlayer();
}

function addShake(amount) {
  state.shake = Math.min(1, state.shake + amount);
}

function shoot() {
  if (state.shootCooldown > 0 || state.inCar) return;
  state.shootCooldown = 0.28;
  playGunshot();
  addCrime('shoot');
  state.committingCrime = true;
  camPitch = clamp(camPitch + 0.018, 0.08, 1.1);
  addShake(0.1);
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const targets = [];
  for (const p of getPeds()) if (p.state !== 'down') targets.push(p.mesh);
  for (const c of getCops()) targets.push(c.mesh);
  for (const c of traffic) if (!c.dead) targets.push(c.mesh);
  const hits = raycaster.intersectObjects(targets, true);
  const origin = new THREE.Vector3(player.x, 1.5, player.z);
  let end;
  if (hits.length > 0) end = hits[0].point.clone();
  else end = raycaster.ray.at(60, new THREE.Vector3());
  drawTracer(origin, end);
  if (!hits.length) return;
  spawnSparks(end.x, end.y, end.z);
  scarePeds(player.x, player.z, 50);
  let top = hits[0].object;
  while (top.parent && top.parent !== scene) top = top.parent;
  const ped = getPeds().find((p) => p.mesh === top);
  if (ped) {
    const res = hitPed(ped, 1);
    if (res === 'down') {
      addCrime(ped.hostile ? 'hurtPed' : 'killPed');
      if (ped.hostile) {
        setSquadLeft(Math.max(0, getSquadLeft() - 1));
        showMessage('敌对分子倒下了');
      } else {
        showMessage('平民倒下了，警察注意到了！');
      }
    }
    return;
  }
  const cop = getCops().find((c) => c.mesh === top);
  if (cop) {
    const killed = damageCop(cop, 34);
    if (killed) {
      addCrime('killPed');
      showMessage('警车被击毁了！');
    }
    return;
  }
  const car = traffic.find((c) => c.mesh === top);
  if (car) {
    car.hp -= 34;
    if (car.hp <= 0) {
      explodeCar(car);
      if (car.isCop) addCrime('reckless');
      showMessage('车辆爆炸了！');
    }
    return;
  }
}

function drawTracer(a, b) {
  if (tracer) scene.remove(tracer);
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  tracer = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xffe9a8, transparent: true, opacity: 0.9,
  }));
  scene.add(tracer);
  tracerUntil = performance.now() + 90;
}

function tryStartMission() {
  const id = nextMissionId(state.completed);
  if (id === 0) {
    showMessage('全部任务完成，自由漫游吧！');
    return;
  }
  const ok = startMission(id, missionCtx());
  if (ok) {
    const m = missionById(id);
    showBanner(`任务 ${id}：${m.name}`);
    showMessage(getMissionBrief(id, state.character));
    playPickup();
  }
}

function spawnTailTargetCar() {
  const pt = randomRoadPoint(rng);
  return spawnMissionTraffic(pt);
}

function spawnMissionTraffic(pt) {
  const heading = pt.axis === 'x' ? Math.PI / 2 : 0;
  const car = createCar(0xe8c81a, pt.x, pt.z, heading);
  car.cruise = 13;
  car.tailTarget = true;
  traffic.push(car);
  state.tailTarget = car;
  return car;
}

function bustPlayer(reason) {
  if (state.status !== 'playing') return;
  state.status = 'busted';
  playBusted();
  sirenStop();
  engineStop();
  state.cash = Math.max(0, state.cash - 150);
  state.armor = 0;
  clearWanted();
  showEnd('BUSTED', `${reason}，警察带走了你。保释 $150，按 R 回去。`);
  setCash(state.cash);
  setArmor(state.armor, characterDef(state.character).armorMax);
  writeSave(saveState());
}

function wastePlayer() {
  if (state.status !== 'playing') return;
  state.status = 'wasted';
  playFail();
  sirenStop();
  engineStop();
  state.armor = 0;
  showEnd('WASTED', '棕榈城把你嚼碎了。按 R 再试一次。');
  setArmor(state.armor, characterDef(state.character).armorMax);
  writeSave(saveState());
}

function restart() {
  hideEnd();
  clearCops();
  respawnToSpawn();
  state.status = 'playing';
  const def = characterDef(state.character);
  setHealth(state.hp);
  setArmor(state.armor, def.armorMax);
  showMessage('回到街头，保持警惕。');
  engineStart();
}

function stageShot() {
  state.shotTime = performance.now();
  window.__shotReady = false;
  if (shot === 'start') {
    camera.position.set(-40, 90, 190);
    camera.lookAt(40, 0, -40);
    showTitle(true);
  } else if (shot === 'play') {
    startGame();
    const car = state.myCar;
    car.x = 0;
    car.z = -40;
    car.heading = Math.PI;
    car.speed = 22;
    car.mesh.position.set(0, 0, -40);
    car.mesh.rotation.y = Math.PI;
    enterCar(car);
    forceStars(2);
    startMission(1, missionCtx());
    camYaw = Math.PI;
  } else if (shot === 'end') {
    startGame();
    respawnToSpawn();
    player.x = 0;
    player.z = 60;
    playerMesh.position.set(0, 0, 60);
    forceStars(5);
    bustPlayer('在大道上被包围');
  } else if (shot === 'night') {
    startGame();
    setHour(22.5);
    setWeatherKind('storm');
    // Seed the clock and weather chips now: at software-render frame rates
    // the 0.5s HUD refresh can lag several seconds behind the staged hour.
    setClock(getClockLabel());
    setWeather(getWeatherLabel());
    state.lastWeather = 'storm';
    rainStart();
    setRain(true);
    const car = state.myCar;
    car.x = 0;
    car.z = -40;
    car.heading = Math.PI;
    car.speed = 22;
    car.mesh.position.set(0, 0, -40);
    car.mesh.rotation.y = Math.PI;
    enterCar(car);
    forceStars(3);
    startMission(6, missionCtx());
    camYaw = Math.PI;
    setBgmMood('night');
  }
  setTimeout(
    () => { window.__shotReady = true; },
    (shot === 'play' || shot === 'night') ? 2600 : 1400,
  );
}

function boot() {
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
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(0, 60, 160);
  camera.lookAt(0, 0, 0);
  sun = new THREE.DirectionalLight(0xfff2d9, 2.6);
  sun.position.set(120, 180, 60);
  scene.add(sun);
  ambient = new THREE.AmbientLight(0xbfd9e8, 0.9);
  scene.add(ambient);
  hemi = new THREE.HemisphereLight(0x8ec9e8, 0x8a7a4a, 0.5);
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
  initWeather(scene, sun, hemi, WEATHER.startHour);
  onNight((night) => {
    ambient.intensity = night ? 0.5 : 0.9;
    ambient.color.setHex(night ? 0xbfd9ff : 0xbfd9e8);
    scene.fog.color.setHex(night ? 0x182333 : 0xa8d4e6);
    setCityNight(night);
    setVehiclesNight(night);
    setCopsNight(night);
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
  }
  respawnToSpawn();
  playerMesh = buildPlayerMesh();
  playerMesh.position.set(player.x, 0, player.z);
  playerMesh.rotation.y = player.heading;
  scene.add(playerMesh);
  state.myCar = spawnPlayerCar(6, 96);
  state.myCar.grip = characterDef(state.character).grip;
  spawnTraffic(10);
  spawnPeds(16);
  state.mpOn = initMultiplayer(scene, {
    onEvent: (evt) => showMessage(evt.text, evt.type === 'mp' ? 3600 : 2600),
    charId: () => state.character,
  });
  onWantedChange((stars) => {
    setStars(stars);
    if (stars > state.bestWanted) state.bestWanted = stars;
    if (stars >= 1) sirenStart();
    else sirenStop();
    if (stars >= 3) {
      showMessage('三颗星了，赶紧甩掉他们！');
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
      writeSave(saveState());
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
  setWeather(getWeatherLabel());
  setMission(objectiveText(state.completed, state.character));
  setHelp('点击开始、WASD 移动、F 上车、E 任务、点击开枪、Q 换主角');
  document.getElementById('title-screen').addEventListener('click', () => {
    if (state.status === 'title') startGame();
  });
  if (shot) stageShot();
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  clock = new THREE.Clock();
  renderer.setAnimationLoop(tick);
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  frameCount++;
  if (state.status === 'playing') state.playSeconds += dt;
  const now = performance.now() / 1000;

  // Input edges.
  if (state.status === 'title') {
    if (justPressed('Enter') || mouseClicked()) startGame();
  } else if (state.status === 'playing') {
    if (justPressed('KeyE')) tryStartMission();
    if (justPressed(KEYS.restart)) restart();
    if (justPressed(KEYS.swapChar)) swapCharacter(otherCharacter(state.character));
    if (justPressed(KEYS.music)) {
      if (isBgmPlaying()) { stopBgm(); showMessage('音乐关了。'); }
      else { startBgm(); showMessage('合成波响起来了。'); }
    }
    if (justPressed(KEYS.wave) && state.mpOn) sendWave();
    if (justPressed(KEYS.horn) && state.inCar && state.hornCooldown <= 0) {
      state.hornCooldown = 1.2;
      playHorn();
      scarePeds(player.x, player.z, 25);
      let nearCop = false;
      for (const cop of getCops()) {
        const dx = cop.x - player.x;
        const dz = cop.z - player.z;
        if (dx * dx + dz * dz < 25 * 25) { nearCop = true; break; }
      }
      if (nearCop) {
        addCrime('reckless');
        alertTo(player.x, player.z);
        showMessage('警察听到喇叭了！');
      }
    }
    if (justPressed(KEYS.enterCar)) {
      if (state.inCar) {
        exitCar();
      } else {
        const myCarNear = state.myCar && !state.myCar.dead
          && Math.hypot(state.myCar.x - player.x, state.myCar.z - player.z) < 6
          ? state.myCar : null;
        const near = nearestCar(player.x, player.z, 6, state.myCar) || myCarNear;
        if (near) {
          const stolen = near !== state.myCar && !near.isCop;
          enterCar(near);
          if (stolen) {
            addCrime('steal');
            showMessage('你偷了这辆车！');
          }
        }
      }
    }
    if (mouseClicked()) shoot();
  } else if (state.status === 'busted' || state.status === 'wasted') {
    if (justPressed(KEYS.restart)) restart();
  }

  state.hornCooldown = Math.max(0, state.hornCooldown - dt);
  const look = takeLook();
  camYaw -= look.dx * 0.0032;
  camPitch = clamp(camPitch + look.dy * 0.0022, 0.08, 1.1);
  state.camZoom = clamp(state.camZoom + takeZoom() * 0.12, 0.75, 1.6);

  // Driving / walking.
  if (state.status === 'playing') {
    if (state.inCar && state.car) {
      const car = state.car;
      const wasAlive = car.hp > 0;
      const axes = driveAxes();
      const dist = driveCar(car, dt, axes.throttle, axes.steer, axes.brake);
      if (shot === 'play' || shot === 'night') car.speed = 22;
      state.speed = car.speed;
      player.x = car.x;
      player.z = car.z;
      player.heading = car.heading;
      let diff = car.heading - camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      camYaw += diff * (1 - Math.pow(0.001, dt));
      if (dist > 0 && Math.abs(car.speed) > 3 && car.hp <= 0) playCrash();
      if (wasAlive && car.hp <= 0) {
        explodeCar(car);
        exitCar();
        hurtPlayer(20);
        showMessage('车撞报废了！');
      }
      engineSet(Math.abs(car.speed) / CAR.maxSpeed, true);
      if (car.drifting) {
        const bx = car.x - Math.sin(car.heading) * 1.5;
        const bz = car.z - Math.cos(car.heading) * 1.5;
        const sx = Math.cos(car.heading) * 0.9;
        const sz = -Math.sin(car.heading) * 0.9;
        spawnSmoke(bx - sx, 0.3, bz - sz, 1);
        spawnSmoke(bx + sx, 0.3, bz + sz, 1);
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
        const cash = Math.round(car.lastBanked * DRIFT.cashPerPoint);
        state.cash += cash;
        if (car.lastBanked > state.bestDrift) state.bestDrift = car.lastBanked;
        setCash(state.cash);
        showMessage(`漂移结算 +$${cash}`);
        let copNear = false;
        for (const cop of getCops()) {
          const dx = cop.x - player.x;
          const dz = cop.z - player.z;
          if (dx * dx + dz * dz < 40 * 40) { copNear = true; break; }
        }
        if (copNear) {
          addCrime('reckless');
          alertTo(player.x, player.z);
          showMessage('警察看到你漂移了！');
        }
        car.lastBanked = 0;
        writeSave(saveState());
      }
    } else {
      const axes = walkAxes();
      const def = characterDef(state.character);
      const speed = axes.sprint ? def.runSpeed : def.walkSpeed;
      const fx = Math.sin(camYaw);
      const fz = Math.cos(camYaw);
      const mx = fx * axes.z - fz * axes.x;
      const mz = fz * axes.z + fx * axes.x;
      const len = Math.hypot(mx, mz);
      if (len > 0.01) {
        const nx = player.x + (mx / len) * speed * dt;
        const nz = player.z + (mz / len) * speed * dt;
        const hit = resolveCircleCollision(nx, nz, PLAYER.radius);
        player.x = hit.x;
        player.z = hit.z;
        player.heading = Math.atan2(mx, mz);
        playerMesh.position.set(player.x, 0, player.z);
        playerMesh.rotation.y = player.heading;
        state.speed = speed;
      } else {
        state.speed = 0;
      }
      engineSet(0, false);
    }
  }

  // Weather and day/night.
  updateWeather(dt, camera.position);
  state.hudTimer += dt;
  if (state.hudTimer >= 0.5) {
    state.hudTimer = 0;
    setClock(getClockLabel());
    setWeather(getWeatherLabel());
  }
  const weatherNow = getWeather();
  if (weatherNow !== state.lastWeather) {
    if (weatherNow === 'clear') {
      rainStop();
      setRain(false);
    } else {
      rainStart();
      setRain(true);
      showMessage(weatherNow === 'storm' ? '风暴来了，开车小心！' : '大道上下雨了。');
    }
    state.lastWeather = weatherNow;
  }
  if (state.mpOn) {
    if (isMultiplayer()) setMp(`${multiplayerCount()} 名车手在线`);
    else setMp('');
  }
  // Armour regrows after a quiet stretch.
  if (state.status === 'playing' && now - state.lastHurtAt > ARMOR.regenDelay) {
    const def = characterDef(state.character);
    if (state.armor < def.armorMax) {
      state.armor = Math.min(def.armorMax, state.armor + ARMOR.regenRate * dt);
      setArmor(state.armor, def.armorMax);
    }
  }

  // World systems.
  if (state.status === 'playing' || state.status === 'title') {
    updateTraffic(dt, player.x, player.z);
    updatePeds(dt, player.x, player.z, state.inCar, state.inCar ? state.speed : 0);
  }
  runParticleSystem(dt);
  if (state.mpOn) {
    updateMultiplayer(dt, {
      x: player.x, z: player.z, heading: player.heading,
      inCar: state.inCar, char: state.character, stars: getStars(),
    });
  }

  if (state.status === 'playing') {
    state.shootCooldown = Math.max(0, state.shootCooldown - dt);
    updateWanted(dt, state.committingCrime);
    state.committingCrime = false;
    updateCops(
      dt, getStars(),
      { x: player.x, z: player.z, inCar: state.inCar, speed: state.speed },
      () => bustPlayer('警察把你按倒在地'),
      (dist) => hurtPlayer(dist < 25 ? 9 : 4),
    );
    if (state.inCar && state.car) {
      const car = state.car;
      for (const cop of getCops()) {
        if (cop.dead) continue;
        const dx = cop.x - car.x;
        const dz = cop.z - car.z;
        if (dx * dx + dz * dz < 5.5 * 5.5 && Math.abs(cop.speed) > 6) {
          car.hp -= 60 * dt;
          addShake(0.3);
          if (car.hp <= 0) {
            explodeCar(car);
            exitCar();
            hurtPlayer(20);
            showMessage('警车把你撞爆了！');
            playCrash();
          }
          break;
        }
      }
      for (const other of traffic) {
        if (other === car || other.dead) continue;
        const dx = other.x - car.x;
        const dz = other.z - car.z;
        if (dx * dx + dz * dz < 4.6 * 4.6) {
          car.speed *= 0.94;
          other.speed = 0;
        }
      }
    }
    if (state.tailTarget) {
      const t = state.tailTarget;
      t.speed = t.cruise;
      t.x += Math.sin(t.heading) * t.speed * dt;
      t.z += Math.cos(t.heading) * t.speed * dt;
      if (Math.abs(t.x) > 230 || Math.abs(t.z) > 230) t.heading += Math.PI;
      t.mesh.position.set(t.x, 0, t.z);
      t.mesh.rotation.y = t.heading;
    }
    const missionRes = updateMissions(dt, {
      px: player.x, pz: player.z, inCar: state.inCar, speed: state.speed,
      stars: getStars(), squadLeft: getSquadLeft(), targetCar: state.tailTarget, dt,
    });
    if (missionRes && missionRes.done) state.tailTarget = null;
    setMission(objectiveText(state.completed, state.character));
  }

  // Camera.
  state.shake = Math.max(0, state.shake - 1.4 * dt);
  if (shot !== 'start') {
    const target = state.inCar && state.car ? state.car : player;
    const heading = state.inCar && state.car ? state.car.heading : camYaw;
    const dist = (state.inCar ? 11 : 7.5) * state.camZoom;
    const height = (state.inCar ? 4.4 : 3.2) * state.camZoom;
    const cx = target.x - Math.sin(heading) * dist;
    const cz = target.z - Math.cos(heading) * dist;
    const cy = height + Math.sin(camPitch) * 2.5;
    const k = 1 - Math.pow(0.0001, dt);
    camera.position.x += (cx - camera.position.x) * k;
    camera.position.y += (cy - camera.position.y) * k;
    camera.position.z += (cz - camera.position.z) * k;
    const sh = state.shake * state.shake * 0.55;
    camera.position.x += (Math.random() * 2 - 1) * sh;
    camera.position.y += (Math.random() * 2 - 1) * sh;
    camera.lookAt(target.x, state.inCar ? 1.6 : 1.4, target.z);
  }

  // HUD.
  if (state.status === 'playing') {
    setSpeed(Math.abs(state.speed) * 3.6);
    setHealth(state.hp);
    drawMinimap({
      player: { x: player.x, z: player.z, heading: player.heading },
      traffic, cops: getCops(), objective: missionObjectivePoint(),
    });
  } else if (state.status === 'busted' || state.status === 'wasted') {
    drawMinimap({
      player: { x: player.x, z: player.z, heading: player.heading },
      traffic, cops: getCops(), objective: null,
    });
  }

  if (tracer && performance.now() > tracerUntil) {
    scene.remove(tracer);
    tracer = null;
  }
  if (state.status === 'playing' && Math.floor(state.playSeconds) % 20 === 0 && frameCount % 60 === 0) {
    writeSave(saveState());
  }
  updateCityVisibility(camera);
  renderer.render(scene, camera);
  resetFrame();
}

function missionObjectivePoint() {
  const active = getActiveId();
  if (active) {
    const m = missionById(active);
    if (m) {
      const p = PLACES[m.place];
      if (p) return { x: p.x, z: p.z };
    }
  }
  const next = nextMissionId(state.completed);
  if (next) {
    const m = missionById(next);
    if (m) {
      const p = PLACES[m.place];
      if (p) return { x: p.x, z: p.z };
    }
  }
  return null;
}

boot();
