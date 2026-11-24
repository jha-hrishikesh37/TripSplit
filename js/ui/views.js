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
  const tripMenuWrap = document.getElementById('tripMenuWrap');
  const renameIdentityBtn = document.getElementById('btnRenameMyIdentity');
  const fabContainer = document.querySelector('.fab-container');

  if (!trip) {
    if (tripMenuWrap) tripMenuWrap.style.display = 'none';
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

  if (tripMenuWrap) tripMenuWrap.style.display = '';
  if (editBtn) editBtn.style.display = 'flex';
  if (deleteHeaderBtn) deleteHeaderBtn.style.display = 'flex';
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
    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
      <div>
        <h1 style="font-size:1.15rem; font-weight:800;">${escapeHtml(trip.name)}</h1>
        <span style="font-size:0.78rem; color:var(--text-muted);">${trip.members.length} members · ${(trip.expenses || []).filter(e => !e.deleted).length} expenses</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <button type="button" id="btnQuickInviteApp" class="btn-whatsapp-pill no-print" title="Share TripSplit on WhatsApp" aria-label="Share TripSplit on WhatsApp">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          <span>Share App</span>
        </button>
        <span class="identity-badge">Viewing as ${escapeHtml(getMemberName(trip, activeMemberId))}</span>
      </div>
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

export function formatDateGroupHeader(dateStr) {
  if (!dateStr) return 'No Date';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) {
        const today = new Date();
        const isToday = d.getFullYear() === today.getFullYear() &&
                        d.getMonth() === today.getMonth() &&
                        d.getDate() === today.getDate();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = d.getFullYear() === yesterday.getFullYear() &&
                            d.getMonth() === yesterday.getMonth() &&
                            d.getDate() === yesterday.getDate();

        const formatted = d.toLocaleDateString('en-IN', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });

        if (isToday) return `Today · ${formatted}`;
        if (isYesterday) return `Yesterday · ${formatted}`;
        return formatted;
      }
    }
  } catch (_) {}
  return dateStr;
}

