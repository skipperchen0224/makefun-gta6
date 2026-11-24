// Optional lobby client: sends position snapshots, receives other drivers, chat and waves.
// Round 5 re-record: ghost drivers never carry weapons state — only position, lead and stars sync.
// Round 4 re-record: snapshots go out ten times a second; ghosts are only drawn, never simulated.
// Palmetto Heat — WebSocket multiplayer (optional, ?mp=1).
// serve.ts runs a tiny lobby on the same port: no accounts, no deps, just
// positions and chat. This client sends its own snapshot ten times a
// second and draws the other drivers as ghost cars (or ghost leads on
// foot) with their name floating over them. Offline play is untouched:
// without ?mp=1 nothing ever connects.
// Round 4: a ghost swaps its body mesh when its driver gets in or out of a car.

import * as THREE from 'three';
import { buildCharacterMesh } from './characters.js';

let ws = null;
let enabled = false;
let myId = null;
let ghosts = new Map(); // id -> { group, name, x, z, heading, inCar, char }
let sceneRef = null;
let sendTimer = 0;
let onEvent = () => {};

export function initMultiplayer(scene, opts = {}) {
  sceneRef = scene;
  onEvent = opts.onEvent || (() => {});
  if (!new URLSearchParams(location.search).get('mp')) return false;
  try {
    ws = new WebSocket(`ws://${location.hostname}:${location.port || 8080}`);
  } catch {
    return false;
  }
  enabled = true;
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ t: 'hello', char: opts.charId ? opts.charId() : 'lucia' }));
  });
  ws.addEventListener('message', (ev) => {
    try { handle(JSON.parse(ev.data)); } catch { /* a bad frame never breaks the game */ }
  });
  ws.addEventListener('close', () => {
    enabled = false;
    clearGhosts();
  });
  return true;
}

export function isMultiplayer() {
  return enabled && ws && ws.readyState === 1;
}

export function multiplayerCount() {
  return ghosts.size + (myId ? 1 : 0);
}

function handle(msg) {
  if (msg.t === 'welcome') {
    myId = msg.id;
    onEvent({ type: 'mp', text: `Joined the lobby as ${msg.id}. ${msg.count} driver(s) online.` });
  } else if (msg.t === 'players') {
    syncGhosts((msg.list || []).filter((p) => p.id !== myId));
  } else if (msg.t === 'chat') {
    onEvent({ type: 'chat', text: `${msg.from}: ${msg.text}` });
  } else if (msg.t === 'wave') {
    onEvent({ type: 'wave', text: `${msg.from} waves at you!` });
  } else if (msg.t === 'bye') {
    removeGhost(msg.id);
  }
}

function makeNameSprite(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 26px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(10,14,18,0.7)';
  g.fillRect(0, 0, 256, 48);
  g.fillStyle = '#ffd34d';
  g.fillText(text.slice(0, 18), 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(7, 1.3, 1);
  sprite.position.y = 3.4;
  return sprite;
}

function makeGhostCarMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.62, 4.4),
    new THREE.MeshLambertMaterial({ color: 0x9fc3d9, transparent: true, opacity: 0.85 }),
  );
  body.position.y = 0.62;
  g.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.55, 2.2),
    new THREE.MeshLambertMaterial({ color: 0x1a2733, transparent: true, opacity: 0.85 }),
  );
  cabin.position.set(0, 1.18, -0.2);
  g.add(cabin);
  return g;
}

function syncGhosts(list) {
  const seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    let ghost = ghosts.get(p.id);
    if (!ghost) {
      const group = new THREE.Group();
      const body = p.inCar ? makeGhostCarMesh() : buildCharacterMesh(p.char || 'lucia');
      group.add(body);
      group.add(makeNameSprite(p.id));
      group.userData.body = body;
      sceneRef.add(group);
      ghost = { group, name: p.id, x: p.x, z: p.z, heading: p.heading, inCar: !!p.inCar, char: p.char || 'lucia' };
      ghosts.set(p.id, ghost);
    }
    // Swap the body mesh if the ghost got in or out of a car.
    if (!!p.inCar !== ghost.inCar || (p.char || 'lucia') !== ghost.char) {
      ghost.group.remove(ghost.group.userData.body);
      const body = p.inCar ? makeGhostCarMesh() : buildCharacterMesh(p.char || 'lucia');
      ghost.group.add(body);
      ghost.group.userData.body = body;
      ghost.inCar = !!p.inCar;
      ghost.char = p.char || 'lucia';
    }
    ghost.x = p.x;
    ghost.z = p.z;
    ghost.heading = p.heading;
  }
  for (const [id] of ghosts) {
    if (!seen.has(id)) removeGhost(id);
  }
}

function removeGhost(id) {
  const ghost = ghosts.get(id);
  if (!ghost) return;
  sceneRef.remove(ghost.group);
  ghosts.delete(id);
}

function clearGhosts() {
  for (const [id] of ghosts) removeGhost(id);
}

// Ten snapshots a second out; ghosts glide toward their last known spot.
export function updateMultiplayer(dt, self) {
  if (!enabled || !ws || ws.readyState !== 1) return;
  sendTimer -= dt;
  if (sendTimer <= 0) {
    sendTimer = 0.1;
    ws.send(JSON.stringify({
      t: 'pos', x: self.x, z: self.z, heading: self.heading,
      inCar: self.inCar, char: self.char, stars: self.stars,
    }));
  }
  const k = 1 - Math.pow(0.001, dt);
  for (const ghost of ghosts.values()) {
    ghost.group.position.x += (ghost.x - ghost.group.position.x) * k;
    ghost.group.position.z += (ghost.z - ghost.group.position.z) * k;
    ghost.group.rotation.y = ghost.heading;
  }
}

export function sendWave() {
  if (isMultiplayer()) ws.send(JSON.stringify({ t: 'wave' }));
}

export function sendChat(text) {
  if (isMultiplayer() && text) ws.send(JSON.stringify({ t: 'chat', text: String(text).slice(0, 140) }));
}
