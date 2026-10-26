import { CONFIG } from '../config.js';
import { formatPaise } from '../domain/money.js';
import { computeTripSettlement } from '../domain/settlement.js';
import { canModifyExpense } from '../domain/permissions.js';
import { StorageService } from '../storage/storageAdapter.js';
import { uiState, getActiveTrip, getActiveMemberId, getMemberName } from './state.js';
import { escapeHtml, applyTheme } from './helpers.js';

let cachedOnOpenCreateTrip = null;

export function renderAll({ onOpenCreateTrip } = {}) {
  if (onOpenCreateTrip) {
    cachedOnOpenCreateTrip = onOpenCreateTrip;
  }
  const handleCreate = onOpenCreateTrip || cachedOnOpenCreateTrip;

  applyTheme();
  const trip = getActiveTrip();
  renderHeaderSelectors(trip);

  const editBtn = document.getElementById('btnEditTrip');
  const deleteHeaderBtn = document.getElementById('btnDeleteTripHeader');
  const renameIdentityBtn = document.getElementById('btnRenameMyIdentity');
  const fabContainer = document.querySelector('.fab-container');

  if (!trip) {
    if (editBtn) editBtn.style.display = 'none';
    if (deleteHeaderBtn) deleteHeaderBtn.style.display = 'none';
    if (renameIdentityBtn) renameIdentityBtn.style.display = 'none';
    if (fabContainer) fabContainer.style.display = 'none';

    const heroEl = document.getElementById('heroSummary');
    if (heroEl) {
      heroEl.innerHTML = `
        <div class="card empty-state" style="padding:32px 16px; text-align:center;">
          <div class="empty-icon" style="font-size:2.5rem; margin-bottom:8px;">🏝️</div>
          <h3 style="font-size:1.2rem; font-weight:700; margin-bottom:6px;">No Active Groups Found</h3>
          <p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:16px;">All groups have been deleted. Create a new group to start tracking expenses.</p>
          <button type="button" class="btn btn-primary" id="btnCreateFirstTrip" style="display:inline-flex; align-items:center; gap:6px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>Create New Group</span>
          </button>
        </div>
      `;
    }
    document.getElementById('btnCreateFirstTrip')?.addEventListener('click', () => {
      if (typeof handleCreate === 'function') {
        handleCreate();
      }
    });
    const expContainer = document.getElementById('expensesListContainer');
    if (expContainer) expContainer.innerHTML = '';
    const setPlanList = document.getElementById('settlementPlanList');
    if (setPlanList) setPlanList.innerHTML = '<div class="empty-state" style="padding:20px;">No active group.</div>';
    const memBalList = document.getElementById('memberBalancesList');
    if (memBalList) memBalList.innerHTML = '';
    const setProgBadge = document.getElementById('settlementProgressBadge');
    if (setProgBadge) setProgBadge.textContent = '0 / 0 Settled';
    const setProgBar = document.getElementById('settlementProgressBar');
    if (setProgBar) setProgBar.style.width = '0%';
    const catSumContainer = document.getElementById('categorySummaryContainer');
    if (catSumContainer) catSumContainer.innerHTML = '<div class="empty-state" style="padding:20px;">No active group.</div>';
    const syncCodeOut = document.getElementById('syncCodeOutput');
    if (syncCodeOut) syncCodeOut.value = '';
    return;
  }

  if (editBtn) editBtn.style.display = 'inline-flex';
  if (deleteHeaderBtn) deleteHeaderBtn.style.display = 'inline-flex';
  if (renameIdentityBtn) renameIdentityBtn.style.display = 'inline-flex';
  if (fabContainer) fabContainer.style.display = 'flex';

  const activeMemberId = getActiveMemberId(trip);
  const settlementData = computeTripSettlement(trip);

  renderHeroSummary(trip, activeMemberId, settlementData);
  renderExpensesTab(trip, activeMemberId);
  renderSettlementTab(trip, settlementData);
  renderCategoriesTab(trip, settlementData.totalTripPaise);
  renderSyncTab(trip);
}

