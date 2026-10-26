import { canRemoveMember } from '../domain/permissions.js';
import { StorageService } from '../storage/storageAdapter.js';
import { uiState, getActiveTrip } from './state.js';
import { showToast, openConfirmModal, escapeHtml } from './helpers.js';
import { renderAll } from './views.js';

export function openTripModal(mode = 'create') {
  const trip = getActiveTrip();
  if (mode === 'edit' && !trip) {
    mode = 'create';
  }
  uiState.editingMemberIdx = null;
  const editModeInp = document.getElementById('tripEditMode');
  if (editModeInp) editModeInp.value = mode;
  const deleteBtn = document.getElementById('btnDeleteTrip');

  if (mode === 'edit' && trip) {
    const titleEl = document.getElementById('tripModalTitle');
    if (titleEl) titleEl.textContent = 'Edit Group & Members';
    const nameInp = document.getElementById('tripNameInput');
    if (nameInp) nameInp.value = trip.name;
    uiState.tempTripMembers = JSON.parse(JSON.stringify(trip.members));
    if (deleteBtn) deleteBtn.style.display = 'inline-flex';
  } else {
    const titleEl = document.getElementById('tripModalTitle');
    if (titleEl) titleEl.textContent = 'Create New Group';
    const nameInp = document.getElementById('tripNameInput');
    if (nameInp) nameInp.value = '';
    uiState.tempTripMembers = [
      { id: StorageService.generateId('mem'), name: 'Me (Organizer)', isOrganizer: true, updatedAt: Date.now() }
    ];
    if (deleteBtn) deleteBtn.style.display = 'none';
  }

  renderTripMembersEditor();
  const modalEl = document.getElementById('tripModal');
  if (modalEl) modalEl.classList.add('open');
}

export function renderTripMembersEditor() {
  const list = document.getElementById('tripMembersListEditor');
  if (!list) return;
  if (!uiState.tempTripMembers || uiState.tempTripMembers.length === 0) {
    list.innerHTML = `<div style="padding:12px; color:var(--text-muted); font-size:0.85rem; text-align:center;">No members added yet.</div>`;
    return;
  }

  list.innerHTML = uiState.tempTripMembers.map((m, idx) => {
    const isEditing = uiState.editingMemberIdx === idx;
    const isOrganizer = idx === 0;

    if (isEditing) {
      return `
        <div class="split-member-row" style="background:var(--bg-subtle);">
          <input type="text" class="form-input member-inline-input" data-idx="${idx}" value="${escapeHtml(m.name)}" placeholder="Member name" style="padding:6px 10px; flex:1; min-width:120px;" required />
          <div style="display:flex; gap:6px; flex-shrink:0;">
            <button type="button" class="btn-xs primary" data-save-inline-mem="${idx}">Save</button>
            <button type="button" class="btn-xs" data-cancel-inline-mem="${idx}">Cancel</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="split-member-row">
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
          <div class="member-avatar-circle">${escapeHtml((m.name || 'M').charAt(0).toUpperCase())}</div>
          <strong class="member-display-name" style="font-size:0.9rem; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(m.name)}</strong>
          <span class="badge ${isOrganizer ? 'badge-primary' : ''}">${isOrganizer ? 'Organizer' : 'Member'}</span>
        </div>
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <button type="button" class="btn-xs" data-edit-inline-mem="${idx}" title="Edit Name">Edit</button>
          ${!isOrganizer ? `<button type="button" class="btn-xs danger" data-remove-mem="${idx}" title="Remove Member">Remove</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Wire up inline input if editing
  const inlineInput = list.querySelector('.member-inline-input');
  if (inlineInput) {
    inlineInput.focus();
    inlineInput.select();
    inlineInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = inlineInput.value.trim();
        if (val) {
          uiState.tempTripMembers[uiState.editingMemberIdx].name = val;
          uiState.tempTripMembers[uiState.editingMemberIdx].updatedAt = Date.now();
          uiState.editingMemberIdx = null;
          renderTripMembersEditor();
        } else {
          showToast('Member name cannot be empty.');
        }
      } else if (e.key === 'Escape') {
        uiState.editingMemberIdx = null;
        renderTripMembersEditor();
      }
    });
  }

  list.querySelectorAll('[data-edit-inline-mem]').forEach(btn => {
    btn.addEventListener('click', () => {
      uiState.editingMemberIdx = Number(btn.dataset.editInlineMem);
      renderTripMembersEditor();
    });
  });

  list.querySelectorAll('[data-save-inline-mem]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.saveInlineMem);
      const inp = list.querySelector(`.member-inline-input[data-idx="${idx}"]`);
      const val = inp ? inp.value.trim() : '';
      if (val) {
        uiState.tempTripMembers[idx].name = val;
        uiState.tempTripMembers[idx].updatedAt = Date.now();
        uiState.editingMemberIdx = null;
        renderTripMembersEditor();
        showToast('Member name updated.');
      } else {
        showToast('Member name cannot be empty.');
      }
    });
  });

  list.querySelectorAll('[data-cancel-inline-mem]').forEach(btn => {
    btn.addEventListener('click', () => {
      uiState.editingMemberIdx = null;
      renderTripMembersEditor();
    });
  });

  list.querySelectorAll('[data-remove-mem]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.removeMem);
      const memId = uiState.tempTripMembers[i]?.id;
      const trip = getActiveTrip();
      if (!canRemoveMember(trip, memId)) {
        showToast('Cannot remove a member who is part of existing expenses.');
        return;
      }
      uiState.tempTripMembers.splice(i, 1);
      if (uiState.editingMemberIdx === i) uiState.editingMemberIdx = null;
      renderTripMembersEditor();
    });
  });
}

