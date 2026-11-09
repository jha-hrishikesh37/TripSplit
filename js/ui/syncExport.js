import { CONFIG } from '../config.js';
import { formatPaise } from '../domain/money.js';
import { computeTripSettlement } from '../domain/settlement.js';
import { StorageService } from '../storage/storageAdapter.js';
import { uiState, getMemberName } from './state.js';
import { escapeHtml, slugify, showToast, downloadFile } from './helpers.js';
import { renderAll } from './views.js';

export function buildSettlementSummaryText(trip) {
  const settlement = computeTripSettlement(trip);
  const lines = [
    `🌴 *${trip.name} — Final Expense Summary*`,
    `Total Group Spend: *${formatPaise(settlement.totalTripPaise)}*`,
    ``,
    `📊 *Net Balances:*`
  ];

  settlement.memberStats.forEach(st => {
    const sign = st.remainingNetPaise > 0 ? '+' : '';
    lines.push(`• ${st.name}: ${sign}${formatPaise(st.remainingNetPaise)} (Paid ${formatPaise(st.paidPaise)})`);
  });

  lines.push(``, `💸 *Who Pays Whom (Minimum Payments):*`);
  if (settlement.transactions.length === 0) {
    lines.push(`🎉 Everyone is settled up!`);
  } else {
    settlement.transactions.forEach(tx => {
      const fromName = getMemberName(trip, tx.fromId);
      const toName = getMemberName(trip, tx.toId);
      const status = tx.settled ? '✅ PAID' : '⏳ PENDING';
      let line = `• *${fromName}* ➔ *${toName}*: *${formatPaise(tx.amountPaise)}* [${status}]`;
      if (tx.isStaleAmount && tx.remainingToPayPaise > 0) {
        line += ` [Already paid ${formatPaise(tx.previouslyPaidPaise)}, Remaining: ${formatPaise(tx.remainingToPayPaise)}]`;
      }
      lines.push(line);
    });
  }

  return lines.join('\n');
}

export function exportTripToCSV(trip) {
  const settlement = computeTripSettlement(trip);
  const rows = [
    ['Title', 'Date', 'Category', 'Amount (INR)', 'Paid By', 'Split Type', 'Created By', 'Split Details']
  ];

  (trip.expenses || []).filter(e => !e.deleted).forEach(exp => {
    const splitDesc = (exp.splits || []).map(s =>
      `${getMemberName(trip, s.memberId)}: ${(s.amountPaise / CONFIG.CURRENCY.SUBUNITS).toFixed(2)}`
    ).join(' | ');

    rows.push([
      exp.title,
      exp.date,
      exp.category,
      (exp.amountPaise / CONFIG.CURRENCY.SUBUNITS).toFixed(2),
      getMemberName(trip, exp.paidBy),
      exp.splitType,
      getMemberName(trip, exp.createdBy),
      splitDesc
    ]);
  });

  rows.push([]);
  rows.push(['--- SETTLEMENT PLAN ---']);
  rows.push(['From', 'To', 'Amount (INR)', 'Status']);
  settlement.transactions.forEach(tx => {
    rows.push([
      getMemberName(trip, tx.fromId),
      getMemberName(trip, tx.toId),
      (tx.amountPaise / CONFIG.CURRENCY.SUBUNITS).toFixed(2),
      tx.settled ? 'SETTLED' : 'PENDING'
    ]);
  });

  const csvContent = rows.map(r =>
    r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  downloadFile(`${slugify(trip.name)}_report.csv`, csvContent, 'text/csv;charset=utf-8;');
  showToast('CSV report downloaded!');
}

export function promptIdentitySelection(tripId, onComplete) {
  const trip = (uiState.appState?.trips || []).find(t => t.id === tripId && !t.deleted);
  if (!trip) return;
  uiState.appState.activeTripId = trip.id;
  StorageService.saveState(uiState.appState);
  const subtitleEl = document.getElementById('welcomeTripSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent =
      `"${trip.name}" is synced! Tap your name below so expenses you add are linked to you:`;
  }

  const container = document.getElementById('welcomeMembersButtons');
  if (!container) return;

  const memberButtonsHtml = trip.members.map(m => `
    <button type="button" class="btn btn-secondary" data-pick-identity="${escapeHtml(m.id)}" style="justify-content:space-between;">
      <span>I am <strong>${escapeHtml(m.name)}</strong></span>
      <span>${m.id === trip.organizerId ? '👑 Organizer' : '➔'}</span>
    </button>
  `).join('');

  const addSelfHtml = `
    <div class="identity-add-self-box">
      <input type="text" id="identityNewMemberInput" class="form-control form-control-sm" placeholder="Not listed? Enter your name..." maxlength="40" />
      <button type="button" id="btnIdentityAddSelf" class="btn btn-primary btn-sm">+ Join</button>
    </div>
  `;

  container.innerHTML = memberButtonsHtml + addSelfHtml;

  const finishSelection = (selectedMemId, joinedName) => {
    if (!uiState.appState.activeIdentities) {
      uiState.appState.activeIdentities = {};
    }
    uiState.appState.activeIdentities[trip.id] = selectedMemId;

    if (!uiState.appState.activeMemberByTrip) {
      uiState.appState.activeMemberByTrip = {};
    }
    uiState.appState.activeMemberByTrip[trip.id] = selectedMemId;
    uiState.appState.activeTripId = trip.id;

    StorageService.saveState(uiState.appState);
    if (typeof StorageService.syncTripWithCloud === 'function') {
      StorageService.syncTripWithCloud(uiState.appState, trip.id);
    }
    const modalEl = document.getElementById('welcomeIdentityModal');
    if (modalEl) modalEl.classList.remove('open');

    if (typeof onComplete === 'function') {
      onComplete();
    } else {
      renderAll();
    }

    if (joinedName) {
      showToast(`Joined group as ${joinedName}!`);
    } else {
      showToast(`Identity set to ${getMemberName(trip, selectedMemId)}`);
    }
  };

  container.querySelectorAll('[data-pick-identity]').forEach(btn => {
    btn.addEventListener('click', () => {
      finishSelection(btn.dataset.pickIdentity);
    });
  });

  const handleAddSelf = () => {
    const inputEl = document.getElementById('identityNewMemberInput');
    const trimmedName = inputEl ? inputEl.value.trim() : '';
    if (!trimmedName) {
      showToast('Please enter your name');
      return;
    }
    const existing = trip.members.find(
      m => m.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    let selectedMemId;
    if (existing) {
      selectedMemId = existing.id;
    } else {
      selectedMemId = StorageService.generateId('mem');
      trip.members.push({
        id: selectedMemId,
        name: trimmedName,
        isOrganizer: false,
        updatedAt: Date.now(),
        revision: 1
      });
      trip.updatedAt = Date.now();
    }
    finishSelection(selectedMemId, trimmedName);
  };

  document.getElementById('btnIdentityAddSelf')?.addEventListener('click', handleAddSelf);
  document.getElementById('identityNewMemberInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSelf();
    }
  });

  const modalEl = document.getElementById('welcomeIdentityModal');
  if (modalEl) modalEl.classList.add('open');
}

