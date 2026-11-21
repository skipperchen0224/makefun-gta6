// Palmetto Heat — weather and the day/night cycle.
// A 24-hour game clock runs over eight real minutes. The sun swings on it:
// dawn amber, noon white, dusk orange, night blue, with the city's lamps
// coming on after dark. Weather rolls between clear, rain and storm; rain
// is a Points cloud that follows the camera, and a storm flashes lightning.
// Round 4: setHour moves the clock but never the night flag, so the next tick fires the change.

import * as THREE from 'three';
import { clamp } from './config.js';

export const WEATHER_KINDS = ['clear', 'rain', 'storm'];
const DAY_LENGTH = 480; // seconds per full game day
const RAIN_DROPS = 700;

let sceneRef = null;
let sunRef = null;
let hemiRef = null;
let rainPoints = null;
let rainSpeed = null;
let hour = 10.5; // 10:30 in the morning
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
  // Rain: one pooled Points cloud, hidden until it rains.
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(RAIN_DROPS * 3);
  rainSpeed = new Float32Array(RAIN_DROPS);
  for (let i = 0; i < RAIN_DROPS; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 70;
    pos[i * 3 + 1] = Math.random() * 40;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    rainSpeed[i] = 42 + Math.random() * 22;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rainPoints = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xbfd9e8, size: 0.32, transparent: true, opacity: 0.55, sizeAttenuation: true,
  }));
  rainPoints.visible = false;
  rainPoints.frustumCulled = false;
  scene.add(rainPoints);
}

export function setWeather(kind) {
  if (!WEATHER_KINDS.includes(kind)) return weather;
  weather = kind;
  weatherTimer = 60 + Math.random() * 90;
  if (rainPoints) rainPoints.visible = kind !== 'clear';
  return weather;
}

export function setHour(h) {
  hour = ((h % 24) + 24) % 24;
  // Do NOT touch wasNight here: the next updateWeather tick must notice
  // the day/night boundary crossing and fire onNight (lamps, searchlight).
  // That is how the night screenshot staging switches the city to night.
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

// Roll the dice on the next weather when the timer runs out.
function rollWeather() {
  const r = Math.random();
  if (weather === 'clear') setWeather(r < 0.62 ? 'clear' : r < 0.88 ? 'rain' : 'storm');
  else if (weather === 'rain') setWeather(r < 0.35 ? 'storm' : r < 0.7 ? 'rain' : 'clear');
  else setWeather(r < 0.55 ? 'rain' : 'clear');
}

export function updateWeather(dt, camPos) {
  if (!sceneRef) return;
  hour = (hour + (dt / DAY_LENGTH) * 24) % 24;

  // Sun elevation: 06:00 sunrise, 18:00 sunset, midnight below the horizon.
  const ang = ((hour - 6) / 12) * Math.PI;
  const elev = Math.sin(ang);
  const dayF = clamp(elev * 1.6 + 0.25, 0, 1); // 0 = night, 1 = full day
  const duskF = clamp(1 - Math.abs(elev) * 4, 0, 1) * (hour > 5 && hour < 20 ? 1 : 0);
  sunRef.position.set(Math.cos(ang) * 180, Math.max(elev, 0.06) * 200, 60);
  tmpColor.copy(noonSun).lerp(nightSun, 1 - dayF).lerp(duskSun, duskF * 0.6);
  sunRef.color.copy(tmpColor);
  sunRef.intensity = 0.25 + dayF * 2.4;
  hemiRef.intensity = 0.22 + dayF * 0.55;

  // Sky and fog follow the light; rain greys everything out.
  tmpColor.copy(daySky).lerp(nightSky, 1 - dayF);
  if (weather !== 'clear') tmpColor.lerp(rainSky, weather === 'storm' ? 0.55 : 0.35);
  sceneRef.background.copy(tmpColor);
  if (sceneRef.fog) {
    sceneRef.fog.near = weather === 'storm' ? 90 : weather === 'rain' ? 130 : 180;
    sceneRef.fog.far = weather === 'storm' ? 300 : weather === 'rain' ? 400 : 520;
  }

  // Weather timer.
  weatherTimer -= dt;
  if (weatherTimer <= 0) rollWeather();

  // Rain falls around the camera; storm adds wind slant and lightning.
  if (rainPoints && rainPoints.visible) {
    const pos = rainPoints.geometry.attributes.position.array;
    const fall = weather === 'storm' ? 1.7 : 1;
    const wind = weather === 'storm' ? -6 : -1.5;
    for (let i = 0; i < RAIN_DROPS; i++) {
      pos[i * 3 + 1] -= rainSpeed[i] * fall * dt;
      pos[i * 3] += wind * dt;
      if (pos[i * 3 + 1] < 0) {
        pos[i * 3] = camPos.x + (Math.random() - 0.5) * 70;
        pos[i * 3 + 1] = 32 + Math.random() * 8;
        pos[i * 3 + 2] = camPos.z + (Math.random() - 0.5) * 70;
      }
    }
    rainPoints.geometry.attributes.position.needsUpdate = true;
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

  // Night boundary: tell the city (lamps) and the cops (searchlight).
  const night = isNight();
  if (night !== wasNight) {
    wasNight = night;
    if (onNightChange) onNightChange(night);
  }
}
