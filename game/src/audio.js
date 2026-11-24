// All effects are synthesized with WebAudio oscillators and filtered noise; the game ships no sound files.
// Round 4 re-record: the engine hum follows speed, the siren follows stars — both are oscillators, not samples.
// Palmetto Heat — synthesized sound, no audio files.
// Everything is WebAudio oscillators and filtered noise, built lazily on the
// first user gesture so headless screenshot runs stay silent and error-free.
// Round 4: the rain bed and the engine hum share this module's master gain.
// New in this round: a car horn, a character-swap sting, a tyre-skid hiss
// for drifting, a looping rain bed, and ensureAudioContext() so the BGM
// sequencer (bgm.js) can share this context and master gain.

let ctx = null;
let master = null;
let muted = false;
let engineOsc = null;
let engineGain = null;
let sirenOsc = null;
let sirenGain = null;
let sirenTimer = null;
let rainNodes = null;

function ensure() {
  if (ctx) return true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch {
    return false;
  }
  return true;
}

// Shared by bgm.js: the one context and master gain for all game audio.
export function ensureAudioContext() {
  if (!ensure()) return null;
  return { ctx, master };
}

export function initAudio() { ensure(); }
export function resumeAudio() {
  if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
}
export function setMuted(m) {
  muted = m;
  if (master && ctx) master.gain.value = m ? 0 : 0.5;
}

// Short blip: square wave with a fast decay. `freq` Hz, `dur` seconds.
export function blip(freq, dur = 0.08, type = 'square', vol = 0.25) {
  if (!ensure() || muted) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(master);
    o.start();
    o.stop(ctx.currentTime + dur);
  } catch { /* audio is best-effort */ }
}

// White-noise burst through a low-pass filter: gunshots, crashes, explosions.
export function noiseBurst(dur = 0.18, cutoff = 1200, vol = 0.5) {
  if (!ensure() || muted) return;
  try {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(filter).connect(g).connect(master);
    src.start();
  } catch { /* best-effort */ }
}

export function playGunshot() { noiseBurst(0.14, 2500, 0.55); blip(140, 0.06, 'sawtooth', 0.2); }
// Round 5: reload click-clack — two short metallic ticks 0.4 s apart.
export function playReload() { blip(880, 0.05, 'square', 0.18); setTimeout(() => blip(620, 0.07, 'square', 0.2), 380); }
export function playPickup() { blip(660, 0.09, 'sine', 0.3); setTimeout(() => blip(990, 0.12, 'sine', 0.3), 90); }
export function playMissionDone() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.14, 'triangle', 0.3), i * 110)); }
export function playFail() { [330, 262, 196].forEach((f, i) => setTimeout(() => blip(f, 0.18, 'sawtooth', 0.22), i * 140)); }
export function playCrash() { noiseBurst(0.3, 500, 0.6); }
export function playBusted() { [440, 415, 392, 370].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'sawtooth', 0.25), i * 160)); }

// Two-tone car horn (H): a short beep-beep that scares nearby peds.
export function playHorn() {
  if (!ensure() || muted) return;
  blip(370, 0.14, 'square', 0.22);
  setTimeout(() => blip(466, 0.16, 'square', 0.22), 130);
}

// Character swap (Q): a quick rising whoosh.
export function playSwap() {
  noiseBurst(0.22, 3200, 0.22);
  blip(440, 0.1, 'sine', 0.2);
  setTimeout(() => blip(660, 0.14, 'sine', 0.2), 80);
}

// Tyre skid while drifting: a short high hiss, called at most twice a second.
export function playSkid() { noiseBurst(0.22, 5200, 0.16); }

// Rain bed: a looped noise buffer through a low-pass, started when the
// weather turns wet and stopped when it clears.
export function rainStart() {
  if (!ensure() || rainNodes) return;
  try {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(filter).connect(g).connect(master);
    src.start();
    rainNodes = { src, g };
  } catch { rainNodes = null; }
}
export function rainStop() {
  if (!rainNodes) return;
  try { rainNodes.src.stop(); } catch { /* already stopped */ }
  rainNodes = null;
}

// Continuous engine hum whose pitch follows speed (0..1).
export function engineStart() {
  if (!ensure() || engineOsc) return;
  try {
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0.0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    engineOsc.connect(filter).connect(engineGain).connect(master);
    engineOsc.start();
  } catch { engineOsc = null; }
}
export function engineSet(speed01, on) {
  if (!engineOsc || !ctx) return;
  const t = ctx.currentTime;
  engineGain.gain.setTargetAtTime(on ? 0.05 + speed01 * 0.07 : 0.0, t, 0.08);
  engineOsc.frequency.setTargetAtTime(55 + speed01 * 140, t, 0.08);
}
export function engineStop() {
  if (!engineOsc) return;
  try { engineOsc.stop(); } catch { /* already stopped */ }
  engineOsc = null;
}

// Two-tone police siren while any cop is in chase.
export function sirenStart() {
  if (!ensure() || sirenOsc) return;
  try {
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 700;
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0.045;
    sirenOsc.connect(sirenGain).connect(master);
    sirenOsc.start();
    let high = true;
    sirenTimer = setInterval(() => {
      if (!sirenOsc) return;
      high = !high;
      sirenOsc.frequency.setTargetAtTime(high ? 950 : 650, ctx.currentTime, 0.05);
    }, 420);
  } catch { sirenOsc = null; }
}
export function sirenStop() {
  if (sirenTimer) { clearInterval(sirenTimer); sirenTimer = null; }
  if (!sirenOsc) return;
  try { sirenOsc.stop(); } catch { /* already stopped */ }
  sirenOsc = null;
}