export function addMemberRow() {
  const inp = document.getElementById('newMemberNameInput');
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) return;
  uiState.tempTripMembers.push({
    id: StorageService.generateId('mem'),
    name,
    isOrganizer: false,
    updatedAt: Date.now()
  });
  inp.value = '';
  renderTripMembersEditor();
}

export function handleSaveTrip(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (uiState.editingMemberIdx !== null) {
    const inlineInp = document.querySelector(`.member-inline-input[data-idx="${uiState.editingMemberIdx}"]`);
    const inlineVal = inlineInp ? inlineInp.value.trim() : '';
    if (inlineVal && uiState.tempTripMembers[uiState.editingMemberIdx]) {
      uiState.tempTripMembers[uiState.editingMemberIdx].name = inlineVal;
      uiState.tempTripMembers[uiState.editingMemberIdx].updatedAt = Date.now();
    }
    uiState.editingMemberIdx = null;
  }
  const pendingNewMem = document.getElementById('newMemberNameInput');
  if (pendingNewMem && pendingNewMem.value.trim()) {
    uiState.tempTripMembers.push({
      id: StorageService.generateId('mem'),
      name: pendingNewMem.value.trim(),
      isOrganizer: false,
      updatedAt: Date.now()
    });
    pendingNewMem.value = '';
  }
  const modeInp = document.getElementById('tripEditMode');
  const mode = modeInp ? modeInp.value : 'create';
  const nameInp = document.getElementById('tripNameInput');
  const name = nameInp ? nameInp.value.trim() : '';

  const cleanedMembers = uiState.tempTripMembers
    .map(m => ({ ...m, name: m.name.trim() }))
    .filter(m => m.name.length > 0);

  if (!name) {
    showToast('Please enter a group name.');
    return;
  }
  if (cleanedMembers.length < 2) {
    showToast('Please add at least 2 members to split bills.');
    return;
  }

  const now = Date.now();
  if (mode === 'edit') {
    const trip = getActiveTrip();
    if (trip) {
      trip.name = name;
      trip.members = cleanedMembers;
      trip.organizerId = cleanedMembers[0].id;
      trip.updatedAt = now;
      showToast('Group updated!');
    }
  } else {
    const newTripId = StorageService.generateId('trip');
    cleanedMembers[0].isOrganizer = true;
    const newTrip = {
      id: newTripId,
      name,
      organizerId: cleanedMembers[0].id,
      members: cleanedMembers,
      expenses: [],
      settlements: [],
      createdAt: now,
      updatedAt: now,
      deleted: false
    };
    if (!Array.isArray(uiState.appState.trips)) uiState.appState.trips = [];
    uiState.appState.trips.push(newTrip);
    uiState.appState.activeTripId = newTripId;
    if (!uiState.appState.activeIdentities) uiState.appState.activeIdentities = {};
    uiState.appState.activeIdentities[newTripId] = cleanedMembers[0].id;
    showToast('New group created!');
  }

  StorageService.saveState(uiState.appState);
  const modalEl = document.getElementById('tripModal');
  if (modalEl) modalEl.classList.remove('open');
  renderAll();
}

