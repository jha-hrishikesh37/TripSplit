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
      lines.push(`• *${fromName}* ➔ *${toName}*: *${formatPaise(tx.amountPaise)}* [${status}]`);
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

export function promptIdentitySelection(tripId) {
  const trip = (uiState.appState?.trips || []).find(t => t.id === tripId && !t.deleted);
  if (!trip) return;
  const subtitleEl = document.getElementById('welcomeTripSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent =
      `"${trip.name}" is synced! Tap your name below so expenses you add are linked to you:`;
  }

  const container = document.getElementById('welcomeMembersButtons');
  if (!container) return;
  container.innerHTML = trip.members.map(m => `
    <button type="button" class="btn btn-secondary" data-pick-identity="${escapeHtml(m.id)}" style="justify-content:space-between;">
      <span>I am <strong>${escapeHtml(m.name)}</strong></span>
      <span>${m.id === trip.organizerId ? '👑 Organizer' : '➔'}</span>
    </button>
  `).join('');

  container.querySelectorAll('[data-pick-identity]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!uiState.appState.activeIdentities) {
        uiState.appState.activeIdentities = {};
      }
      uiState.appState.activeIdentities[trip.id] = btn.dataset.pickIdentity;
      StorageService.saveState(uiState.appState);
      const modalEl = document.getElementById('welcomeIdentityModal');
      if (modalEl) modalEl.classList.remove('open');
      renderAll();
      showToast(`Identity set to ${getMemberName(trip, btn.dataset.pickIdentity)}`);
    });
  });

  const modalEl = document.getElementById('welcomeIdentityModal');
  if (modalEl) modalEl.classList.add('open');
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
      if (res && res.ok === false) {
        showToast('Could not load trip from cloud.');
        return;
      }
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