export function buildCleanAppInviteWhatsAppUrl() {
  const cleanAppUrl = window.location.origin + window.location.pathname;
  const text = [
    "Hey! We've been using *TripSplit* to split our dinner bills & trip expenses — it's super clean:",
    "",
    "🧾 Snap any restaurant bill & tap who ate what",
    "⚡ Works right in the browser (no app download or login)",
    "🧮 Auto-calculates exact shares & minimum settle-up",
    "",
    `Try it for your next outing:\n${cleanAppUrl}`
  ].join('\n');
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function buildTripInviteWhatsAppUrl(trip) {
  const inviteUrl = buildCloudInviteUrl(trip.id);
  const text = [
    `💸 *Join "${trip.name}" on TripSplit!*`,
    "",
    "I've set up our group tab here so we don't have to do manual math:",
    "1️⃣ Tap the link & pick your name",
    "2️⃣ Check what you ate on bills or add your expenses",
    "⚡ _No app download or login needed!_",
    "",
    `👉 ${inviteUrl}`
  ].join('\n');
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function buildCloudInviteUrl(tripId) {
  const baseUrl = window.location.origin + window.location.pathname;
  return `${baseUrl}#trip=${encodeURIComponent(tripId)}`;
}

export async function checkUrlForSyncPayload() {
  const hash = typeof window !== 'undefined' ? window.location.hash || '' : '';
  const search = typeof window !== 'undefined' ? window.location.search || '' : '';
  const combined = hash + search;
  if (combined.includes('sync=')) {
    try {
      const payload = StorageService.decodePayloadFromBase64(combined);
      const stats = StorageService.mergeTripPayload(uiState.appState, payload);
      uiState.appState.activeTripId = stats.tripId;
      StorageService.saveState(uiState.appState);
      // Clean URL hash so refreshing doesn't re-trigger modal
      if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      renderAll();
      promptIdentitySelection(stats.tripId);
    } catch (err) {
      showToast('Could not parse sync link from URL.');
    }
    return;
  }

  const tripMatch = combined.match(/[?#&]trip=([A-Za-z0-9_-]+)/);
  if (tripMatch && tripMatch[1]) {
    const tripId = tripMatch[1];
    try {
      const res = await StorageService.pullTripFromCloud(uiState.appState, tripId);
      if (res && (res.ok === false || res.trip?.deleted)) {
        if (res?.trip?.deleted) { showToast('This group was deleted by the organizer.'); renderAll(); return; }
        showToast('Could not load trip from cloud.');
        return;
      }
      uiState.appState.activeTripId = tripId;
      StorageService.saveState(uiState.appState);
      if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      showToast('Trip loaded from cloud!');
      renderAll();
      promptIdentitySelection(tripId);
    } catch (err) {
      showToast('Could not load trip from cloud.');
    }
  }
}