export function renderHeaderSelectors(trip) {
  const tripSelect = document.getElementById('tripSelect');
  const activeTrips = (uiState.appState?.trips || []).filter(t => !t.deleted);

  if (tripSelect) {
    if (activeTrips.length === 0) {
      tripSelect.innerHTML = '<option value="">No Groups</option>';
      tripSelect.disabled = true;
    } else {
      tripSelect.disabled = false;
      tripSelect.innerHTML = activeTrips.map(t =>
        `<option value="${escapeHtml(t.id)}" ${t.id === trip?.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`
      ).join('');
    }
  }

  const identitySelect = document.getElementById('identitySelect');
  if (identitySelect) {
    if (!trip) {
      identitySelect.innerHTML = '<option>—</option>';
      identitySelect.disabled = true;
      return;
    }
    identitySelect.disabled = false;
    const activeMemberId = getActiveMemberId(trip);
    identitySelect.innerHTML = trip.members.map(m => {
      const orgTag = m.id === trip.organizerId ? ' (Organizer)' : '';
      return `<option value="${escapeHtml(m.id)}" ${m.id === activeMemberId ? 'selected' : ''}>${escapeHtml(m.name)}${orgTag}</option>`;
    }).join('');
  }
}

export function renderHeroSummary(trip, activeMemberId, settlementData) {
  const myStats = settlementData.memberStats.find(s => s.memberId === activeMemberId) || {
    paidPaise: 0,
    sharePaise: 0,
    remainingNetPaise: 0
  };

  const netClass = myStats.remainingNetPaise > 0
    ? 'text-pos'
    : (myStats.remainingNetPaise < 0 ? 'text-neg' : '');
  const netLabel = myStats.remainingNetPaise > 0
    ? 'You get back'
    : (myStats.remainingNetPaise < 0 ? 'You owe' : 'All settled');

  const heroSummaryEl = document.getElementById('heroSummary');
  if (!heroSummaryEl) return;

  heroSummaryEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <div>
        <h1 style="font-size:1.15rem; font-weight:800;">${escapeHtml(trip.name)}</h1>
        <span style="font-size:0.78rem; color:var(--text-muted);">${trip.members.length} members · ${(trip.expenses || []).filter(e => !e.deleted).length} expenses</span>
      </div>
      <span class="identity-badge">Viewing as ${escapeHtml(getMemberName(trip, activeMemberId))}</span>
    </div>
    <div class="hero-grid">
      <div class="stat-box">
        <div class="stat-label">Total Trip Spend</div>
        <div class="stat-value">${formatPaise(settlementData.totalTripPaise)}</div>
        <div class="stat-sub">Group Total</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Your Share</div>
        <div class="stat-value">${formatPaise(myStats.sharePaise)}</div>
        <div class="stat-sub">Paid: ${formatPaise(myStats.paidPaise)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Net Balance</div>
        <div class="stat-value ${netClass}">${formatPaise(Math.abs(myStats.remainingNetPaise))}</div>
        <div class="stat-sub">${netLabel}</div>
      </div>
    </div>
  `;
}

export function renderExpensesTab(trip, activeMemberId) {
  // Render category filter chips
  const filterRow = document.getElementById('categoryFilterRow');
  const allChips = [{ id: 'ALL', label: 'All', icon: '✨' }, ...CONFIG.CATEGORIES];
  if (filterRow) {
    filterRow.innerHTML = allChips.map(cat => `
      <button type="button" class="chip ${uiState.currentCategoryFilter === cat.id ? 'active' : ''}" data-cat-filter="${cat.id}">
        ${cat.icon} ${escapeHtml(cat.id === 'ALL' ? 'All Categories' : cat.id)}
      </button>
    `).join('');
  }

  // Filter and sort expenses (newest date first, then newest createdAt)
  const activeExpenses = (trip.expenses || [])
    .filter(e => !e.deleted)
    .filter(e => uiState.currentCategoryFilter === 'ALL' || e.category === uiState.currentCategoryFilter)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt - a.createdAt));

  const listEl = document.getElementById('expensesListContainer');
  if (!listEl) return;
  if (activeExpenses.length === 0) {
    listEl.innerHTML = `
      <div class="card empty-state">
        <div class="empty-icon">🧾</div>
        <h3>No expenses here yet</h3>
        <p style="margin-top:4px; font-size:0.85rem;">Tap "+ Add Expense" below to record a bill.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = activeExpenses.map(exp => {
    const catObj = CONFIG.CATEGORIES.find(c => c.id === exp.category) || CONFIG.CATEGORIES[5];
    const payerName = getMemberName(trip, exp.paidBy);
    const creatorName = getMemberName(trip, exp.createdBy);
    const canEdit = canModifyExpense(trip, exp, activeMemberId);
    const splitCount = (exp.splits || []).length;

    return `
      <div class="expense-item">
        <div class="exp-left">
          <div class="cat-icon" title="${escapeHtml(catObj.label)}">${catObj.icon}</div>
          <div class="exp-details">
            <div class="exp-title">${escapeHtml(exp.title)}</div>
            <div class="exp-meta">
              <span>Paid by <strong>${escapeHtml(payerName)}</strong></span>
              <span>•</span>
              <span>Split (${escapeHtml(String(exp.splitType || '').toLowerCase())}) among ${splitCount}</span>
              <span>•</span>
              <span>${escapeHtml(exp.date)}</span>
            </div>
            <div class="exp-meta" style="margin-top:4px;">
              <span class="badge">${escapeHtml(exp.category)}</span>
              <span class="badge">Added by ${escapeHtml(creatorName)}</span>
            </div>
          </div>
        </div>
        <div class="exp-right">
          <div class="exp-amount">${formatPaise(exp.amountPaise)}</div>
          ${canEdit ? `
            <div class="exp-actions no-print">
              <button type="button" class="btn-xs" data-edit-exp="${escapeHtml(exp.id)}">Edit</button>
              <button type="button" class="btn-xs danger" data-del-exp="${escapeHtml(exp.id)}">Delete</button>
            </div>
          ` : `
            <div style="font-size:0.68rem; color:var(--text-light); margin-top:6px;" class="no-print">Read-only</div>
          `}
        </div>
      </div>
    `;
  }).join('');
}

export function renderSettlementTab(trip, settlementData) {
  const { transactions, memberStats } = settlementData;
  const totalTx = transactions.length;
  const settledCount = transactions.filter(t => t.settled).length;
  const pct = totalTx === 0 ? 100 : Math.round((settledCount / totalTx) * 100);

  const progBadge = document.getElementById('settlementProgressBadge');
  if (progBadge) progBadge.textContent = `${settledCount} / ${totalTx} Settled (${pct}%)`;
  const progBar = document.getElementById('settlementProgressBar');
  if (progBar) progBar.style.width = `${pct}%`;

  const planList = document.getElementById('settlementPlanList');
  if (planList) {
    if (totalTx === 0) {
      planList.innerHTML = `
        <div class="empty-state" style="padding:20px;">
          <div class="empty-icon">🎉</div>
          <strong>Everyone is completely settled up!</strong>
          <p style="font-size:0.82rem; margin-top:4px;">No payments needed between members.</p>
        </div>
      `;
    } else {
      planList.innerHTML = transactions.map(tx => {
        const fromName = getMemberName(trip, tx.fromId);
        const toName = getMemberName(trip, tx.toId);
        return `
          <div class="settlement-card ${tx.settled ? 'is-settled' : ''}">
            <div>
              <div class="pay-flow">
                <strong>${escapeHtml(fromName)}</strong>
                <span class="pay-arrow">pays ➔</span>
                <strong>${escapeHtml(toName)}</strong>
              </div>
              <div style="font-size:0.76rem; color:var(--text-muted); margin-top:2px;">
                ${tx.settled ? '✅ Marked as Settled' : (tx.isStaleAmount ? '⚠️ Amount changed since marked paid — please re-verify' : '⏳ Pending Payment')}
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <strong style="font-size:1.05rem;">${formatPaise(tx.amountPaise)}</strong>${tx.amountPaise < 100 ? '<span class="badge" style="margin-left:4px;">rounding</span>' : ''}
              <button type="button" class="btn-xs no-print" data-toggle-settle="${escapeHtml(tx.id)}">
                ${tx.settled ? 'Undo' : 'Mark Paid'}
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Render Member Net Balances Table
  const balancesEl = document.getElementById('memberBalancesList');
  if (balancesEl) {
    balancesEl.innerHTML = memberStats.map(st => {
      const isPositive = st.remainingNetPaise > 0;
      const isNegative = st.remainingNetPaise < 0;
      const statusColor = isPositive ? 'text-pos' : (isNegative ? 'text-neg' : '');
      const statusPrefix = isPositive ? '+' : '';
      return `
        <div class="split-member-row">
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="member-avatar-circle">${escapeHtml((st.name || 'M').charAt(0).toUpperCase())}</div>
            <div>
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-weight:700;">${escapeHtml(st.name)}</span>
                <button type="button" class="btn-xs no-print" data-rename-member="${escapeHtml(st.memberId)}" title="Edit Name" style="padding:1px 6px; font-size:0.68rem;">Edit</button>
              </div>
              <div style="font-size:0.75rem; color:var(--text-muted);">
                Paid ${formatPaise(st.paidPaise)} · Share ${formatPaise(st.sharePaise)}
              </div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:800;" class="${statusColor}">
              ${statusPrefix}${formatPaise(st.remainingNetPaise)}
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted);">
              ${isPositive ? 'Gets back' : (isNegative ? 'Owes' : 'Settled')}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

export function renderCategoriesTab(trip, totalTripPaise) {
  const activeExpenses = (trip.expenses || []).filter(e => !e.deleted);
  const catTotals = {};
  CONFIG.CATEGORIES.forEach(c => { catTotals[c.id] = { paise: 0, count: 0 }; });

  activeExpenses.forEach(e => {
    if (!catTotals[e.category]) catTotals[e.category] = { paise: 0, count: 0 };
    catTotals[e.category].paise += e.amountPaise;
    catTotals[e.category].count += 1;
  });

  const container = document.getElementById('categorySummaryContainer');
  if (!container) return;
  container.innerHTML = CONFIG.CATEGORIES.map(cat => {
    const data = catTotals[cat.id] || { paise: 0, count: 0 };
    const pct = totalTripPaise > 0 ? Math.round((data.paise / totalTripPaise) * 100) : 0;
    return `
      <div class="cat-row">
        <div class="cat-row-top">
          <span>${cat.icon} ${escapeHtml(cat.label)} <span style="color:var(--text-muted); font-weight:400;">(${data.count})</span></span>
          <span>${formatPaise(data.paise)} <span style="color:var(--text-muted); font-size:0.78rem;">(${pct}%)</span></span>
        </div>
        <div class="progress-bar-wrap" style="height:8px; margin:4px 0 0;">
          <div class="progress-bar-fill" style="width:${pct}%; background:${cat.color};"></div>
        </div>
      </div>
    `;
  }).join('');
}

export function renderSyncTab(trip) {
  const payload = StorageService.exportTripPayload(trip);
  const syncCode = StorageService.encodePayloadToBase64(payload);
  const syncCodeEl = document.getElementById('syncCodeOutput');
  if (syncCodeEl) {
    syncCodeEl.value = syncCode;
  }
}
