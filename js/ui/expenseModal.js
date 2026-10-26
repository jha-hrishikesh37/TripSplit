import { CONFIG } from '../config.js';
import { rupeesToPaise, formatPaise, getLocalTodayStr } from '../domain/money.js';
import { calculateSplits } from '../domain/splits.js';
import { canModifyExpense } from '../domain/permissions.js';
import { StorageService } from '../storage/storageAdapter.js';
import { uiState, getActiveTrip, getActiveMemberId } from './state.js';
import { showToast, escapeHtml } from './helpers.js';
import { renderAll } from './views.js';

export function openExpenseModal(expenseId = null) {
  const trip = getActiveTrip();
  if (!trip) return;
  const activeMemberId = getActiveMemberId(trip);

  const catSelect = document.getElementById('expCategory');
  if (catSelect) {
    catSelect.innerHTML = CONFIG.CATEGORIES.map(c =>
      `<option value="${escapeHtml(c.id)}">${c.icon} ${escapeHtml(c.label)}</option>`
    ).join('');
  }

  const paidBySelect = document.getElementById('expPaidBy');
  if (paidBySelect) {
    paidBySelect.innerHTML = trip.members.map(m =>
      `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`
    ).join('');
  }

  let existingExp = null;
  if (expenseId) {
    existingExp = (trip.expenses || []).find(e => e.id === expenseId && !e.deleted);
  }

  const titleEl = document.getElementById('expenseModalTitle');
  if (titleEl) titleEl.textContent = existingExp ? 'Edit Expense' : 'Add Expense';

  const idEl = document.getElementById('expId');
  if (idEl) idEl.value = existingExp ? existingExp.id : '';

  const expTitleEl = document.getElementById('expTitle');
  if (expTitleEl) expTitleEl.value = existingExp ? existingExp.title : '';

  const amountEl = document.getElementById('expAmount');
  if (amountEl) amountEl.value = existingExp ? (existingExp.amountPaise / CONFIG.CURRENCY.SUBUNITS).toFixed(2) : '';

  if (catSelect) catSelect.value = existingExp ? existingExp.category : 'Food';
  if (paidBySelect) paidBySelect.value = existingExp ? existingExp.paidBy : activeMemberId;

  const dateEl = document.getElementById('expDate');
  if (dateEl) dateEl.value = existingExp ? existingExp.date : getLocalTodayStr();

  uiState.currentSplitType = existingExp ? existingExp.splitType : 'EQUAL';
  updateSplitTypeTabsUI();
  renderSplitMemberInputs(trip, existingExp);
  updateLiveSplitCheck();

  const modalEl = document.getElementById('expenseModal');
  if (modalEl) modalEl.classList.add('open');
}

export function updateSplitTypeTabsUI() {
  document.querySelectorAll('.split-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.splitType === uiState.currentSplitType);
  });
}

