// An eight-minute day, rain and storm states, and the onNight hook the
// whole city listens to. Round 5: rain is 700 vertical streaks (LineSegments)
// instead of square dots, and the fog colour follows the sky so dusk and
// storm horizons blend instead of banding.
import * as THREE from 'three';
import { clamp } from './config.js';

export const WEATHER_KINDS = ['clear', 'rain', 'storm'];
const DAY_LENGTH = 480;
const RAIN_DROPS = 700;
const STREAK = 0.9;

let sceneRef = null;
let sunRef = null;
let hemiRef = null;
let rainLines = null;
let rainSpeed = null;
let hour = 10.5;
let weather = 'clear';
let weatherTimer = 90;
let flash = 0;
let flashTimer = 6 + Math.random() * 8;
let onNightChange = null;
let wasNight = false;

const daySky = new THREE.Color(0x8ec9e8);
const nightSky = new THREE.Color(0x0e1a2e);
const rainSky = new THREE.Color(0x5f7280);
const noonSun = new THREE.Color(0xfff2d9);
const duskSun = new THREE.Color(0xff9a4d);
const nightSun = new THREE.Color(0x8fb4ff);
const tmpColor = new THREE.Color();

export function initWeather(scene, sun, hemi, startHour = 10.5) {
  sceneRef = scene;
  sunRef = sun;
  hemiRef = hemi;
  hour = startHour;
  weather = 'clear';
  weatherTimer = 75 + Math.random() * 60;
  wasNight = isNight();
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(RAIN_DROPS * 2 * 3);
  rainSpeed = new Float32Array(RAIN_DROPS);
  for (let i = 0; i < RAIN_DROPS; i++) {
    const x = (Math.random() - 0.5) * 70;
    const y = Math.random() * 40;
    const z = (Math.random() - 0.5) * 70;
    pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
    pos[i * 6 + 3] = x; pos[i * 6 + 4] = y + STREAK; pos[i * 6 + 5] = z;
    rainSpeed[i] = 42 + Math.random() * 22;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rainLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: 0xbfd9e8, transparent: true, opacity: 0.5,
  }));
  rainLines.visible = false;
  rainLines.frustumCulled = false;
  scene.add(rainLines);
}

export function setWeather(kind) {
  if (!WEATHER_KINDS.includes(kind)) return weather;
  weather = kind;
  weatherTimer = 60 + Math.random() * 90;
  if (rainLines) rainLines.visible = kind !== 'clear';
  return weather;
}

export function setHour(h) {
  hour = ((h % 24) + 24) % 24;
  // Do NOT touch wasNight here: the next updateWeather tick must notice
  // the day/night boundary crossing and fire onNight (lamps, searchlight).
}

export function getHour() { return hour; }
export function getWeather() { return weather; }
export function isNight() { return hour < 6 || hour >= 19; }

export function getClockLabel() {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getWeatherLabel() {
  return weather === 'clear' ? 'Clear' : weather === 'rain' ? 'Rain' : 'Storm';
}

export function onNight(fn) { onNightChange = fn; }

function rollWeather() {
  const r = Math.random();
  if (weather === 'clear') setWeather(r < 0.62 ? 'clear' : r < 0.88 ? 'rain' : 'storm');
  else if (weather === 'rain') setWeather(r < 0.35 ? 'storm' : r < 0.7 ? 'rain' : 'clear');
  else setWeather(r < 0.55 ? 'rain' : 'clear');
}

export function updateWeather(dt, camPos) {
  if (!sceneRef) return;
  hour = (hour + (dt / DAY_LENGTH) * 24) % 24;
  const ang = ((hour - 6) / 12) * Math.PI;
  const elev = Math.sin(ang);
  const dayF = clamp(elev * 1.6 + 0.25, 0, 1);
  const duskF = clamp(1 - Math.abs(elev) * 4, 0, 1) * (hour > 5 && hour < 20 ? 1 : 0);
  sunRef.position.set(Math.cos(ang) * 180, Math.max(elev, 0.06) * 200, 60);
  tmpColor.copy(noonSun).lerp(nightSun, 1 - dayF).lerp(duskSun, duskF * 0.6);
  sunRef.color.copy(tmpColor);
  sunRef.intensity = 0.25 + dayF * 2.4;
  hemiRef.intensity = 0.22 + dayF * 0.55;
  tmpColor.copy(daySky).lerp(nightSky, 1 - dayF);
  if (weather !== 'clear') tmpColor.lerp(rainSky, weather === 'storm' ? 0.55 : 0.35);
  sceneRef.background.copy(tmpColor);
  if (sceneRef.fog) {
    sceneRef.fog.color.copy(tmpColor); // Round 5: fog follows the sky colour
    sceneRef.fog.near = weather === 'storm' ? 90 : weather === 'rain' ? 130 : 180;
    sceneRef.fog.far = weather === 'storm' ? 300 : weather === 'rain' ? 400 : 520;
  }
  weatherTimer -= dt;
  if (weatherTimer <= 0) rollWeather();
  if (rainLines && rainLines.visible) {
    const pos = rainLines.geometry.attributes.position.array;
    const fall = weather === 'storm' ? 1.7 : 1;
    const wind = weather === 'storm' ? -6 : -1.5;
    for (let i = 0; i < RAIN_DROPS; i++) {
      let y = pos[i * 6 + 1] - rainSpeed[i] * fall * dt;
      let x = pos[i * 6] + wind * dt;
      if (y < 0) {
        x = camPos.x + (Math.random() - 0.5) * 70;
        y = 32 + Math.random() * 8;
        pos[i * 6 + 2] = camPos.z + (Math.random() - 0.5) * 70;
      }
      pos[i * 6] = x; pos[i * 6 + 1] = y;
      pos[i * 6 + 3] = x; pos[i * 6 + 4] = y + STREAK; pos[i * 6 + 5] = pos[i * 6 + 2];
    }
    rainLines.geometry.attributes.position.needsUpdate = true;
  }
  if (weather === 'storm') {
    flashTimer -= dt;
    if (flashTimer <= 0) {
      flash = 1;
      flashTimer = 5 + Math.random() * 9;
    }
  }
  if (flash > 0) {
    flash = Math.max(0, flash - dt * 2.2);
    hemiRef.intensity += flash * 1.6;
  }
  const night = isNight();
  if (night !== wasNight) {
    wasNight = night;
    if (onNightChange) onNightChange(night);
  }
}
