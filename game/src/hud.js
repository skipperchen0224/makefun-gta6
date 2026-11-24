// Cash, health, armour, stars, clock, mission text and the 2D minimap all live on plain DOM.
// Also: lead chip, drift score, weapon/ammo, car health, story cards, pause and lobby badge.
// The minimap draws the objective gold, cops flashing, pickups and the player green.

let el = {};
let minimap = null;
let mctx = null;
let lastStars = -1;
let lastArmor = -1;
let lastChar = '';
let lastClock = '';
let lastWeather = '';
let messageTimer = null;

export function initHud() {
  el = {
    cash: document.getElementById('hud-cash'),
    healthFill: document.getElementById('health-fill'),
    armorFill: document.getElementById('armor-fill'),
    stars: document.getElementById('hud-stars'),
    mission: document.getElementById('hud-mission'),
    speed: document.getElementById('hud-speed'),
    message: document.getElementById('hud-message'),
    banner: document.getElementById('hud-banner'),
    title: document.getElementById('title-screen'),
    end: document.getElementById('end-screen'),
    endTitle: document.getElementById('end-title'),
    endText: document.getElementById('end-text'),
    help: document.getElementById('hud-help'),
    character: document.getElementById('hud-character'),
    clock: document.getElementById('hud-clock'),
    weather: document.getElementById('hud-weather'),
    drift: document.getElementById('hud-drift'),
    mp: document.getElementById('hud-mp'),
    weapon: document.getElementById('hud-weapon'),
    carhp: document.getElementById('hud-carhp'),
    carhpFill: document.getElementById('carhp-fill'),
    story: document.getElementById('hud-story'),
    paused: document.getElementById('hud-paused'),
    titleSave: document.getElementById('title-save'),
  };
  minimap = document.getElementById('minimap');
  if (minimap) mctx = minimap.getContext('2d');
}

export function setCash(n) {
  if (el.cash) el.cash.textContent = `$${Math.floor(n).toLocaleString('en-US')}`;
}

export function setHealth(hp) {
  if (!el.healthFill) return;
  const pct = Math.max(0, Math.min(100, hp));
  el.healthFill.style.width = `${pct}%`;
  el.healthFill.style.background = pct > 50 ? '#37c978' : pct > 25 ? '#f5a623' : '#e5484d';
}

// Armour bar: blue, drains before health does. `max` is the lead's cap.
export function setArmor(armor, max) {
  if (!el.armorFill) return;
  const pct = max > 0 ? Math.max(0, Math.min(100, (armor / max) * 100)) : 0;
  const key = Math.round(pct);
  if (key === lastArmor) return;
  lastArmor = key;
  el.armorFill.style.width = `${pct}%`;
}

export function setStars(n) {
  if (!el.stars) return;
  if (n === lastStars) return;
  lastStars = n;
  el.stars.textContent = '★'.repeat(n) + '☆'.repeat(5 - n);
  el.stars.classList.toggle('hot', n >= 3);
}

// Round 5: stars flash pale blue while no cop can see you and they are about to drop.
export function setEvading(on) {
  if (el.stars) el.stars.classList.toggle('evading', on);
}

export function setWeapon(text) {
  if (el.weapon && el.weapon.textContent !== text) el.weapon.textContent = text;
}

// Car damage bar, shown only while driving.
export function setCarHealth(hp) {
  if (!el.carhp) return;
  el.carhp.classList.toggle('show', hp !== null);
  if (hp !== null) el.carhpFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
}

let storyTimer = null;
export function showStory(speaker, text, ms = 7000) {
  if (!el.story) return;
  el.story.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = speaker;
  el.story.append(b, document.createTextNode(text));
  el.story.classList.add('show');
  if (storyTimer) clearTimeout(storyTimer);
  storyTimer = setTimeout(() => el.story.classList.remove('show'), ms);
}

export function showPaused(on) {
  if (el.paused) el.paused.classList.toggle('show', on);
}

export function setTitleSave(text) {
  if (el.titleSave) el.titleSave.textContent = text;
}

export function setMission(text) {
  if (el.mission && el.mission.textContent !== text) el.mission.textContent = text;
}

export function setSpeed(kmh) {
  if (el.speed) el.speed.textContent = `${Math.max(0, Math.round(kmh))} km/h`;
}

export function setHelp(text) {
  if (el.help) el.help.textContent = text;
}

// Character chip: "LUCIA · Wheelwoman" — updates on a Q swap.
export function setCharacter(name, tag) {
  if (!el.character) return;
  const text = `${name} · ${tag}`;
  if (text === lastChar) return;
  lastChar = text;
  el.character.textContent = text;
}

