import { StorageService } from '../storage/storageAdapter.js';

export const uiState = {
  appState: null,
  currentTab: 'expenses',
  currentCategoryFilter: 'ALL',
  currentSplitType: 'EQUAL',
  tempTripMembers: [],
  editingMemberIdx: null,
  pendingConfirmCallback: null,
  tempExpenseItems: [],
  tempTaxTipRupees: ''
};

export function initAppState() {
  uiState.appState = StorageService.loadState();
  return uiState.appState;
}

export function getActiveTrip() {
  if (!uiState.appState) {
    initAppState();
  }
  let trip = uiState.appState.trips.find(t => t.id === uiState.appState.activeTripId && !t.deleted);
  if (!trip) {
    trip = uiState.appState.trips.find(t => !t.deleted);
    if (trip) uiState.appState.activeTripId = trip.id;
  }
  return trip || null;
}

export function getActiveMemberId(trip) {
  if (!trip || !trip.members || !trip.members.length) return null;
  if (!uiState.appState) {
    initAppState();
  }
  if (!uiState.appState.activeIdentities) {
    uiState.appState.activeIdentities = {};
  }
  const savedId = uiState.appState.activeIdentities[trip.id];
  if (savedId && trip.members.some(m => m.id === savedId)) {
    return savedId;
  }
  uiState.appState.activeIdentities[trip.id] = trip.members[0].id;
  return trip.members[0].id;
}

export function getMemberName(trip, memberId) {
  const m = (trip?.members || []).find(x => x.id === memberId);
  return m ? m.name : 'Unknown';
}
