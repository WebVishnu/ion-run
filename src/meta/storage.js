import { defaultSave, ensureGoals, normalizeSave } from './progress.js';

const KEY = 'ion-run:save:v1';

/** localStorage can throw (private mode, blocked storage). Everything degrades to in-memory. */
let memory = null;

export function loadSave() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    raw = memory;
  }
  const save = normalizeSave(raw ?? memory);
  if (!raw && !memory) save.settings.reducedMotion = prefersReducedMotion();
  ensureGoals(save);
  memory = save;
  return save;
}

export function writeSave(save) {
  memory = save;
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function resetSave() {
  const save = defaultSave();
  save.settings.reducedMotion = prefersReducedMotion();
  ensureGoals(save);
  writeSave(save);
  return save;
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
