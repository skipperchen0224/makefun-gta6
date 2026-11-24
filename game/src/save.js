// Persists cash, completed missions, best wanted, drift record and lead choice in localStorage.
// Round 4 re-record: the save is one versioned localStorage key — version 1, cash, missions, lead, armour, drift.
// Palmetto Heat — save / load through localStorage.
// One versioned key; a corrupt or foreign payload is ignored, never fatal.
// Round 4: the versioned key means a corrupt payload is ignored, never fatal.
// The payload now also remembers which lead you play (Lucia or Jason),
// your armour, and your best banked drift, on top of cash and missions.

const KEY = 'palmetto-heat-save-v1';

export function hasSave() {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return {
      cash: Number(data.cash) || 0,
      completed: Array.isArray(data.completed) ? data.completed.filter(Number.isInteger) : [],
      bestWanted: Number(data.bestWanted) || 0,
      playSeconds: Number(data.playSeconds) || 0,
      character: data.character === 'jason' ? 'jason' : 'lucia',
      armor: Number(data.armor) || 0,
      bestDrift: Number(data.bestDrift) || 0,
      ammo: data.ammo && typeof data.ammo === 'object' ? data.ammo : null, // Round 5: weapon mags + reserves
    };
  } catch {
    return null;
  }
}

export function writeSave(state) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      version: 1,
      cash: state.cash,
      completed: state.completed,
      bestWanted: state.bestWanted,
      playSeconds: Math.floor(state.playSeconds),
      character: state.character || 'lucia',
      armor: Math.floor(state.armor || 0),
      bestDrift: Math.floor(state.bestDrift || 0),
      ammo: state.ammo || null, // Round 5: weapon mags + reserves, restored on load
      savedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    window.localStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
}
