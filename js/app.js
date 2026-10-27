import { CONFIG } from './config.js';
import { StorageService } from './storage/storageAdapter.js';
import { formatPaise, getLocalTodayStr } from './domain/money.js';
import { computeTripSettlement } from './domain/settlement.js';
import { canModifyExpense } from './domain/permissions.js';
import {
  uiState,
  initAppState,
  getActiveTrip,
  getActiveMemberId,
  getMemberName
} from './ui/state.js';
import {
  showToast,
  openConfirmModal,
  copyTextToClipboard,
  downloadFile,
  applyTheme,
  toggleTheme,
  slugify,
  escapeHtml
} from './ui/helpers.js';
import { renderAll } from './ui/views.js';
import {
  openExpenseModal,
  updateSplitTypeTabsUI,
  renderSplitMemberInputs,
  updateLiveSplitCheck,
  handleSaveExpense
} from './ui/expenseModal.js';
import {
  openTripModal,
  renderTripMembersEditor,
  handleSaveTrip,
  confirmDeleteCurrentGroup,
  openRenameMemberModal,
  handleSaveRenameMember
} from './ui/tripModal.js';
import {
  buildSettlementSummaryText,
  exportTripToCSV,
  promptIdentitySelection,
  checkUrlForSyncPayload
} from './ui/syncExport.js';

