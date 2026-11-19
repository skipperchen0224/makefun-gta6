// Palmetto Heat — save / load through localStorage.
// One versioned key; a corrupt or foreign payload is ignored, never fatal.

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