export function renderExpensesTab(trip, activeMemberId) {
  if (!trip) return;

  // Populate dynamic member filter options
  const memberFilterSelect = document.getElementById('expenseMemberFilter');
  if (memberFilterSelect) {
    const currentVal = uiState.expenseMemberFilter || 'ALL';
    const members = trip.members || [];
    let opts = `<option value="ALL"${currentVal === 'ALL' ? ' selected' : ''}>👥 All Members</option>`;
    for (const m of members) {
      opts += `<option value="${escapeHtml(m.id)}"${currentVal === m.id ? ' selected' : ''}>Involving ${escapeHtml(m.name)}</option>`;
    }
    for (const m of members) {
      const paidVal = `PAID:${m.id}`;
      opts += `<option value="${escapeHtml(paidVal)}"${currentVal === paidVal ? ' selected' : ''}>Paid by ${escapeHtml(m.name)}</option>`;
    }
    memberFilterSelect.innerHTML = opts;
    memberFilterSelect.value = currentVal;
    if (memberFilterSelect.value !== currentVal) {
      uiState.expenseMemberFilter = 'ALL';
      memberFilterSelect.value = 'ALL';
    }
  }

  const searchInput = document.getElementById('expenseSearchInput');
  if (searchInput && document.activeElement !== searchInput) {
    searchInput.value = uiState.expenseSearchQuery || '';
  }

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

  const searchQuery = (uiState.expenseSearchQuery || '').trim().toLowerCase();
  const memberFilter = uiState.expenseMemberFilter || 'ALL';

  // Filter and sort expenses (newest date first, then newest createdAt)
  const activeExpenses = (trip.expenses || [])
    .filter(e => !e.deleted)
    .filter(e => {
      // 1. Category filter
      if (uiState.currentCategoryFilter !== 'ALL' && e.category !== uiState.currentCategoryFilter) {
        return false;
      }

      // 2. Member filter
      if (memberFilter !== 'ALL') {
        if (memberFilter.startsWith('PAID:')) {
          const payerId = memberFilter.slice(5);
          if (e.paidBy !== payerId) return false;
        } else {
          // Involving memberFilter
          const isPayer = e.paidBy === memberFilter;
          const isInSplits = Array.isArray(e.splits) && e.splits.some(s => s.memberId === memberFilter);
          if (!isPayer && !isInSplits) return false;
        }
      }

      // 3. Search query
      if (searchQuery) {
        const titleMatch = (e.title || '').toLowerCase().includes(searchQuery);
        const catObj = CONFIG.CATEGORIES.find(c => c.id === e.category);
        const catLabel = catObj ? catObj.label.toLowerCase() : (e.category || '').toLowerCase();
        const catMatch = catLabel.includes(searchQuery) || (e.category || '').toLowerCase().includes(searchQuery);
        const payerName = getMemberName(trip, e.paidBy).toLowerCase();
        const payerMatch = payerName.includes(searchQuery);
        const dishMatch = Array.isArray(e.items) && e.items.some(it => (it.name || '').toLowerCase().includes(searchQuery));

        if (!titleMatch && !catMatch && !payerMatch && !dishMatch) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt - a.createdAt));

  const listEl = document.getElementById('expensesListContainer');
  if (!listEl) return;
  if (activeExpenses.length === 0) {
    const isFiltered = uiState.currentCategoryFilter !== 'ALL' || !!searchQuery || memberFilter !== 'ALL';
    listEl.innerHTML = `
      <div class="card empty-state">
        <div class="empty-icon">${isFiltered ? '🔍' : '🧾'}</div>
        <h3>${isFiltered ? 'No matching expenses' : 'No expenses here yet'}</h3>
        <p style="margin-top:4px; font-size:0.85rem;">${isFiltered ? 'Try clearing your search or filters.' : 'Tap "+ Add Expense" below to record a bill.'}</p>
      </div>
    `;
    return;
  }

  let html = '';
  let currentDateGroup = null;

  for (const exp of activeExpenses) {
    const expDate = exp.date || '';
    if (expDate !== currentDateGroup) {
      currentDateGroup = expDate;
      html += `<div class="expense-date-header">${formatDateGroupHeader(expDate)}</div>`;
    }

    const catObj = CONFIG.CATEGORIES.find(c => c.id === exp.category) || CONFIG.CATEGORIES[5];
    const payerName = getMemberName(trip, exp.paidBy);
    const creatorName = getMemberName(trip, exp.createdBy);
    const canEdit = canModifyExpense(trip, exp, activeMemberId);
    const splitCount = (exp.splits || []).length;
    const hasItems = exp.splitType === 'ITEMIZED' && Array.isArray(exp.items) && exp.items.length > 0;
    const isExpanded = hasItems && (uiState.expandedItemizedExpIds || []).includes(exp.id);

    html += `
      <div class="expense-item">
        <div class="exp-left">
          <div class="cat-icon" title="${escapeHtml(catObj.label)}">${catObj.icon}</div>
          <div class="exp-details">
            <div class="exp-title">${escapeHtml(exp.title)}</div>
            <div class="exp-meta">
              <span>Paid by <strong>${escapeHtml(payerName)}</strong></span>
              <span>•</span>
              ${hasItems ? `
                <button type="button" class="badge badge-itemized-toggle" data-toggle-items="${escapeHtml(exp.id)}" aria-expanded="${isExpanded ? 'true' : 'false'}">🧾 Itemized (${exp.items.length} items)</button>
              ` : `
                <span>${exp.splitType === 'ITEMIZED' ? `🧾 Itemized (${(exp.items || []).length} items)` : `Split (${escapeHtml(String(exp.splitType || '').toLowerCase())}) among ${splitCount}`}</span>
              `}
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
        ${hasItems ? `
          <div class="expense-items-drawer" id="items-drawer-${escapeHtml(exp.id)}" style="display: ${isExpanded ? 'block' : 'none'};">
            <div class="drawer-header">🧾 Who Ate What (Itemized Receipt)</div>
            <div class="drawer-dish-list">
              ${exp.items.map(it => `
                <div class="drawer-dish-row">
                  <div class="drawer-dish-left">
                    <span class="drawer-dish-name">${escapeHtml(it.name || 'Untitled item')}</span>
                    <span class="drawer-dish-sharers">${(it.sharedBy || []).map(id => `<span class="member-pill">${escapeHtml(getMemberName(trip, id))}</span>`).join(', ')}</span>
                  </div>
                  <div class="drawer-dish-price">${formatPaise(it.pricePaise)}</div>
                </div>
              `).join('')}
            </div>
            ${exp.taxTipPaise > 0 ? `
              <div class="drawer-tax-row">
                <span>Tax / Tip (${exp.taxSplitMode === 'PROPORTIONAL' ? 'By Share' : 'Equal'}): ${formatPaise(exp.taxTipPaise)}</span>
              </div>
            ` : ''}
            ${canEdit ? `
              <div class="drawer-actions no-print">
                <button type="button" class="btn btn-secondary btn-sm" data-edit-exp="${escapeHtml(exp.id)}">✏️ Edit Who Ate What</button>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  listEl.innerHTML = html;
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
                ${tx.settled ? '✅ Marked as Settled' : (tx.isStaleAmount ? (tx.remainingToPayPaise > 0 ? `⚠️ Amount changed since marked paid — please re-verify (Already paid: ${formatPaise(tx.previouslyPaidPaise)} • Remaining to pay: ${formatPaise(tx.remainingToPayPaise)})` : (tx.overpaidPaise > 0 ? `⚠️ Amount changed since marked paid — please re-verify (Already paid: ${formatPaise(tx.previouslyPaidPaise)} • Overpaid by: ${formatPaise(tx.overpaidPaise)})` : '⚠️ Amount changed since marked paid — please re-verify')) : '⏳ Pending Payment')}
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
