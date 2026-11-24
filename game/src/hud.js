// Cash, health, armour, stars, clock, mission text and the 2D minimap all
// live on plain DOM. Round 5 adds the weapon + ammo readout, the car health
// bar while driving, the story dialogue card, blue flashing stars while
// you are shaking the heat, and the save summary on the title screen.
let el = {};
let minimap = null;
let mctx = null;
let lastStars = -1;
let lastArmor = -1;
let lastChar = '';
let lastClock = '';
let lastWeather = '';
let lastWeapon = '';
let lastCarHp = -1;
let messageTimer = null;
let dialogueTimer = null;

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
    carHealth: document.getElementById('hud-carhealth'),
    carHealthFill: document.getElementById('carhealth-fill'),
    dialogue: document.getElementById('hud-dialogue'),
    dialogueWho: document.getElementById('dialogue-who'),
    dialogueLine: document.getElementById('dialogue-line'),
    saveSummary: document.getElementById('save-summary'),
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

// Round 5: while no cop sees you, the stars flash blue — you are losing them.
export function setStarsEvading(on) {
  if (!el.stars) return;
  el.stars.classList.toggle('evading', !!on);
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

export function setDrift(score) {
  if (!el.drift) return;
  if (score > 0) {
    el.drift.textContent = `DRIFT +${Math.floor(score)}`;
    el.drift.classList.add('show');
  } else {
    el.drift.classList.remove('show');
  }
}

export function setMp(text) {
  if (!el.mp) return;
  if (text) {
    el.mp.textContent = text;
    el.mp.classList.add('show');
  } else {
    el.mp.classList.remove('show');
  }
}

// Round 5: weapon readout, e.g. "SMG · 24 / 150" or "Pistol · RELOADING".
export function setWeapon(name, mag, reserve, reloading) {
  if (!el.weapon) return;
  const text = reloading ? `${name} · RELOADING` : `${name} · ${mag} / ${reserve}`;
  if (text === lastWeapon) return;
  lastWeapon = text;
  el.weapon.textContent = text;
}

// Round 5: the car health bar, only visible while driving.
export function setCarHealth(hp, visible) {
  if (!el.carHealth || !el.carHealthFill) return;
  el.carHealth.classList.toggle('show', !!visible);
  const key = Math.round(hp);
  if (key === lastCarHp) return;
  lastCarHp = key;
  const pct = Math.max(0, Math.min(100, hp));
  el.carHealthFill.style.width = `${pct}%`;
  el.carHealthFill.style.background = pct > 50 ? '#37c978' : pct > 25 ? '#f5a623' : '#e5484d';
}

// Round 5: a story card after each finished mission.
export function showDialogue(who, line, ms = 5200) {
  if (!el.dialogue) return;
  if (el.dialogueWho) el.dialogueWho.textContent = who;
  if (el.dialogueLine) el.dialogueLine.textContent = line;
  el.dialogue.classList.add('show');
  if (dialogueTimer) clearTimeout(dialogueTimer);
  dialogueTimer = setTimeout(() => el.dialogue.classList.remove('show'), ms);
}

export function setSaveSummary(text) {
  if (!el.saveSummary) return;
  el.saveSummary.textContent = text || '';
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

export function drawMinimap(world) {
  if (!mctx || !minimap) return;
  const S = minimap.width;
  const scale = S / 520;
  const toMap = (x, z) => [S / 2 + x * scale, S / 2 + z * scale];
  mctx.clearRect(0, 0, S, S);
  mctx.fillStyle = '#20262e';
  mctx.fillRect(0, 0, S, S);
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
  mctx.fillStyle = '#2e7fa8';
  mctx.fillRect(S / 2 + 240 * scale, 0, S, S);
  if (world.objective) {
    const [ox, oy] = toMap(world.objective.x, world.objective.z);
    mctx.fillStyle = '#ffd34d';
    mctx.beginPath(); mctx.arc(ox, oy, 6, 0, Math.PI * 2); mctx.fill();
    mctx.strokeStyle = '#fff2cc';
    mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(ox, oy, 9, 0, Math.PI * 2); mctx.stroke();
  }
  mctx.fillStyle = '#e8e8e8';
  for (const c of world.traffic || []) {
    const [cx, cy] = toMap(c.x, c.z);
    mctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  }
  const flash = Math.floor(performance.now() / 300) % 2 === 0;
  mctx.fillStyle = flash ? '#ff3333' : '#3388ff';
  for (const c of world.cops || []) {
    const [cx, cy] = toMap(c.x, c.z);
    mctx.beginPath(); mctx.arc(cx, cy, 3.5, 0, Math.PI * 2); mctx.fill();
  }
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
