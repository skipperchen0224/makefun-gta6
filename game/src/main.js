import * as THREE from '../vendor/three.module.min.js';
import { WORLD, COLORS, TUNING } from './config.js';
import { buildCity } from './city.js';
import { createVehicle, createTraffic } from './vehicles.js';
import { createPeds } from './peds.js';
import { createCops } from './cops.js';
import { createWanted } from './wanted.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createMissions } from './missions.js';
import { createHUD } from './hud.js';
import { loadSave, saveSave } from './save.js';

const urlParams = new URLSearchParams(window.location.search);
const shotName = urlParams.get('shot');

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.WATER);
scene.fog = new THREE.FogExp2(COLORS.WATER, 0.005);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const audio = createAudio();
const input = createInput(canvas);
const city = buildCity(scene);
const traffic = createTraffic(scene, city, 20);
const peds = createPeds(scene, city, 15);
const cops = createCops(scene, city);
const wanted = createWanted();

let savedData = loadSave();
let money = savedData.money;
let health = TUNING.HEALTH_MAX;
let missionIndex = savedData.missionIndex;
let inCar = false;
let currentCar = null;
let camMode = 'near'; // 'near' or 'far'
let gameState = 'title'; // 'title', 'play', 'pause', 'busted', 'wasted'

// Player on-foot representation
const playerGeo = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
const playerMat = new THREE.MeshStandardMaterial({ color: COLORS.PLAYER, roughness: 0.6 });
const playerMesh = new THREE.Mesh(playerGeo, playerMat);
playerMesh.position.set(city.spawn.x, city.spawn.y, city.spawn.z);
playerMesh.castShadow = true;
scene.add(playerMesh);

const player = {
  pos: playerMesh.position,
  velocity: new THREE.Vector3(),
  heading: 0,
  onGround: false
};

const missions = createMissions(scene, city, {
  get player() { return player; },
  get car() { return currentCar; },
  wanted,
  get money() { return money; },
  onPayout(amt) {
    money += amt;
    audio.coin();
    saveSave({ money, bestMoney: Math.max(money, savedData.bestMoney), missionIndex: missions.index, muted: false });
  },
  addWanted(n) { wanted.add(n); },
  toast(msg) { hud.toast(msg); }
});

const hud = createHUD({
  toast(msg) { hud.toast(msg); }
});

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
sunLight.position.set(100, 200, 100);
sunLight.castShadow = true;
scene.add(sunLight);

// UI Screens
const startOverlay = document.getElementById('overlay-start');
const pauseOverlay = document.getElementById('overlay-pause');
const bustedOverlay = document.getElementById('overlay-busted');
const wastedOverlay = document.getElementById('overlay-wasted');

function setGameState(state) {
  gameState = state;
  if (startOverlay) startOverlay.classList.toggle('hidden', state !== 'title');
  if (pauseOverlay) pauseOverlay.classList.toggle('hidden', state !== 'pause');
  if (bustedOverlay) bustedOverlay.classList.toggle('hidden', state !== 'busted');
  if (wastedOverlay) wastedOverlay.classList.toggle('hidden', state !== 'wasted');
}

document.getElementById('startBtn')?.addEventListener('click', () => {
  audio.resume();
  audio.start();
  setGameState('play');
  missions.start(missionIndex);
});

document.getElementById('resumeBtn')?.addEventListener('click', () => {
  setGameState('play');
});

function handleRespawn(penaltyFactor = 1.0) {
  health = TUNING.HEALTH_MAX;
  wanted.clear();
  cops.despawnAll();
  money = Math.round(money * penaltyFactor);
  inCar = false;
  currentCar = null;
  playerMesh.visible = true;
  player.pos.set(city.spawn.x, city.spawn.y, city.spawn.z);
  player.velocity.set(0, 0, 0);
  setGameState('play');
  saveSave({ money, bestMoney: savedData.bestMoney, missionIndex: missions.index, muted: false });
}

document.getElementById('bustedBtn')?.addEventListener('click', () => {
  handleRespawn(0.8);
});

document.getElementById('wastedBtn')?.addEventListener('click', () => {
  handleRespawn(0.8);
});

// Shot staging logic
if (shotName) {
  if (shotName === 'start') {
    setGameState('title');
    camera.position.set(60, 35, 235);
    camera.lookAt(new THREE.Vector3(0, 5, 100));
  } else if (shotName === 'play') {
    setGameState('play');
    currentCar = createVehicle(scene, {x: 0, y: 0, z: 170, heading: 0, color: 0xffaa00});
    inCar = true;
    playerMesh.visible = false;
    player.pos.copy(currentCar.pos);
    missions.start(0);
    wanted.add(2);
    // Force-spawn two cruisers so the play shot visibly shows the pursuit
    // (the per-frame random spawn alone would usually leave the shot cop-free).
    cops.spawn(player.pos, 2);
    cops.spawn(player.pos, 2);
  } else if (shotName === 'end') {
    setGameState('busted');
  }
}

// Main loop
let lastTime = performance.now();
let renderedFrames = 0;