export function bindEvents() {
  // Tab Switching
  document.querySelectorAll('.nav-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      uiState.currentTab = tabBtn.dataset.tab;
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b === tabBtn));
      document.querySelectorAll('.tab-section').forEach(sec => {
        sec.style.display = sec.id === `tab-${uiState.currentTab}` ? 'block' : 'none';
      });
    });
  });

  // Theme Toggle
  document.getElementById('btnThemeToggle')?.addEventListener('click', toggleTheme);

  // Cloud Sync Status Listener
  StorageService.onSyncStatusChange(({ status, stats }) => {
    const dot = document.getElementById('cloudSyncDot');
    const label = document.getElementById('cloudSyncLabel');
    if (dot) {
      dot.className = 'sync-dot';
      if (status === 'synced') dot.classList.add('synced');
      else if (status === 'syncing') dot.classList.add('syncing');
      else if (status === 'offline') dot.classList.add('offline');
    }
    if (label) {
      if (status === 'synced') label.textContent = 'Synced';
      else if (status === 'syncing') label.textContent = 'Syncing...';
      else if (status === 'offline') label.textContent = 'Offline';
    }
    if (status === 'synced' && stats && (stats.addedExpenses > 0 || stats.updatedExpenses > 0 || stats.addedMembers > 0 || stats.settlementChanges > 0)) {
      renderAll({ onOpenCreateTrip: () => openTripModal('create') });
    }
  });

  // Cloud Sync Manual Trigger
  document.getElementById('btnCloudSyncNow')?.addEventListener('click', async () => {
    const res = await StorageService.syncTripWithCloud(uiState.appState);
    if (res && res.ok) {
      showToast('Synced with cloud!');
    } else {
      showToast('Saved locally (offline mode)');
    }
  });

  window.addEventListener('online', () => StorageService.syncTripWithCloud(uiState.appState));

  // Trip & Identity Selectors
  const onTripChange = (e) => {
    uiState.appState.activeTripId = e.target.value;
    StorageService.saveState(uiState.appState);
    renderAll();
    StorageService.syncTripWithCloud(uiState.appState);
  };
  document.getElementById('tripSelect')?.addEventListener('change', onTripChange);
  document.getElementById('tripSelector')?.addEventListener('change', onTripChange);

  document.getElementById('identitySelect')?.addEventListener('change', (e) => {
    const trip = getActiveTrip();
    if (trip) {
      uiState.appState.activeIdentities[trip.id] = e.target.value;
      StorageService.saveState(uiState.appState);
      renderAll();
      showToast(`Viewing as ${getMemberName(trip, e.target.value)}`);
    }
  });

  // Category Filter Chips
  document.getElementById('categoryFilterRow')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat-filter]');
    if (chip) {
      uiState.currentCategoryFilter = chip.dataset.catFilter;
      renderAll();
    }
  });

  // Open Add Expense Modal
  document.getElementById('btnOpenAddExpense')?.addEventListener('click', () => openExpenseModal(null));

  // Edit & Soft-Delete Expense Delegation
  document.getElementById('expensesListContainer')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-exp]');
    if (editBtn) {
      openExpenseModal(editBtn.dataset.editExp);
      return;
    }
    const delBtn = e.target.closest('[data-del-exp]');
    if (delBtn) {
      const trip = getActiveTrip();
      const expId = delBtn.dataset.delExp;
      const exp = (trip?.expenses || []).find(x => x.id === expId);
      if (!exp) return;

      if (!canModifyExpense(trip, exp, getActiveMemberId(trip))) {
        showToast('Only the creator or organizer can delete this expense.');
        return;
      }

      openConfirmModal(
        'Delete Expense?',
        `Are you sure you want to delete "${escapeHtml(exp.title)}" (${formatPaise(exp.amountPaise)})? This deletion will also sync when merged.`,
        () => {
          exp.deleted = true;
          exp.revision = (exp.revision || 1) + 1;
          exp.updatedAt = Date.now();
          trip.updatedAt = Date.now();
          StorageService.saveState(uiState.appState);
          renderAll();
          showToast('Expense deleted.');
        }
      );
    }
  });

  // Split Type Tabs inside Expense Modal
  document.querySelectorAll('.split-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      uiState.currentSplitType = btn.dataset.splitType;
      updateSplitTypeTabsUI();
      const trip = getActiveTrip();
      if (trip) {
        const prevChecked = new Set(
          Array.from(document.querySelectorAll('.split-member-check:checked')).map(cb => cb.value)
        );
        const expId = document.getElementById('expId')?.value;
        const existingExp = expId ? (trip.expenses || []).find(e => e.id === expId && !e.deleted) : null;
        renderSplitMemberInputs(trip, existingExp, prevChecked.size > 0 ? prevChecked : null);
        updateLiveSplitCheck();
      }
    });
  });

  document.getElementById('expAmount')?.addEventListener('input', updateLiveSplitCheck);

  document.getElementById('btnSelectAllMembers')?.addEventListener('click', () => {
    document.querySelectorAll('.split-member-check').forEach(cb => { cb.checked = true; });
    if (uiState.currentSplitType === 'PERCENT') {
      const checks = Array.from(document.querySelectorAll('.split-member-check'));
      const activeCount = checks.length || 1;
      const baseBps = Math.floor(10000 / activeCount);
      const extraBps = 10000 - (baseBps * activeCount);
      checks.forEach((cb, idx) => {
        const row = cb.closest('[data-member-row]');
        const inp = row ? row.querySelector('.split-member-val') : null;
        if (inp) {
          inp.value = ((baseBps + (idx < extraBps ? 1 : 0)) / 100).toFixed(2);
        }
      });
    }
    updateLiveSplitCheck();
  });

  document.getElementById('expenseForm')?.addEventListener('submit', handleSaveExpense);

  // Trip Create / Edit Buttons
  document.getElementById('btnNewTrip')?.addEventListener('click', () => openTripModal('create'));
  document.getElementById('btnEditTrip')?.addEventListener('click', () => openTripModal('edit'));

  document.getElementById('btnAddMemberRow')?.addEventListener('click', () => {
    const inp = document.getElementById('newMemberNameInput');
    const name = inp ? inp.value.trim() : '';
    if (!name) return;
    uiState.tempTripMembers.push({
      id: StorageService.generateId('mem'),
      name,
      isOrganizer: false,
      updatedAt: Date.now()
    });
    if (inp) inp.value = '';
    renderTripMembersEditor();
  });

  document.getElementById('newMemberNameInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btnAddMemberRow')?.click();
    }
  });

  document.getElementById('tripForm')?.addEventListener('submit', handleSaveTrip);

  document.getElementById('btnDeleteTripHeader')?.addEventListener('click', confirmDeleteCurrentGroup);
  document.getElementById('btnDeleteTrip')?.addEventListener('click', confirmDeleteCurrentGroup);

  document.getElementById('renameMemberForm')?.addEventListener('submit', handleSaveRenameMember);

  document.getElementById('btnRenameMyIdentity')?.addEventListener('click', () => {
    const trip = getActiveTrip();
    if (!trip) return;
    const activeMemberId = getActiveMemberId(trip);
    if (activeMemberId) openRenameMemberModal(activeMemberId);
  });

  document.getElementById('memberBalancesList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rename-member]');
    if (btn) {
      openRenameMemberModal(btn.dataset.renameMember);
    }
  });

  // Settle-Up Mark Paid / Undo Delegation
  document.getElementById('settlementPlanList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle-settle]');
    if (!btn) return;
    const trip = getActiveTrip();
    if (!trip) return;

    const setId = btn.dataset.toggleSettle;
    const now = Date.now();
    if (!Array.isArray(trip.settlements)) trip.settlements = [];

    const tx = computeTripSettlement(trip).transactions.find(t => t.id === setId);

    const existing = trip.settlements.find(s => s.id === setId);
    if (existing) {
      if (existing.settled && existing.amountPaise && tx && existing.amountPaise !== tx.amountPaise) {
        existing.settled = true;
        existing.amountPaise = tx.amountPaise;
      } else {
        existing.settled = !existing.settled;
        existing.amountPaise = tx ? tx.amountPaise : 0;
      }
      existing.revision = (existing.revision || 0) + 1;
      existing.updatedAt = now;
      existing.deleted = false;
    } else {
      trip.settlements.push({
        id: setId,
        settled: true,
        amountPaise: tx ? tx.amountPaise : 0,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        deleted: false
      });
    }
    trip.updatedAt = now;
    StorageService.saveState(uiState.appState);
    renderAll();
    showToast('Settlement status updated!');
  });

  // Share Settlement Summary to WhatsApp & Copy
  document.getElementById('btnShareWhatsAppSettlement')?.addEventListener('click', () => {
    const trip = getActiveTrip();
    if (!trip) return;
    const text = buildSettlementSummaryText(trip);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });

  document.getElementById('btnCopySettlementText')?.addEventListener('click', () => {
    const trip = getActiveTrip();
    if (!trip) return;
    copyTextToClipboard(buildSettlementSummaryText(trip), 'Settlement summary copied!');
  });

  // Sync Tab Actions
  document.getElementById('btnCopySyncCode')?.addEventListener('click', () => {
    const code = document.getElementById('syncCodeOutput')?.value || '';
    copyTextToClipboard(code, 'Sync code copied! Paste it in WhatsApp.');
  });

  document.getElementById('btnWhatsAppSyncLink')?.addEventListener('click', () => {
    const trip = getActiveTrip();
    if (!trip) return;
    const code = document.getElementById('syncCodeOutput')?.value || '';
    const baseUrl = window.location.href.split('#')[0].split('?')[0];
    const inviteLink = `${baseUrl}#sync=${encodeURIComponent(code)}`;
    const message = [
      `🎒 *${trip.name} — TripSplit Sync*`,
      `Open our offline trip bill-splitter or paste the sync code below to add your expenses and merge:`,
      ``,
      inviteLink,
      ``,
      `Sync Code:`,
      code
    ].join('\n');
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  });

  document.getElementById('btnDownloadTripSyncFile')?.addEventListener('click', () => {
    const trip = getActiveTrip();
    if (!trip) return;
    const payload = StorageService.exportTripPayload(trip);
    downloadFile(`${slugify(trip.name)}_sync.json`, JSON.stringify(payload, null, 2), 'application/json');
    showToast('Sync .json file downloaded!');
  });

  // Merge Pasted Sync Code
  document.getElementById('btnMergeCode')?.addEventListener('click', () => {
    const raw = document.getElementById('mergeCodeInput')?.value.trim();
    if (!raw) {
      showToast('Please paste a sync code or link first.');
      return;
    }
    try {
      const payload = StorageService.decodePayloadFromBase64(raw);
      const stats = StorageService.mergeTripPayload(uiState.appState, payload);
      document.getElementById('mergeCodeInput').value = '';
      renderAll();
      showToast(`Merged "${stats.tripName}" (${stats.addedExpenses} new, ${stats.updatedExpenses} updated)!`);
      if (stats.isNewTrip) {
        promptIdentitySelection(stats.tripId);
      }
    } catch (err) {
      showToast('Invalid sync code. Please check and try again.');
    }
  });

  // Merge Sync .json File
  document.getElementById('fileImportSync')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = StorageService.decodePayloadFromBase64(String(reader.result));
        const stats = StorageService.mergeTripPayload(uiState.appState, payload);
        renderAll();
        showToast(`Merged "${stats.tripName}" (${stats.addedExpenses} new, ${stats.updatedExpenses} updated)!`);
        if (stats.isNewTrip) {
          promptIdentitySelection(stats.tripId);
        }
      } catch (err) {
        showToast('Invalid sync file.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  // CSV, Print & Full JSON Backup/Restore
  document.getElementById('btnExportCSV')?.addEventListener('click', () => {
    const trip = getActiveTrip();
    if (trip) exportTripToCSV(trip);
  });

  // Window print lifecycle hooks to guarantee clean light paper PDF without dark backgrounds
  let activeThemeBeforePrint = null;
  const onEnterPrint = () => {
    if (!activeThemeBeforePrint) {
      activeThemeBeforePrint = document.documentElement.getAttribute('data-theme') || 'light';
    }
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.style.transition = 'none';
    document.body.style.backgroundColor = '#ffffff';
  };
  const onLeavePrint = () => {
    if (activeThemeBeforePrint) {
      document.documentElement.setAttribute('data-theme', activeThemeBeforePrint);
      activeThemeBeforePrint = null;
      document.body.style.transition = '';
      document.body.style.backgroundColor = '';
    }
  };

  window.addEventListener('beforeprint', onEnterPrint);
  window.addEventListener('afterprint', onLeavePrint);

  if (window.matchMedia) {
    const printMedia = window.matchMedia('print');
    printMedia.addEventListener('change', (e) => {
      if (e.matches) {
        onEnterPrint();
      } else {
        onLeavePrint();
      }
    });
  }

  document.getElementById('btnPrintPDF')?.addEventListener('click', () => {
    const prevTheme = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        if (prevTheme) {
          document.documentElement.setAttribute('data-theme', prevTheme);
        }
      }, 300);
    }, 30);
  });

  document.getElementById('btnBackupAll')?.addEventListener('click', () => {
    const json = StorageService.exportFullBackup(uiState.appState);
    downloadFile(`tripsplit_full_backup_${getLocalTodayStr()}.json`, json, 'application/json');
    showToast('Full backup downloaded!');
  });

  document.getElementById('fileRestoreBackup')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        uiState.appState = StorageService.restoreFullBackup(String(reader.result));
        renderAll();
        showToast('Full backup restored successfully!');
      } catch (err) {
        showToast('Invalid backup JSON file.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  // Close Modal Buttons & Confirm Proceed
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.close;
      const target = document.getElementById(targetId);
      if (target) target.classList.remove('open');
      if (targetId === 'confirmModal') {
        uiState.pendingConfirmCallback = null;
      }
    });
  });

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('open');
        if (backdrop.id === 'confirmModal') {
          uiState.pendingConfirmCallback = null;
        }
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModal = document.querySelector('.modal-backdrop.open');
      if (openModal) {
        openModal.classList.remove('open');
        if (openModal.id === 'confirmModal') {
          uiState.pendingConfirmCallback = null;
        }
      }
    }
  });

  document.getElementById('btnConfirmProceed')?.addEventListener('click', () => {
    document.getElementById('confirmModal')?.classList.remove('open');
    if (typeof uiState.pendingConfirmCallback === 'function') {
      const cb = uiState.pendingConfirmCallback;
      uiState.pendingConfirmCallback = null;
      cb();
    }
  });
}

export function init() {
  initAppState();
  document.querySelectorAll('.currency-symbol').forEach(el => {
    el.textContent = CONFIG.CURRENCY.SYMBOL;
  });
  const printStyle = document.createElement('style');
  printStyle.textContent = '@media print { body { transition: none !important; background-color: #ffffff !important; } }';
  document.head.appendChild(printStyle);
  bindEvents();
  renderAll({ onOpenCreateTrip: () => openTripModal('create') });
  checkUrlForSyncPayload();
  StorageService.syncTripWithCloud(uiState.appState);
}

window.addEventListener('DOMContentLoaded', init);