export function setClock(label) {
  if (!el.clock) return;
  if (label === lastClock) return;
  lastClock = label;
  el.clock.textContent = label;
}

export function setWeather(label) {
  if (!el.weather) return;
  if (label === lastWeather) return;
  lastWeather = label;
  el.weather.textContent = label;
}

// Drift score: shows while sliding, hides a beat after the slide ends.
export function setDrift(score) {
  if (!el.drift) return;
  if (score > 0) {
    el.drift.textContent = `DRIFT +${Math.floor(score)}`;
    el.drift.classList.add('show');
  } else {
    el.drift.classList.remove('show');
  }
}

// Multiplayer badge: hidden offline, "MP · 3 online" in a lobby.
export function setMp(text) {
  if (!el.mp) return;
  if (text) {
    el.mp.textContent = text;
    el.mp.classList.add('show');
  } else {
    el.mp.classList.remove('show');
  }
}

export function showMessage(text, ms = 2600) {
  if (!el.message) return;
  el.message.textContent = text;
  el.message.classList.add('show');
  if (messageTimer) clearTimeout(messageTimer);
  messageTimer = setTimeout(() => el.message.classList.remove('show'), ms);
}

export function showBanner(text, ms = 3200) {
  if (!el.banner) return;
  el.banner.textContent = text;
  el.banner.classList.add('show');
  setTimeout(() => el.banner.classList.remove('show'), ms);
}

export function showTitle(visible) {
  if (el.title) el.title.classList.toggle('hidden', !visible);
}

export function showEnd(title, text) {
  if (!el.end) return;
  if (el.endTitle) el.endTitle.textContent = title;
  if (el.endText) el.endText.textContent = text;
  el.end.classList.remove('hidden');
}

export function hideEnd() {
  if (el.end) el.end.classList.add('hidden');
}

// Minimap: 168px canvas, world 480m -> scale, player centred-ish (fixed north-up).
// Dots: player green, traffic white, cops flashing blue/red, objective gold.
export function drawMinimap(world) {
  if (!mctx || !minimap) return;
  const S = minimap.width;
  const scale = S / 520;
  const toMap = (x, z) => [S / 2 + x * scale, S / 2 + z * scale];
  mctx.clearRect(0, 0, S, S);
  mctx.fillStyle = '#20262e';
  mctx.fillRect(0, 0, S, S);
  // Roads.
  mctx.strokeStyle = '#4a5058';
  mctx.lineWidth = 3;
  for (let c = -240; c <= 240; c += 40) {
    const [x1, y1] = toMap(c, -260);
    const [x2, y2] = toMap(c, 260);
    mctx.beginPath(); mctx.moveTo(x1, y1); mctx.lineTo(x2, y2); mctx.stroke();
    const [x3, y3] = toMap(-260, c);
    const [x4, y4] = toMap(260, c);
    mctx.beginPath(); mctx.moveTo(x3, y3); mctx.lineTo(x4, y4); mctx.stroke();
  }
  // Sea on the east edge.
  mctx.fillStyle = '#2e7fa8';
  mctx.fillRect(S / 2 + 240 * scale, 0, S, S);
  // Objective marker.
  if (world.objective) {
    const [ox, oy] = toMap(world.objective.x, world.objective.z);
    mctx.fillStyle = '#ffd34d';
    mctx.beginPath(); mctx.arc(ox, oy, 6, 0, Math.PI * 2); mctx.fill();
    mctx.strokeStyle = '#fff2cc';
    mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(ox, oy, 9, 0, Math.PI * 2); mctx.stroke();
  }
  // Traffic.
  mctx.fillStyle = '#e8e8e8';
  for (const c of world.traffic || []) {
    const [cx, cy] = toMap(c.x, c.z);
    mctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  }
  // Cops flash.
  const flash = Math.floor(performance.now() / 300) % 2 === 0;
  mctx.fillStyle = flash ? '#ff3333' : '#3388ff';
  for (const c of world.cops || []) {
    const [cx, cy] = toMap(c.x, c.z);
    mctx.beginPath(); mctx.arc(cx, cy, 3.5, 0, Math.PI * 2); mctx.fill();
  }
  // Player: green triangle pointing along heading.
  const [px, py] = toMap(world.player.x, world.player.z);
  mctx.save();
  mctx.translate(px, py);
  mctx.rotate(Math.atan2(Math.sin(world.player.heading), Math.cos(world.player.heading)));
  mctx.fillStyle = '#37c978';
  mctx.beginPath();
  mctx.moveTo(0, -7); mctx.lineTo(5, 5); mctx.lineTo(-5, 5); mctx.closePath();
  mctx.fill();
  mctx.restore();
}
