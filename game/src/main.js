// Palmetto Heat — main game: scene, player, camera, combat, loop.
// Boots three.js, wires every module together, and stages the three
// screenshot modes (?shot=start|play|end) the dossier's shots.json asks for.

import * as THREE from 'three';
import { WORLD, PLAYER, CAR, PLACES, KEYS, clamp, lerp, mulberry32 } from './config.js';
import { initInput, driveAxes, walkAxes, justPressed, mouseClicked, takeLook, resetFrame, lockPointer } from './input.js';
import { initAudio, resumeAudio, playGunshot, playPickup, playMissionDone, playFail, playCrash, playBusted, engineStart, engineSet, sirenStart, sirenStop } from './audio.js';
import { hasSave, loadSave, writeSave } from './save.js';
import { buildCity, resolveCircleCollision, randomRoadPoint, placeOf } from './city.js';
import { initVehicles, spawnPlayerCar, spawnTraffic, driveCar, updateTraffic, nearestCar, traffic, explodeCar, createCar } from './vehicles.js';
import { initPeds, spawnPeds, spawnHostileSquad, scarePeds, updatePeds, hitPed, getPeds, countHostilesUp } from './peds.js';
import { initWanted, getStars, addCrime, forceStars, updateWanted, onWantedChange, clearWanted } from './wanted.js';
import { initCops, updateCops, damageCop, getCops, clearCops } from './cops.js';
import { initMissions, startMission, updateMissions, objectiveText, nextMissionId, getActiveId, setSquadLeft, onMissionEvent, missionById } from './missions.js';
import { initHud, setCash, setHealth, setStars, setMission, setSpeed, setHelp, showMessage, showBanner, showTitle, showEnd, hideEnd, drawMinimap } from './hud.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || '';
const SEED = Number(params.get('seed') || '1') || 1;
const rng = mulberry32(SEED * 7919 + 13);

// ---- game state ------------------------------------------------------------
const game = {
  state: 'title',       // title | playing | busted | wasted
  cash: 500,
  hp: PLAYER.hp,
  completed: [],
  bestWanted: 0,
  playSeconds: 0,
  inCar: false,
  car: null,            // current car object (player's or stolen)
  playerCar: null,      // the orange car that spawns with the player
  speed: 0,             // player speed (car or foot) for HUD / arrest checks
  shootingCooldown: 0,
  committingCrime: false,
  tailTarget: null,
  startedAt: performance.now(),
  shotStagedAt: 0,
};

let renderer, scene, camera, clock;
let playerMesh, playerHeading = Math.PI, camYaw = Math.PI, camPitch = 0.32;
let player = { x: 0, z: 0, heading: Math.PI };
let raycaster, tracer = null, tracerUntil = 0;
let frameCount = 0;

function buildPlayerMesh() {
  const g = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: 0xff7a1a });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a986 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2c3240 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 1.0, 8), jacket);
  body.position.y = 1.05;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skin);
  head.position.y = 1.82;
  g.add(head);
  for (const x of [-0.15, 0.15]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.6, 6), pants);
    leg.position.set(x, 0.32, 0);
    g.add(leg);
  }
  return g;
}

function resetPlayerToSpawn() {
  const s = placeOf('spawn');
  player.x = s.x;
  player.z = s.z;
  player.heading = Math.PI;
  camYaw = Math.PI;
  game.hp = PLAYER.hp;
  game.inCar = false;
  game.car = null;
}

function startGame() {
  resumeAudio();
  engineStart();
  game.state = 'playing';
  showTitle(false);
  hideEnd();
  showMessage('Welcome to Palmetto City. Press E to start a mission, F to enter a car.');
}

function enterCar(car) {
  game.inCar = true;
  game.car = car;
  car.isPlayer = true;
  playerMesh.visible = false;
  setHelp('WASD drive · Space handbrake · F exit car · Click shoot (on foot)');
  playPickup();
}