export function confirmDeleteCurrentGroup() {
  const trip = getActiveTrip();
  if (!trip) return;

  const activeExpenseCount = (trip.expenses || []).filter(e => !e.deleted).length;
  const memberCount = (trip.members || []).length;
  const details = activeExpenseCount > 0
    ? `It currently has <strong>${activeExpenseCount} expense${activeExpenseCount === 1 ? '' : 's'}</strong> and <strong>${memberCount} member${memberCount === 1 ? '' : 's'}</strong>.`
    : `It currently has <strong>${memberCount} member${memberCount === 1 ? '' : 's'}</strong>.`;

  openConfirmModal(
    'Delete Group?',
    `<p style="margin-bottom:8px; font-weight:600; color:var(--text-main);">Are you sure you want to delete "${escapeHtml(trip.name)}"?</p>
     <p style="font-size:0.875rem; color:var(--text-muted); line-height:1.45;">${details} All expenses, settlement checklists, and member records in this group will be deleted. This action cannot be undone.</p>`,
    () => {
      trip.deleted = true;
      trip.updatedAt = Date.now();
      const remainingTrips = (uiState.appState?.trips || []).filter(t => !t.deleted);
      if (remainingTrips.length > 0) {
        uiState.appState.activeTripId = remainingTrips[0].id;
      } else {
        uiState.appState.activeTripId = null;
      }
      StorageService.saveState(uiState.appState);
      const tripModal = document.getElementById('tripModal');
      if (tripModal) tripModal.classList.remove('open');
      renderAll();
      showToast(`Group "${trip.name}" deleted.`);
    },
    'Delete Group',
    true
  );
}

export function openRenameMemberModal(memberId) {
  const trip = getActiveTrip();
  if (!trip) return;
  const member = (trip.members || []).find(m => m.id === memberId);
  if (!member) return;

  const idInp = document.getElementById('renameMemberId');
  if (idInp) idInp.value = member.id;
  const inp = document.getElementById('renameMemberInput');
  if (inp) inp.value = member.name;
  const titleEl = document.getElementById('renameMemberModalTitle');
  if (titleEl) titleEl.textContent = `Edit Member Name`;
  const modalEl = document.getElementById('renameMemberModal');
  if (modalEl) modalEl.classList.add('open');
  setTimeout(() => {
    if (inp) {
      inp.focus();
      inp.select();
    }
  }, 50);
}

export function handleSaveRenameMember(e) {
  if (e && e.preventDefault) e.preventDefault();
  const trip = getActiveTrip();
  if (!trip) return;
  const idInp = document.getElementById('renameMemberId');
  const memberId = idInp ? idInp.value : '';
  const nameInp = document.getElementById('renameMemberInput');
  const newName = nameInp ? nameInp.value.trim() : '';

  if (!newName) {
    showToast('Please enter a valid member name.');
    return;
  }

  const member = (trip.members || []).find(m => m.id === memberId);
  if (member) {
    const oldName = member.name;
    member.name = newName;
    member.updatedAt = Date.now();
    trip.updatedAt = Date.now();
    StorageService.saveState(uiState.appState);
    const modalEl = document.getElementById('renameMemberModal');
    if (modalEl) modalEl.classList.remove('open');
    renderAll();
    showToast(`Renamed "${oldName}" to "${newName}"`);
  }
}
