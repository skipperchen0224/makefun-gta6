// A 100 BPM synthwave loop whose mood (day, night, chase) follows the wanted level and the clock.
// Round 5 re-record: the chase mood now also follows gunfire — a shootout tightens the mix.
// Round 4 re-record: the loop is 64 sixteenth-note steps — four bars of A minor, bass, arp, pad and kick.
// Palmetto Heat — synthwave BGM, synthesized live, no audio files.
// A 100 BPM loop in A minor: saw bass on the eighths, a square arp on the
// sixteenths, a slow pad under Am–F–C–G, and a sine kick on the beat. A
// lookahead scheduler (25 ms tick, 0.12 s ahead) keeps it tight. M toggles
// it; the mix darkens at night and tightens in a chase.
// Round 4: the mood filter darkens at night (900 Hz) and opens up in a chase (2600 Hz).

import { ensureAudioContext } from './audio.js';

const BPM = 100;
const STEP = 60 / BPM / 4; // one 16th note
const STEPS_PER_LOOP = 64; // four bars
const BASS = [55, 0, 55, 0, 65.41, 0, 55, 0, 49, 0, 49, 0, 58.27, 0, 82.41, 0];
const ARP = [220, 261.63, 329.63, 440, 329.63, 261.63, 220, 261.63,
  174.61, 220, 261.63, 349.23, 261.63, 220, 174.61, 220];
const CHORDS = [
  [220, 261.63, 329.63], // Am
  [174.61, 220, 261.63], // F
  [130.81, 196, 261.63], // C
  [196, 246.94, 293.66], // G
];

let audio = null;
let filterNode = null;
let busGain = null;
let playing = false;
let timer = null;
let step = 0;
let nextTime = 0;
let mood = 'day';

export function isBgmPlaying() { return playing; }
export function getBgmMood() { return mood; }

export function setBgmMood(m) {
  mood = m;
  if (filterNode && audio) {
    const cutoff = m === 'chase' ? 2600 : m === 'night' ? 900 : 1400;
    filterNode.frequency.setTargetAtTime(cutoff, audio.ctx.currentTime, 0.4);
  }
}

export function startBgm() {
  if (playing) return true;
  audio = ensureAudioContext();
  if (!audio) return false;
  const { ctx, master } = audio;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  filterNode = ctx.createBiquadFilter();
  filterNode.type = 'lowpass';
  filterNode.frequency.value = mood === 'night' ? 900 : 1400;
  busGain = ctx.createGain();
  busGain.gain.value = 0.16;
  filterNode.connect(busGain).connect(master);
  step = 0;
  nextTime = ctx.currentTime + 0.08;
  playing = true;
  timer = setInterval(scheduleAhead, 25);
  return true;
}

export function stopBgm() {
  if (!playing) return;
  playing = false;
  if (timer) { clearInterval(timer); timer = null; }
  if (busGain && audio) busGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05);
  filterNode = null;
  busGain = null;
}

function scheduleAhead() {
  if (!playing || !audio) return;
  while (nextTime < audio.ctx.currentTime + 0.12) {
    scheduleStep(step, nextTime);
    step = (step + 1) % STEPS_PER_LOOP;
    nextTime += STEP;
  }
}

function scheduleStep(s, t) {
  const bar = Math.floor(s / 16) % 4;
  const bass = BASS[s % 16];
  if (bass) note('sawtooth', bass, t, STEP * 1.8, 0.2, 320);
  note('square', ARP[s % 16] * 2, t, STEP * 0.9, 0.04, 1800);
  if (s % 4 === 0) kick(t);
  if (s % 16 === 0) pad(CHORDS[bar], t, STEP * 16);
}

function note(type, freq, t, dur, vol, cutoff) {
  const { ctx } = audio;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    o.type = type;
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g).connect(filterNode);
    o.start(t);
    o.stop(t + dur + 0.05);
  } catch { /* best-effort */ }
}

function kick(t) {
  const { ctx } = audio;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(g).connect(filterNode);
    o.start(t);
    o.stop(t + 0.15);
  } catch { /* best-effort */ }
}

function pad(freqs, t, dur) {
  const { ctx } = audio;
  for (const freq of freqs) {
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.028, t + 0.5);
      g.gain.setValueAtTime(0.028, t + dur - 0.4);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(filterNode);
      o.start(t);
      o.stop(t + dur + 0.05);
    } catch { /* best-effort */ }
  }
}
