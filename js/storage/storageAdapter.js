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

let syncStatus = 'idle';
let lastSyncedAt = null;
const statusListeners = new Set();

export function onSyncStatusChange(fn) {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}

export function getSyncStatus() {
  return { status: syncStatus, lastSyncedAt };
}

function notifySyncStatus(status, extra = {}) {
  syncStatus = status;
  if (status === 'synced') {
    lastSyncedAt = Date.now();
  }
  const event = { status: syncStatus, lastSyncedAt, ...extra };
  statusListeners.forEach(listener => {
    try {
      listener(event);
    } catch (err) {
      console.error('Error in sync status listener:', err);
    }
  });
}

function getTripFromState(state, tripId) {
  if (!state || !state.trips || !tripId) return null;
  if (state.trips[tripId]) return state.trips[tripId];
  if (Array.isArray(state.trips)) {
    return state.trips.find(t => t && t.id === tripId) || null;
  }
  return null;
}

let syncTimer = null;

export function scheduleCloudSync(state, tripId = state?.activeTripId, delayMs = 800) {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  if (typeof window === 'undefined') {
    return;
  }
  syncTimer = setTimeout(() => {
    syncTimer = null;
    StorageService.syncTripWithCloud(state, tripId);
  }, delayMs);
}

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

export function saveState(state, opts = {}) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CONFIG.APP_STORAGE_KEY, JSON.stringify(state));
    }
  } catch (err) {
    console.error('Failed to save state to localStorage:', err);
  }
  if (!opts?.skipCloud) {
    scheduleCloudSync(state);
  }
}

export async function syncTripWithCloud(state, tripId = state?.activeTripId) {
  const trip = getTripFromState(state, tripId);
  if (!tripId || !trip) {
    return { ok: false, error: 'No active trip' };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    notifySyncStatus('offline');
    return { ok: false, offline: true };
  }

  notifySyncStatus('syncing', { tripId });

  let res;
  try {
    res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exportTripPayload(trip))
    });
  } catch (fetchErr) {
    const errorMsg = fetchErr?.message || String(fetchErr);
    const status = (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'error';
    notifySyncStatus(status, { tripId, error: errorMsg });
    return { ok: false, error: errorMsg };
  }

  if (!res.ok) {
    let errBody;
    try {
      errBody = await res.json();
    } catch {
      errBody = null;
    }
    const error = errBody?.error || `HTTP ${res.status}: ${res.statusText || 'Sync failed'}`;
    notifySyncStatus('error', { tripId, error });
    return { ok: false, error };
  }

  let data;
  try {
    data = await res.json();
  } catch (parseErr) {
    const error = parseErr?.message || 'Invalid JSON response';
    notifySyncStatus('error', { tripId, error });
    return { ok: false, error };
  }

  if (data && data.ok && data.trip) {
    const previousActiveTripId = state.activeTripId;
    const stats = mergeTripInMemory(state, {
      type: 'TRIPSPLIT_SYNC_V1',
      app: CONFIG.APP_NAME,
      version: CONFIG.SCHEMA_VERSION,
      trip: data.trip
    });
    if (previousActiveTripId && previousActiveTripId !== tripId) {
      state.activeTripId = previousActiveTripId;
    }
    saveState(state, { skipCloud: true });
    notifySyncStatus('synced', { tripId, stats });
    const finalTrip = getTripFromState(state, tripId) || state?.trips?.[tripId];
    return { ok: true, trip: finalTrip, stats };
  }

  const error = data?.error || 'Sync failed: invalid response data';
  notifySyncStatus('error', { tripId, error });
  return { ok: false, error };
}

export async function pullTripFromCloud(state, tripId) {
  if (!tripId) {
    return { ok: false, error: 'No tripId provided' };
  }

  let res;
  try {
    res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/sync`);
  } catch (fetchErr) {
    const errorMsg = fetchErr?.message || String(fetchErr);
    const status = (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'error';
    notifySyncStatus(status, { tripId, error: errorMsg });
    return { ok: false, status: 0, error: errorMsg };
  }

  if (res.status === 200) {
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (data && data.ok && data.trip) {
      const stats = mergeTripInMemory(state, {
        type: 'TRIPSPLIT_SYNC_V1',
        app: CONFIG.APP_NAME,
        version: CONFIG.SCHEMA_VERSION,
        trip: data.trip
      });
      state.activeTripId = tripId;
      saveState(state, { skipCloud: true });
      notifySyncStatus('synced', { tripId, stats });
      const finalTrip = getTripFromState(state, tripId) || state?.trips?.[tripId];
      return { ok: true, trip: finalTrip, stats };
    }
  }

  return { ok: false, status: res.status };
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
  restoreFullBackup,
  onSyncStatusChange,
  getSyncStatus,
  syncTripWithCloud,
  pullTripFromCloud,
  scheduleCloudSync
};
