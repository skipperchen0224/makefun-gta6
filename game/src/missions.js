// Six story jobs in order, each with its own win and fail rule and a cash reward.
// Round 4 re-record: the loop feeds positions and targets in as context, and completion comes back as events.
// Palmetto Heat — the six story missions.
// Each mission is a small state machine: idle -> active -> done | failed.
// The game loop feeds it a context object (positions, speeds, targets) and
// it answers with the current objective text and completion events. Each
// mission now has a per-lead brief: Lucia and Jason get the same job from
// Mama Rosa, but they hear it differently.
// Round 4: each mission's brief is pitched differently to Lucia and to Jason.

import * as THREE from 'three';
import { MISSIONS, ECONOMY, PLACES } from './config.js';

let sceneRef = null;
let beacon = null;
let beaconRing = null;
let activeId = 0;        // 0 = none active
let state = 'idle';      // idle | active | done | failed
let timer = 0;
let tailTime = 0;
let targetCar = null;
let squadLeft = 0;
let listeners = [];

// How Mama Rosa pitches each job to each lead. Same job, different ears.
const BRIEFS = {
  lucia: {
    1: 'Lucia — the diner package, quick and quiet. You drive, I worry.',
    2: 'Lucia — pier, seventy-five seconds. Your footwork is the fast part.',
    3: 'Lucia — stay on that courier till he sweats. Ten seconds close is enough.',
    4: 'Lucia — three stars and a whole department. Lose them, then come home.',
    5: 'Lucia — five of the rival crew in the alley. On foot. Make it clean.',
    6: 'Lucia — five stars, one car, one safehouse. Drive like you mean it.',
  },
  jason: {
    1: 'Jason — diner package. Carry it like it owes you money.',
    2: 'Jason — pier run, clock ticking. Heavy foot, no shortcuts through walls.',
    3: 'Jason — tail the courier. He cracks faster when something big follows him.',
    4: 'Jason — three stars. Shake them off and bring that car home in one piece.',
    5: 'Jason — five of the rival crew in the alley. This one was made for you.',
    6: 'Jason — five stars, one car, one safehouse. They will remember this ride.',
  },
};

export function getMissionBrief(id, charId = 'lucia') {
  const lines = BRIEFS[charId] || BRIEFS.lucia;
  return lines[id] || missionById(id)?.blurb || '';
}