function update(dt) {
  if (gameState !== 'play') return;

  // Input & Camera Orbit via mouse
  const mouseDX = input.mouseDX;
  player.heading -= mouseDX * 0.003;

  if (input.consume('Escape') || input.consume('KeyP')) {
    setGameState('pause');
    return;
  }

  // Enter/Exit Car
  if (input.consume('KeyF')) {
    if (inCar) {
      // Exit car
      inCar = false;
      player.pos.copy(currentCar.pos).add(new THREE.Vector3(2, 0, 0));
      playerMesh.visible = true;
      currentCar = null;
    } else {
      // Find nearest car
      let nearestCar = null;
      let minDist = 4.0;
      traffic.list.forEach(c => {
        const dist = c.pos.distanceTo(player.pos);
        if (dist < minDist) {
          minDist = dist;
          nearestCar = c;
        }
      });
      if (nearestCar) {
        currentCar = nearestCar;
        inCar = true;
        playerMesh.visible = false;
        wanted.add(1);
      }
    }
  }

  // Camera Toggle
  if (input.consume('KeyV')) {
    camMode = camMode === 'near' ? 'far' : 'near';
  }

  // Interact / Accept Mission
  if (input.consume('KeyE')) {
    if (!missions.current && !missions.complete) {
      missions.start(missions.index);
    }
  }

  // Shooting
  if (input.clicked) {
    audio.shoot();
    // Hitscan vs peds/cops
    const raycaster = new THREE.Raycaster();
    const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.heading);
    raycaster.set(player.pos, dir);

    const intersects = raycaster.intersectObjects(peds.list.map(p => p.mesh));
    if (intersects.length > 0 && intersects[0].distance < 30) {
      const hit = peds.list.find(p => p.mesh === intersects[0].object);
      if (hit) {
        hit.destroy();
        wanted.add(1);
      }
    }
  }

  // Player / Car Movement
  let currentSpeed = 0;
  if (inCar && currentCar) {
    const ctrl = {
      forward: input.keys['KeyW'] || input.keys['ArrowUp'],
      reverse: input.keys['KeyS'] || input.keys['ArrowDown'],
      left: input.keys['KeyA'] || input.keys['ArrowLeft'],
      right: input.keys['KeyD'] || input.keys['ArrowRight'],
      brake: input.keys['Space']
    };
    currentCar.update(dt, ctrl, city.colliders);
    player.pos.copy(currentCar.pos);
    currentSpeed = currentCar.speed || 0;

    if (currentCar.health <= 0) {
      health = 0;
      setGameState('wasted');
      audio.busted();
    }
  } else {
    // On foot movement
    const moveX = input.axis('KeyA', 'KeyD');
    const moveZ = input.axis('KeyS', 'KeyW');
    const sprint = input.keys['ShiftLeft'] || input.keys['ShiftRight'];
    const speed = sprint ? TUNING.PLAYER_SPRINT : TUNING.PLAYER_SPEED;

    const moveDir = new THREE.Vector3(moveX, 0, moveZ).normalize();
    moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.heading);

    player.velocity.x = moveDir.x * speed;
    player.velocity.z = moveDir.z * speed;

    currentSpeed = new THREE.Vector2(player.velocity.x, player.velocity.z).length();

    // Gravity & Jump
    if (player.onGround && (input.keys['Space'] || input.keys['KeySpace'])) {
      player.velocity.y = TUNING.JUMP_FORCE;
      player.onGround = false;
    }
    player.velocity.y -= TUNING.GRAVITY * dt;

    player.pos.addScaledVector(player.velocity, dt);

    if (player.pos.y <= 0.5) {
      player.pos.y = 0.5;
      player.velocity.y = 0;
      player.onGround = true;
    }

    playerMesh.position.copy(player.pos);
    playerMesh.rotation.y = player.heading;
  }

  // Sub-systems update
  traffic.update(dt, player.pos);
  peds.update(dt, player.pos);
  cops.update(dt, player.pos, wanted.stars);
  wanted.update(dt);
  missions.update(dt);

  // Check Busted
  if (cops.touchPlayer(player.pos)) {
    setGameState('busted');
    audio.busted();
  }

  // Camera Follow
  const targetPos = inCar ? currentCar.pos : player.pos;
  const activeHeading = inCar ? currentCar.heading : player.heading;
  const dist = camMode === 'near' ? 6 : 12;
  const height = camMode === 'near' ? 3 : 6;

  const camOffset = new THREE.Vector3(
    Math.sin(activeHeading) * dist,
    height,
    Math.cos(activeHeading) * dist
  );
  camera.position.lerp(targetPos.clone().add(camOffset), 0.1);
  camera.lookAt(targetPos.clone().add(new THREE.Vector3(0, 1, 0)));

  // HUD Update
  const mph = Math.abs(currentSpeed * 2.237);
  hud.update({
    money,
    wantedStars: wanted.stars,
    health: inCar ? currentCar.health : health,
    missionText: missions.statusText(),
    speed: mph,
    playerPos: targetPos,
    marker: missions.marker,
    cops: cops.list.map(c => ({ pos: c.car.pos }))
  }, dt);
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  update(dt);
  renderer.render(scene, camera);

  if (shotName) {
    renderedFrames++;
    if (renderedFrames >= 45) {
      window.__shotReady = true;
    }
  }
}

requestAnimationFrame(animate);