function exitCar() {
  if (!game.car) return;
  const car = game.car;
  car.isPlayer = false;
  // Step out to the car's left side.
  const sx = car.x + Math.cos(car.heading) * 2.4;
  const sz = car.z - Math.sin(car.heading) * 2.4;
  const spot = resolveCircleCollision(sx, sz, PLAYER.radius);
  player.x = spot.x;
  player.z = spot.z;
  player.heading = car.heading;
  game.inCar = false;
  game.car = null;
  playerMesh.visible = true;
  playerMesh.position.set(player.x, 0, player.z);
  setHelp('WASD move · Shift run · F enter car · Click shoot · E mission');
}

// ---- shooting --------------------------------------------------------------
function shoot() {
  if (game.shootingCooldown > 0 || game.inCar) return;
  game.shootingCooldown = 0.28;
  playGunshot();
  addCrime('shoot');
  game.committingCrime = true;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const pedMeshes = getPeds().filter((p) => p.state !== 'down').map((p) => p.mesh);
  const copMeshes = getCops().map((c) => c.mesh);
  const carMeshes = traffic.map((c) => c.mesh);
  const hits = raycaster.intersectObjects([...pedMeshes, ...copMeshes, ...carMeshes], true);
  // Muzzle tracer: a short-lived line from the player toward the hit point.
  const end = hits.length > 0 ? hits[0].point : raycaster.ray.at(60, new THREE.Vector3());
  drawTracer(new THREE.Vector3(player.x, 1.5, player.z), end);
  if (hits.length === 0) return;
  scarePeds(player.x, player.z, 50);
  // Which ped / cop / car did we hit? The top-level group of the hit mesh.
  const top = hits[0].object;
  let root = top;
  while (root.parent && root.parent !== scene) root = root.parent;
  const ped = getPeds().find((p) => p.mesh === root);
  if (ped) {
    const result = hitPed(ped, 1);
    if (result === 'down') {
      addCrime(ped.hostile ? 'hurtPed' : 'killPed');
      if (ped.hostile) {
        setSquadLeft(countHostilesUp());
        showMessage('Rival down.');
      } else {
        showMessage('You hit a civilian! The cops noticed.');
      }
    }
    return;
  }
  const cop = getCops().find((c) => c.mesh === root);
  if (cop) {
    if (damageCop(cop, 34)) {
      addCrime('ramCop');
      showMessage('Cop car disabled!');
    }
    return;
  }
  const car = traffic.find((c) => c.mesh === root);
  if (car) {
    car.hp -= 34;
    if (car.hp <= 0) explodeCar(car);
    addCrime('shoot');
  }
}

function drawTracer(from, to) {
  if (tracer) scene.remove(tracer);
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  tracer = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
  scene.add(tracer);
  tracerUntil = performance.now() + 90;
}

// ---- missions ---------------------------------------------------------------
function tryStartMission() {
  const next = nextMissionId(game.completed);
  if (next === 0) {
    showMessage('All missions complete. Enjoy free roam!');
    return;
  }
  const ok = startMission(next, {
    spawnSquad: (x, z, n) => spawnHostileSquad(x, z, n),
    spawnTailTarget: () => spawnTailTargetCar(),
    forceStars: (n) => forceStars(n),
  });
  if (ok) {
    const m = missionById(next);
    showBanner(`Mission ${m.id}: ${m.name} — ${m.blurb}`);
    playPickup();
  }
}

function spawnTailTargetCar() {
  // A yellow courier car ahead of the player on the nearest road.
  const p = randomRoadPoint(rng);
  const target = spawnTrafficCar(p);
  game.tailTarget = target;
  return target;
}

function spawnTrafficCar(p) {
  // A yellow courier car for the tail mission, built straight from vehicles.
  const heading = p.axis === 'x' ? Math.PI / 2 : 0;
  const car = createCar(0xf5d76e, p.x, p.z, heading);
  car.cruise = 13;
  car.isTailTarget = true;
  traffic.push(car);
  return car;
}

// ---- busted / wasted ---------------------------------------------------------
function bustPlayer(reason) {
  if (game.state !== 'playing') return;
  game.state = 'busted';
  playBusted();
  sirenStop();
  engineSet(0, false);
  game.cash = Math.max(0, game.cash - 150);
  clearWanted();
  showEnd('BUSTED', `${reason} — The Palmetto PD took you in. $150 bail. Press R to get back out there.`);
  setCash(game.cash);
  writeSave(game);
}

