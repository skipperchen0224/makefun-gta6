// Keyboard edges, mouse clicks, pointer-lock look and wheel zoom, reset once per frame.
// Palmetto Heat — keyboard and mouse state.
// Tracks held keys, edge-triggered "just pressed" keys, mouse buttons and
// pointer-lock look deltas. One `resetFrame()` call per game tick clears edges.
// Round 4: wheel zoom is consumed in steps, so one scroll never zooms twice.
// The mouse wheel now zooms the chase camera in and out (takeZoom).

import { KEYS } from './config.js';

const held = new Set();
const pressed = new Set();
let mouseHeld = false;
let mousePressed = false;
let lookX = 0;
let lookY = 0;
let wheelDelta = 0;
let locked = false;
let canvasEl = null;

export function initInput(canvas) {
  canvasEl = canvas;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    held.add(e.code);
    pressed.add(e.code);
    if (e.code === KEYS.brake) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => { held.clear(); mouseHeld = false; });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    mouseHeld = true;
    mousePressed = true;
    lockPointer();
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseHeld = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    lookX += e.movementX || 0;
    lookY += e.movementY || 0;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelDelta += e.deltaY;
  }, { passive: false });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvasEl;
  });
  // Clicking the canvas also starts the game from the title screen.
  canvas.addEventListener('click', () => {
    if (!locked) lockPointer();
  });
}

export function lockPointer() {
  if (!canvasEl) return;
  try {
    const p = canvasEl.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch { /* pointer lock unavailable (headless shot mode) */ }
}

export function isDown(code) { return held.has(code); }
export function justPressed(code) { return pressed.has(code); }
export function mouseDown() { return mouseHeld; }
export function mouseClicked() { return mousePressed; }

// Driving axes in [-1, 1]: throttle (+1 forward), steer (+1 right).
export function driveAxes() {
  const throttle = (isDown(KEYS.forward) ? 1 : 0) - (isDown(KEYS.back) ? 1 : 0);
  const steer = (isDown(KEYS.right) ? 1 : 0) - (isDown(KEYS.left) ? 1 : 0);
  return { throttle, steer, brake: isDown(KEYS.brake) };
}

// On-foot move axes: x = strafe right, z = forward (camera-relative in main.js).
export function walkAxes() {
  const x = (isDown(KEYS.right) ? 1 : 0) - (isDown(KEYS.left) ? 1 : 0);
  const z = (isDown(KEYS.forward) ? 1 : 0) - (isDown(KEYS.back) ? 1 : 0);
  return { x, z, sprint: isDown(KEYS.sprint) };
}

// Consume accumulated look deltas since the last call (radians-ish pixels).
export function takeLook() {
  const dx = lookX;
  const dy = lookY;
  lookX = 0;
  lookY = 0;
  return { dx, dy };
}

// Consume accumulated wheel scroll since the last call, in zoom steps:
// positive pulls the chase camera back, negative pushes it in.
export function takeZoom() {
  const steps = Math.trunc(wheelDelta / 120);
  wheelDelta -= steps * 120;
  return steps;
}

export function resetFrame() {
  pressed.clear();
  mousePressed = false;
}

export function anyKeyPressed() { return pressed.size > 0 || mousePressed; }