export function renderSplitMemberInputs(trip, existingExp = null, preservedCheckedIds = null) {
  const container = document.getElementById('splitMembersContainer');
  if (!container) return;

  const checkedList = trip.members.map(m => {
    if (preservedCheckedIds) return preservedCheckedIds.has(m.id);
    const savedSplit = existingExp?.splits?.find(s => s.memberId === m.id);
    return existingExp ? Boolean(savedSplit) : true;
  });
  const activeCount = checkedList.filter(Boolean).length || 1;
  const baseBps = Math.floor(10000 / activeCount);
  const extraBps = 10000 - (baseBps * activeCount);
  let activeIdx = 0;

  container.innerHTML = trip.members.map((m, idx) => {
    const savedSplit = existingExp?.splits?.find(s => s.memberId === m.id);
    const isChecked = checkedList[idx];
    let inputVal = '';

    if (uiState.currentSplitType === 'EXACT') {
      inputVal = savedSplit ? (savedSplit.amountPaise / CONFIG.CURRENCY.SUBUNITS).toFixed(2) : '';
    } else if (uiState.currentSplitType === 'PERCENT') {
      const myDefaultPct = isChecked ? ((baseBps + (activeIdx++ < extraBps ? 1 : 0)) / 100).toFixed(2) : '0.00';
      inputVal = (savedSplit && existingExp?.splitType === 'PERCENT' && savedSplit.metaValue !== undefined)
        ? Number(savedSplit.metaValue).toFixed(2)
        : myDefaultPct;
    }

    return `
      <div class="split-member-row" data-member-row="${escapeHtml(m.id)}">
        <label class="split-member-label">
          <input type="checkbox" class="split-member-check" value="${escapeHtml(m.id)}" ${isChecked ? 'checked' : ''} />
          <span>${escapeHtml(m.name)}</span>
        </label>
        ${uiState.currentSplitType === 'EQUAL' ? `
          <span class="split-computed-share" data-share-for="${escapeHtml(m.id)}" style="font-size:0.85rem; color:var(--text-muted); font-weight:600;">₹0</span>
        ` : `
          <div class="split-input-wrap">
            <input type="number" class="form-input split-member-val" data-val-for="${escapeHtml(m.id)}"
              step="0.01" min="0" value="${inputVal}" placeholder="${uiState.currentSplitType === 'EXACT' ? '0.00' : '0.00'}"
              style="padding:6px 8px; font-size:0.85rem;" />
            <span style="font-size:0.8rem; color:var(--text-muted);">${uiState.currentSplitType === 'EXACT' ? CONFIG.CURRENCY.SYMBOL : '%'}</span>
          </div>
        `}
      </div>
    `;
  }).join('');

  container.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', updateLiveSplitCheck);
    inp.addEventListener('change', updateLiveSplitCheck);
  });

  // Deselecting/selecting members in PERCENT split
  container.querySelectorAll('.split-member-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (uiState.currentSplitType === 'PERCENT') {
        const row = cb.closest('[data-member-row]');
        const valInput = row ? row.querySelector('.split-member-val') : null;
        const checkedRows = Array.from(container.querySelectorAll('.split-member-row'))
          .filter(r => r.querySelector('.split-member-check').checked);

        if (!cb.checked) {
          // Deselecting a member: divide its percent value between remaining checked members
          const valBps = valInput ? Math.round(Number(valInput.value || 0) * 100) : 0;
          if (valInput) valInput.value = '0.00';

          if (checkedRows.length > 0 && valBps > 0) {
            const count = checkedRows.length;
            const baseAdd = Math.floor(valBps / count);
            const extraAdd = valBps % count;

            const sorted = checkedRows.map(r => {
              const inp = r.querySelector('.split-member-val');
              return { r, inp, bps: Math.round(Number(inp?.value || 0) * 100) };
            }).sort((a, b) => a.bps - b.bps);

            sorted.forEach((item, idx) => {
              if (item.inp) {
                const extra = idx < extraAdd ? 1 : 0;
                const newBps = item.bps + baseAdd + extra;
                item.inp.value = (newBps / 100).toFixed(2);
              }
            });
          }
        } else {
          // Selecting a member in percent split: redistribute 100% equally among all checked members
          const count = checkedRows.length || 1;
          const baseBps = Math.floor(10000 / count);
          const extraBps = 10000 - (baseBps * count);
          let activeIdx = 0;

          container.querySelectorAll('.split-member-row').forEach(r => {
            const isChk = r.querySelector('.split-member-check').checked;
            const inp = r.querySelector('.split-member-val');
            if (inp) {
              if (isChk) {
                inp.value = ((baseBps + (activeIdx++ < extraBps ? 1 : 0)) / 100).toFixed(2);
              } else {
                inp.value = '0.00';
              }
            }
          });
        }
      }
      updateLiveSplitCheck();
    });
  });

  // Ensure entered percentages always format to two floating points on blur
  container.querySelectorAll('.split-member-val').forEach(inp => {
    inp.addEventListener('blur', () => {
      if (uiState.currentSplitType === 'PERCENT') {
        const val = parseFloat(inp.value);
        if (!isNaN(val) && inp.value.trim() !== '') {
          inp.value = val.toFixed(2);
          updateLiveSplitCheck();
        }
      }
    });
  });
}

export function readSplitInputsFromDOM() {
  const trip = getActiveTrip();
  if (!trip) return [];
  return trip.members.map(m => {
    const row = document.querySelector(`[data-member-row="${m.id}"]`);
    const checked = row ? row.querySelector('.split-member-check').checked : false;
    const valInput = row ? row.querySelector('.split-member-val') : null;
    return {
      memberId: m.id,
      included: checked,
      rawValue: valInput ? valInput.value : 0
    };
  });
}