function wastePlayer() {
  if (game.state !== 'playing') return;
  game.state = 'wasted';
  playFail();
  sirenStop();
  engineSet(0, false);
  showEnd('WASTED', 'Palmetto City chewed you up. Press R to try again.');
  writeSave(game);
}

function restart() {
  hideEnd();
  clearCops();
  resetPlayerToSpawn();
  game.state = 'playing';
  game.hp = PLAYER.hp;
  showMessage('Back on the streets. Stay sharp.');
  engineStart();
}

// ---- screenshot staging ------------------------------------------------------
function stageShot() {
  game.shotStagedAt = performance.now();
  if (SHOT === 'start') {
    // Title screen over a high view of downtown.
    game.state = 'title';
    camera.position.set(-40, 90, 190);
    camera.lookAt(new THREE.Vector3(40, 0, -40));
    showTitle(true);
  } else if (SHOT === 'play') {
    startGame();
    // Player already in the orange car, mid-chase on the avenue.
    const car = game.playerCar;
    car.x = 0; car.z = 40;
    car.heading = Math.PI;
    car.speed = 24;
    enterCar(car);
    forceStars(2);
    startMission(1, {
      spawnSquad: (x, z, n) => spawnHostileSquad(x, z, n),
      spawnTailTarget: () => spawnTailTargetCar(),
      forceStars: (n) => forceStars(n),
    });
    camYaw = Math.PI;
  } else if (SHOT === 'end') {
    startGame();
    // Busted: player on foot, cop cars closing in, 5 stars.
    resetPlayerToSpawn();
    player.x = 0; player.z = 60;
    forceStars(5);
    bustPlayer('Surrounded at the avenue');
    game.state = 'busted';
  }
  window.__shotReady = false;
  setTimeout(() => { window.__shotReady = true; }, SHOT === 'play' ? 2600 : 1400);
}

// ---- boot --------------------------------------------------------------------
function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('game-canvas').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ec9e8);
  scene.fog = new THREE.Fog(0xa8d4e6, 180, 520);

  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(0, 60, 160);
  camera.lookAt(new THREE.Vector3(0, 0, 0));

  const sun = new THREE.DirectionalLight(0xfff2d9, 2.6);
  sun.position.set(120, 180, 60);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xbfd9e8, 0.9));
  const hemi = new THREE.HemisphereLight(0x9fd4ff, 0x8a7a5a, 0.5);
  scene.add(hemi);

  raycaster = new THREE.Raycaster();

  buildCity(scene, SEED);
  initVehicles(scene, SEED);
  initPeds(scene, SEED);
  initWanted();
  initCops(scene);
  initMissions(scene);
  initHud();
  initAudio();
  initInput(renderer.domElement);

  const saved = loadSave();
  if (saved) {
    game.cash = saved.cash;
    game.completed = saved.completed;
    game.bestWanted = saved.bestWanted;
    game.playSeconds = saved.playSeconds;
  } else if (hasSave()) {
    game.cash = 500;
  }

  resetPlayerToSpawn();
  playerMesh = buildPlayerMesh();
  playerMesh.position.set(player.x, 0, player.z);
  scene.add(playerMesh);

  game.playerCar = spawnPlayerCar(6, 96);
  spawnTraffic(10);
  spawnPeds(16);

  onWantedChange((stars) => {
    setStars(stars);
    game.bestWanted = Math.max(game.bestWanted, stars);
    if (stars >= 1) sirenStart();
    else sirenStop();
    if (stars >= 3) showMessage(`Wanted level ${stars} — the whole department is after you!`);
  });
  onMissionEvent((evt) => {
    if (evt.type === 'complete') {
      game.cash += evt.reward;
      game.completed.push(evt.mission.id);
      setCash(game.cash);
      showBanner(`Mission complete: ${evt.mission.name}  +$${evt.reward}`);
      playMissionDone();
      writeSave(game);
    } else if (evt.type === 'fail') {
      showBanner(`Mission failed: ${evt.mission.name} — ${evt.reason || ''}`);
      playFail();
    } else if (evt.type === 'start') {
      setMission(objectiveText(game.completed));
    }
  });

  setCash(game.cash);
  setHealth(game.hp);
  setStars(0);
  setMission(objectiveText(game.completed));
  setHelp('Click to start · WASD move · F enter car · E mission · Click shoot');
  if (SHOT) stageShot();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  clock = new THREE.Clock();
  renderer.setAnimationLoop(tick);
}

