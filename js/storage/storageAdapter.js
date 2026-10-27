import { CONFIG } from '../config.js';
import { createInitialDemoState } from './seed.js';
import { mergeTripInMemory } from './merge.js';
import {
  generateId,
  encodePayloadToBase64,
  decodePayloadFromBase64,
  exportTripPayload
} from './syncCodec.js';

export {
  generateId,
  encodePayloadToBase64,
  decodePayloadFromBase64,
  exportTripPayload
} from './syncCodec.js';

export function loadState() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CONFIG.APP_STORAGE_KEY) : null;
    if (!raw) {
      const initial = createInitialDemoState();
      saveState(initial);
      return initial;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.trips)) {
      const initial = createInitialDemoState();
      saveState(initial);
      return initial;
    }
    return parsed;
  } catch (err) {
    console.error('Failed to load state from localStorage:', err);
    return createInitialDemoState();
  }
}

export function saveState(state) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CONFIG.APP_STORAGE_KEY, JSON.stringify(state));
    }
  } catch (err) {
    console.error('Failed to save state to localStorage:', err);
  }
}

export function mergeTripPayload(state, payload) {
  const stats = mergeTripInMemory(state, payload);
  saveState(state);
  return stats;
}

export function exportFullBackup(state) {
  return JSON.stringify({
    backupType: 'TRIPSPLIT_FULL_BACKUP_V1',
    exportedAt: Date.now(),
    state
  }, null, 2);
}

export function restoreFullBackup(rawJson) {
  const parsed = JSON.parse(rawJson);
  const restoredState = parsed.state || parsed;
  if (!restoredState || !Array.isArray(restoredState.trips)) {
    throw new Error('Invalid backup file format.');
  }
  if (!restoredState.activeIdentities || typeof restoredState.activeIdentities !== 'object') {
    restoredState.activeIdentities = {};
  }
  saveState(restoredState);
  return restoredState;
}

export const StorageService = {
  generateId,
  encodePayloadToBase64,
  decodePayloadFromBase64,
  exportTripPayload,
  loadState,
  saveState,
  mergeTripPayload,
  exportFullBackup,
  restoreFullBackup
};