export function updateLiveSplitCheck() {
  const amountInp = document.getElementById('expAmount');
  const totalPaise = rupeesToPaise(amountInp ? amountInp.value : 0);
  const memberInputs = readSplitInputsFromDOM();
  const result = calculateSplits(totalPaise, uiState.currentSplitType, memberInputs);

  // Update equal computed preview badges if in EQUAL mode
  if (uiState.currentSplitType === 'EQUAL') {
    document.querySelectorAll('.split-computed-share').forEach(el => {
      const memId = el.dataset.shareFor;
      const found = result.splits.find(s => s.memberId === memId);
      el.textContent = found ? formatPaise(found.amountPaise) : '—';
    });
  }

  const checkBox = document.getElementById('splitLiveCheck');
  const msgEl = document.getElementById('splitCheckMessage');
  const mathEl = document.getElementById('splitCheckMath');

  if (checkBox) {
    checkBox.classList.toggle('valid', result.isValid);
    checkBox.classList.toggle('invalid', !result.isValid);
  }
  if (msgEl) msgEl.textContent = result.message;

  if (mathEl) {
    if (uiState.currentSplitType === 'PERCENT') {
      mathEl.textContent = `${(result.totalPercent || 0).toFixed(2)}% / 100.00%`;
    } else {
      mathEl.textContent = `${formatPaise(result.allocatedPaise)} / ${formatPaise(totalPaise)}`;
    }
  }

  return result;
}

export function handleSaveExpense(e) {
  if (e && e.preventDefault) e.preventDefault();
  const trip = getActiveTrip();
  if (!trip) return;

  const titleInp = document.getElementById('expTitle');
  const title = titleInp ? titleInp.value.trim() : '';

  const amountInp = document.getElementById('expAmount');
  const totalPaise = rupeesToPaise(amountInp ? amountInp.value : 0);

  const catInp = document.getElementById('expCategory');
  const category = catInp ? catInp.value : 'Food';

  const paidByInp = document.getElementById('expPaidBy');
  const paidBy = paidByInp ? paidByInp.value : '';

  const dateInp = document.getElementById('expDate');
  const date = dateInp ? dateInp.value : getLocalTodayStr();

  const idInp = document.getElementById('expId');
  const expId = idInp ? idInp.value : '';

  if (!title) {
    showToast('Please enter an expense title.');
    return;
  }
  if (totalPaise <= 0) {
    showToast('Please enter a valid amount greater than 0.');
    return;
  }

  const splitCalc = updateLiveSplitCheck();
  if (!splitCalc.isValid) {
    showToast(splitCalc.message);
    return;
  }

  const now = Date.now();
  const activeMemberId = getActiveMemberId(trip);

  if (expId) {
    const idx = (trip.expenses || []).findIndex(x => x.id === expId);
    if (idx !== -1) {
      if (!canModifyExpense(trip, trip.expenses[idx], activeMemberId)) {
        showToast('Only the creator or trip organizer can edit this expense.');
        return;
      }
      const safeUpdatedAt = Math.max(now, (trip.expenses[idx].updatedAt || 0) + 1);
      trip.expenses[idx] = {
        ...trip.expenses[idx],
        title,
        amountPaise: totalPaise,
        category,
        paidBy,
        date,
        splitType: uiState.currentSplitType,
        splits: splitCalc.splits,
        updatedAt: safeUpdatedAt
      };
      trip.updatedAt = safeUpdatedAt;
    }
    showToast('Expense updated!');
  } else {
    if (!Array.isArray(trip.expenses)) trip.expenses = [];
    trip.expenses.push({
      id: StorageService.generateId('exp'),
      tripId: trip.id,
      title,
      amountPaise: totalPaise,
      category,
      paidBy,
      date,
      splitType: uiState.currentSplitType,
      splits: splitCalc.splits,
      createdBy: activeMemberId,
      createdAt: now,
      updatedAt: now,
      deleted: false
    });
    trip.updatedAt = now;
    showToast('Expense added!');
  }
  StorageService.saveState(uiState.appState);
  const modalEl = document.getElementById('expenseModal');
  if (modalEl) modalEl.classList.remove('open');
  renderAll();
}
