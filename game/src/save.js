import { SAVE_KEY } from './config.js';

export function loadSave() {
  try {
    const data = localStorage.getItem(SAVE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Failed to load save", e);
  }
  return { money: 0, bestMoney: 0, missionIndex: 0, muted: false };
}

export function saveSave(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save", e);
  }
}
