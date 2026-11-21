// 主游戏——场景、玩家、相机、战斗、主循环；启动三维库、把所有模块接在一起，并摆拍 dossier 要的四种截图模式（网址参数 shot 等于 start、play、end、night）；本轮接进的新系统有双主角（Q 切换）、护甲、漂移计分加轮胎烟、屏幕震动与开枪后坐、天气昼夜循环、合成波背景音乐（M 键）、ECS 粒子系统、可选的 WebSocket 多人大厅（网址参数 mp 等于 1）。
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
const shotMode = params.get('shot') || '';
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
};

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
let tracer = null;
let tracerUntil = 0;
let frameCount = 0;
let crashCooldown = 0;

function buildPlayerMesh() {
  playerMesh = buildCharacterMesh(state.character);
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
  writeSave(state);
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

function drawTracer(a, b) {
  if (tracer) scene.remove(tracer);
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  tracer = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
  scene.add(tracer);
  tracerUntil = performance.now() + 90;
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
  for (const ped of getPeds()) {
    if (ped.state !== 'down') targets.push(ped.mesh);
  }
  for (const cop of getCops()) targets.push(cop.mesh);
  for (const car of traffic) {
    if (!car.dead) targets.push(car.mesh);
  }
  const hits = raycaster.intersectObjects(targets, true);
  const from = new THREE.Vector3(playerPos.x, 1.5, playerPos.z);
  if (hits.length === 0) {
    const dir = new THREE.Vector3();
    raycaster.ray.at(60, dir);
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
    const result = hitPed(ped, 1);
    if (result === 'down') {
      addCrime(ped.hostile ? 'hurtPed' : 'killPed');
      if (ped.hostile) {
        setSquadLeft(getPeds().filter((p) => p.hostile && p.state !== 'down').length);
        showMessage('Crew member down — the rest are still standing.');
      } else {
        showMessage('A bystander went down — the cops noticed that.');
      }
    }
    return;
  }
  const cop = getCops().find((c) => c.mesh === top);
  if (cop) {
    if (damageCop(cop, 34)) {
      addCrime('killPed');
      showMessage('Cop car destroyed — the whole department is coming.');
    }
    return;
  }
  const car = traffic.find((c) => c.mesh === top);
  if (car) {
    car.hp -= 34;
    if (car.hp <= 0) {
      explodeCar(car);
      addCrime('reckless');
      showMessage('You blew up a car — someone called that in.');
    }
  }
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
  writeSave(state);
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
  writeSave(state);
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
    forceStars(2);
    if (startMission(1, missionCtx())) {
      const m = missionById(1);
      showBanner(`${m.id}. ${m.name}`);
      showMessage(getMissionBrief(m.id, state.character));
      playPickup();
    }
    camYaw = Math.PI;
    setClock(getClockLabel());
    setWeather(getWeatherLabel());
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
    forceStars(3);
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
    setTimeout(() => { window.__shotReady = true; }, 2600);
  }
}

function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  if (shotMode) window.__renderer = renderer;
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
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
  scene.add(sun);
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
  respawn();
  buildPlayerMesh();
  playerMesh.position.set(playerPos.x, 0, playerPos.z);
  playerMesh.rotation.y = playerPos.heading;
  scene.add(playerMesh);
  state.playerCar = spawnPlayerCar(6, 96);
  state.playerCar.grip = characterDef(state.character).grip;
  spawnTraffic(10);
  spawnPeds(16);

  if (params.get('mp') === '1') {
    state.mpOn = initMultiplayer(scene, {
      charId: () => state.character,
      onEvent: (evt) => showMessage(evt.text, evt.type === 'mp' ? 3600 : 2600),
    });
  }

  onWantedChange((stars) => {
    setStars(stars);
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
      writeSave(state);
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
  if (state.status === 'title' && (justPressed('Enter') || mouseClicked())) {
    startGame();
  } else if (state.status === 'playing') {
    if (justPressed(KEYS.restart)) restart();
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
    if (mouseClicked()) shoot();
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
      playerPos.x = car.x;
      playerPos.z = car.z;
      playerPos.heading = car.heading;
      camYaw = lerpAngle(camYaw, car.heading, 1 - Math.pow(0.001, dt));
      state.speed = Math.abs(car.speed);
      if (dist > 0 && state.speed > 3 && car.hp <= 0 && crashCooldown <= 0) {
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
        writeSave(state);
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
      if (playerMesh) {
        playerMesh.position.set(playerPos.x, 0, playerPos.z);
        playerMesh.rotation.y = playerPos.heading;
      }
      engineSet(0, false);
    }
  }

  // Weather, clock, rain, multiplayer, armour.
  updateWeather(dt, camera.position);
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
    updateTraffic(dt, playerPos.x, playerPos.z);
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
    state.committingCrime = false;
    updateWanted(dt, state.committingCrime);
    updateCops(dt, getStars(), {
      x: playerPos.x, z: playerPos.z, inCar: state.inCar, speed: state.speed,
    }, () => busted('Caught on foot.'), (dist) => hurtPlayer(dist < 25 ? 9 : 4));

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
          }
        }
      }
    }
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
      px: playerPos.x, pz: playerPos.z, inCar: state.inCar,
      speed: state.speed, stars: getStars(), squadLeft: getSquadLeft(),
      targetCar: state.tailTarget, dt,
    });
    if (finished && finished.done) state.tailTarget = null;
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

  if (tracer && performance.now() > tracerUntil) {
    scene.remove(tracer);
    tracer = null;
  }
  if (state.status === 'playing' && Math.floor(state.playSeconds) % 20 === 0 && frameCount % 60 === 0) {
    writeSave(state);
  }
  updateCityVisibility(camera);
  renderer.render(scene, camera);
  resetFrame();
}