function makeBeacon() {
  const geo = new THREE.CylinderGeometry(3.2, 3.2, 26, 20, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffd34d, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
  });
  beacon = new THREE.Mesh(geo, mat);
  beacon.position.y = 13;
  beacon.visible = false;
  sceneRef.add(beacon);
  beaconRing = new THREE.Mesh(
    new THREE.RingGeometry(2.4, 3.4, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  beaconRing.rotation.x = -Math.PI / 2;
  beaconRing.position.y = 0.12;
  beaconRing.visible = false;
  sceneRef.add(beaconRing);
}

export function initMissions(scene) {
  sceneRef = scene;
  makeBeacon();
  activeId = 0;
  state = 'idle';
  timer = 0;
  tailTime = 0;
  targetCar = null;
  squadLeft = 0;
  listeners = [];
}

export function onMissionEvent(fn) { listeners.push(fn); }
function emit(evt) { for (const fn of listeners) { try { fn(evt); } catch { /* never break the game */ } } }

export function missionById(id) { return MISSIONS.find((m) => m.id === id); }
export function completedCount(doneList) { return doneList.length; }
export function nextMissionId(doneList) {
  const next = MISSIONS.find((m) => !doneList.includes(m.id));
  return next ? next.id : 0;
}

export function getActiveId() { return activeId; }
export function getState() { return state; }
export function getTimer() { return timer; }

export function startMission(id, ctx) {
  const m = missionById(id);
  if (!m || state === 'active') return false;
  activeId = id;
  state = 'active';
  timer = m.timeLimit;
  tailTime = 0;
  squadLeft = 0;
  targetCar = null;
  if (m.kind === 'shoot' && ctx.spawnSquad) {
    const place = PLACES[m.place];
    const squad = ctx.spawnSquad(place.x, place.z, 5);
    squadLeft = squad.length;
  }
  if (m.kind === 'tail' && ctx.spawnTailTarget) {
    targetCar = ctx.spawnTailTarget();
  }
  if (m.kind === 'escape' && ctx.forceStars) ctx.forceStars(3);
  if (m.kind === 'getaway' && ctx.forceStars) ctx.forceStars(5);
  moveBeaconTo(m.place);
  emit({ type: 'start', mission: m });
  return true;
}

function moveBeaconTo(placeName) {
  const p = PLACES[placeName];
  if (!p || !beacon) return;
  beacon.position.set(p.x, 13, p.z);
  beaconRing.position.set(p.x, 0.12, p.z);
  beacon.visible = true;
  beaconRing.visible = true;
}

function hideBeacon() {
  if (beacon) beacon.visible = false;
  if (beaconRing) beaconRing.visible = false;
}

function finish(done, reason) {
  const m = missionById(activeId);
  const reward = done ? ECONOMY.missionReward[activeId - 1] : 0;
  state = done ? 'done' : 'failed';
  hideBeacon();
  emit({ type: done ? 'complete' : 'fail', mission: m, reward, reason });
  const finishedId = activeId;
  activeId = 0;
  return { finishedId, done, reward };
}

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

// ctx: { px, pz, inCar, speed, stars, squadLeft, targetCar, dt }
export function updateMissions(dt, ctx) {
  if (state !== 'active') return null;
  const m = missionById(activeId);
  if (!m) return null;
  if (m.timeLimit > 0) {
    timer -= dt;
    if (timer <= 0) return finish(false, 'Out of time');
  }
  const place = PLACES[m.place];
  if (beaconRing) {
    const s = 1 + Math.sin(performance.now() / 300) * 0.12;
    beaconRing.scale.set(s, s, 1);
  }
  switch (m.kind) {
    case 'goto':
    case 'timed':
      if (dist2(ctx.px, ctx.pz, place.x, place.z) < 8 * 8) return finish(true);
      break;
    case 'tail': {
      const t = ctx.targetCar ?? targetCar;
      if (!t) return finish(false, 'Target lost');
      if (dist2(ctx.px, ctx.pz, t.x, t.z) < 26 * 26) {
        tailTime += dt;
        if (tailTime >= 10) return finish(true);
      } else {
        tailTime = Math.max(0, tailTime - dt * 0.5);
      }
      if (dist2(ctx.px, ctx.pz, t.x, t.z) > 120 * 120) return finish(false, 'Target got away');
      break;
    }
    case 'escape':
      if (ctx.stars === 0) return finish(true);
      if (ctx.stars <= 1 && dist2(ctx.px, ctx.pz, place.x, place.z) < 8 * 8) return finish(true);
      break;
    case 'shoot':
      if ((ctx.squadLeft ?? squadLeft) <= 0) return finish(true);
      break;
    case 'getaway':
      if (ctx.stars === 0 && dist2(ctx.px, ctx.pz, place.x, place.z) < 8 * 8) return finish(true);
      break;
    default:
      break;
  }
  return null;
}

// The HUD reads this every frame: short objective line + progress.
// Pass the active lead so the line speaks in their voice.
export function objectiveText(doneList, charId = 'lucia') {
  if (state === 'active') {
    const m = missionById(activeId);
    let extra = '';
    if (m.kind === 'tail') extra = ` — on his tail ${Math.floor(tailTime)}/10s`;
    if (m.kind === 'shoot') extra = ` — crew left: ${squadLeft}`;
    if (m.timeLimit > 0) extra += ` — ${Math.max(0, Math.ceil(timer))}s`;
    return `${m.name}: ${getMissionBrief(m.id, charId)}${extra}`;
  }
  const next = nextMissionId(doneList);
  if (next === 0) return 'All missions complete — Palmetto City is yours. Free roam!';
  const m = missionById(next);
  return `Next: ${m.name} — press E to start (${getMissionBrief(m.id, charId)})`;
}

export function setSquadLeft(n) { squadLeft = n; }
export function getSquadLeft() { return squadLeft; }