// ---- per-frame ---------------------------------------------------------------
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  frameCount++;
  if (game.state === 'playing') game.playSeconds += dt;

  // --- input edges ---
  if (game.state === 'title' && (justPressed('Enter') || mouseClicked())) startGame();
  if (game.state === 'playing') {
    if (justPressed('KeyE')) tryStartMission();
    if (justPressed('KeyR')) restart();
    if (justPressed(KEYS.enterCar)) {
      if (game.inCar) exitCar();
      else {
        const near = nearestCar(player.x, player.z, 6, game.car);
        const own = game.playerCar && !game.playerCar.dead
          && Math.hypot(game.playerCar.x - player.x, game.playerCar.z - player.z) < 6
          ? game.playerCar : null;
        const target = own || near;
        if (target) {
          enterCar(target);
          if (target !== game.playerCar && !target.isCop) {
            addCrime('steal');
            showMessage('Car stolen! The owner called it in.');
          }
        }
      }
    }
    if (mouseClicked()) shoot();
  } else if ((game.state === 'busted' || game.state === 'wasted') && justPressed('KeyR')) {
    restart();
  }

  // --- look ---
  const look = takeLook();
  camYaw -= look.dx * 0.0032;
  camPitch = clamp(camPitch + look.dy * 0.0022, 0.08, 1.1);

  // --- movement ---
  if (game.state === 'playing') {
    if (game.inCar && game.car) {
      const axes = driveAxes();
      const moved = driveCar(game.car, dt, axes.throttle, axes.steer, axes.brake);
      game.speed = game.car.speed;
      player.x = game.car.x;
      player.z = game.car.z;
      player.heading = game.car.heading;
      camYaw = lerp(camYaw, game.car.heading, 1 - Math.pow(0.001, dt));
      if (moved > 0 && Math.abs(game.car.speed) > 3 && game.car.hp <= 0) playCrash();
      engineSet(Math.abs(game.car.speed) / CAR.maxSpeed, true);
    } else {
      const axes = walkAxes();
      const speed = axes.sprint ? PLAYER.runSpeed : PLAYER.walkSpeed;
      const moving = axes.x !== 0 || axes.z !== 0;
      if (moving) {
        // Camera-relative movement: forward is away from the camera.
        const sin = Math.sin(camYaw);
        const cos = Math.cos(camYaw);
        const mx = (axes.x * cos - axes.z * sin) * -1;
        const mz = (axes.x * sin + axes.z * cos) * -1;
        const len = Math.hypot(mx, mz) || 1;
        const nx = player.x + (mx / len) * speed * dt;
        const nz = player.z + (mz / len) * speed * dt;
        const hit = resolveCircleCollision(nx, nz, PLAYER.radius);
        player.x = hit.x;
        player.z = hit.z;
        player.heading = Math.atan2(mx, mz);
        game.speed = speed;
      } else {
        game.speed = 0;
      }
      playerMesh.position.set(player.x, 0, player.z);
      playerMesh.rotation.y = player.heading;
      engineSet(0, false);
    }
  }

  // --- world systems ---
  if (game.state === 'playing' || game.state === 'title') {
    updateTraffic(dt, player.x, player.z);
    updatePeds(dt, player.x, player.z, game.inCar, game.speed);
  }
  if (game.state === 'playing') {
    game.shootingCooldown = Math.max(0, game.shootingCooldown - dt);
    game.committingCrime = false;
    updateWanted(dt, game.committingCrime);
    updateCops(dt, getStars(), {
      x: player.x, z: player.z, inCar: game.inCar, speed: game.speed,
    }, () => bustPlayer('The cops dragged you out'), (dist) => {
      // Cop gunfire: damage scales with closeness.
      game.hp -= dist < 25 ? 9 : 4;
      setHealth(game.hp);
      if (game.hp <= 0) wastePlayer();
    });
    // Cop rams damage the player's car.
    if (game.inCar && game.car) {
      for (const cop of getCops()) {
        const dx = cop.x - game.car.x;
        const dz = cop.z - game.car.z;
        if (dx * dx + dz * dz < 5.5 * 5.5 && Math.abs(cop.speed) > 6) {
          game.car.hp -= 6 * dt * 10;
          if (game.car.hp <= 0) {
            explodeCar(game.car);
            exitCar();
            game.hp -= 20;
            setHealth(game.hp);
            if (game.hp <= 0) wastePlayer();
            showMessage('Your car was wrecked!');
            playCrash();
          }
        }
      }
      // Traffic bumps slow the player a little.
      for (const t of traffic) {
        if (t === game.car || t.dead) continue;
        const dx = t.x - game.car.x;
        const dz = t.z - game.car.z;
        if (dx * dx + dz * dz < 4.6 * 4.6) {
          game.car.speed *= 0.94;
          t.speed = 0;
        }
      }
    }
    // Tail target keeps cruising its road.
    if (game.tailTarget && !game.tailTarget.dead) {
      const t = game.tailTarget;
      t.speed = t.cruise || 13;
      t.x += Math.sin(t.heading) * t.speed * dt;
      t.z += Math.cos(t.heading) * t.speed * dt;
      if (Math.abs(t.x) > 230 || Math.abs(t.z) > 230) t.heading += Math.PI;
      t.mesh.position.set(t.x, 0, t.z);
      t.mesh.rotation.y = t.heading;
    }
    const result = updateMissions(dt, {
      px: player.x, pz: player.z,
      inCar: game.inCar, speed: game.speed,
      stars: getStars(),
      squadLeft: countHostilesUp(),
      targetCar: game.tailTarget,
    });
    if (result && result.done) {
      game.tailTarget = null;
    }
    setMission(objectiveText(game.completed));
  }

  // --- camera ---
  if (game.state !== 'title' || SHOT !== 'start') {
    const follow = game.inCar && game.car ? game.car : player;
    const heading = game.inCar && game.car ? game.car.heading : camYaw;
    const dist = game.inCar ? 11 : 7.5;
    const height = game.inCar ? 4.4 : 3.2;
    const tx = follow.x - Math.sin(heading) * dist;
    const tz = follow.z - Math.cos(heading) * dist;
    const ty = height + Math.sin(camPitch) * 2.5;
    camera.position.x = lerp(camera.position.x, tx, 1 - Math.pow(0.0001, dt));
    camera.position.y = lerp(camera.position.y, ty, 1 - Math.pow(0.0001, dt));
    camera.position.z = lerp(camera.position.z, tz, 1 - Math.pow(0.0001, dt));
    camera.lookAt(new THREE.Vector3(follow.x, game.inCar ? 1.6 : 1.4, follow.z));
  }

  // --- HUD ---
  if (game.state === 'playing') {
    setSpeed(Math.abs(game.speed) * 3.6);
    setHealth(game.hp);
    const objective = getActiveId() !== 0
      ? (() => { const m = missionById(getActiveId()); return m ? { x: placeOf(m.place).x, z: placeOf(m.place).z } : null; })()
      : (() => { const n = nextMissionId(game.completed); return n ? { x: placeOf(missionById(n).place).x, z: placeOf(missionById(n).place).z } : null; })();
    drawMinimap({
      player: { x: player.x, z: player.z, heading: player.heading },
      traffic,
      cops: getCops(),
      objective,
    });
  }

  // --- tracer fade ---
  if (tracer && performance.now() > tracerUntil) {
    scene.remove(tracer);
    tracer = null;
  }

  // Autosave every ~20s of play.
  if (game.state === 'playing' && Math.floor(game.playSeconds) % 20 === 0 && frameCount % 60 === 0) {
    writeSave(game);
  }

  renderer.render(scene, camera);
  resetFrame();
}

boot();
