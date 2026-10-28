import { CONFIG } from '../config.js';
import { rupeesToPaise, formatPaise, getLocalTodayStr } from '../domain/money.js';
import { calculateSplits, calculateItemizedSplits } from '../domain/splits.js';
import { canModifyExpense } from '../domain/permissions.js';
import { StorageService } from '../storage/storageAdapter.js';
import { uiState, getActiveTrip, getActiveMemberId, getMemberName } from './state.js';
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

  const taxTipInput = document.getElementById('expTaxTipInput');
  if (existingExp && existingExp.splitType === 'ITEMIZED' && Array.isArray(existingExp.items)) {
    uiState.tempExpenseItems = existingExp.items.map(it => ({
      id: it.id || StorageService.generateId('itm'),
      name: it.name || '',
      priceRupees: it.pricePaise !== undefined ? (it.pricePaise / 100).toString() : '',
      sharedBy: Array.isArray(it.sharedBy) ? [...it.sharedBy] : trip.members.map(m => m.id)
    }));
    const taxVal = existingExp.taxTipPaise ? (existingExp.taxTipPaise / 100).toString() : '0';
    if (taxTipInput) taxTipInput.value = taxVal;
    uiState.tempTaxTipRupees = taxVal;
  } else {
    uiState.tempExpenseItems = [{
      id: StorageService.generateId('itm'),
      name: '',
      priceRupees: '',
      sharedBy: trip.members.map(m => m.id)
    }];
    if (taxTipInput) taxTipInput.value = '0';
    uiState.tempTaxTipRupees = '0';
  }

  uiState.currentSplitType = existingExp ? existingExp.splitType : 'EQUAL';
  updateSplitTypeTabsUI();
  renderItemizedRows(trip);
  renderSplitMemberInputs(trip, existingExp);
  updateLiveSplitCheck();

  const modalEl = document.getElementById('expenseModal');
  if (modalEl) modalEl.classList.add('open');
}

export function updateSplitTypeTabsUI() {
  document.querySelectorAll('.split-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.splitType === uiState.currentSplitType);
  });

  const itemizedSection = document.getElementById('itemizedSplitSection');
  const splitMembers = document.getElementById('splitMembersContainer') || document.getElementById('splitMembersList');
  const btnSelectAll = document.getElementById('btnSelectAllMembers') || document.getElementById('btnSelectAllSplit');
  const expAmount = document.getElementById('expAmount');

  if (uiState.currentSplitType === 'ITEMIZED') {
    if (itemizedSection) itemizedSection.style.display = 'block';
    if (splitMembers) splitMembers.style.display = 'none';
    if (btnSelectAll) btnSelectAll.style.display = 'none';
    if (expAmount) {
      expAmount.readOnly = true;
      expAmount.title = 'Auto-calculated from itemized dishes + tax/tip';
    }
  } else {
    if (itemizedSection) itemizedSection.style.display = 'none';
    if (splitMembers) splitMembers.style.display = 'block';
    if (btnSelectAll) btnSelectAll.style.display = '';
    if (expAmount) {
      expAmount.readOnly = false;
      expAmount.removeAttribute('title');
    }
  }
}

export function renderItemizedRows(trip) {
  const container = document.getElementById('itemizedRowsContainer');
  if (!container || !trip) return;

  const isOnlyOne = uiState.tempExpenseItems.length <= 1;

  container.innerHTML = uiState.tempExpenseItems.map((item, idx) => {
    return `
      <div class="itemized-row" data-item-row="${idx}">
        <div class="itemized-row-main">
          <input type="text" class="form-input item-name-input" data-item-idx="${idx}" placeholder="Dish / Item name" value="${escapeHtml(item.name || '')}" />
          <input type="number" class="form-input item-price-input" data-item-idx="${idx}" placeholder="₹ Price" step="0.01" min="0" value="${escapeHtml(String(item.priceRupees ?? ''))}" />
          <button type="button" class="btn-remove-item icon-btn-xs" data-remove-item="${idx}" ${isOnlyOne ? 'disabled' : ''} aria-label="Remove item">✕</button>
        </div>
        <div class="item-sharers-pills">
          ${trip.members.map(m => {
            const isShared = (item.sharedBy || []).includes(m.id);
            return `<button type="button" class="item-sharer-pill ${isShared ? 'active' : ''}" data-item-sharer="${idx}" data-mem-id="${escapeHtml(m.id)}">${isShared ? '✓ ' : ''}${escapeHtml(m.name)}</button>`;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
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
  const checkBox = document.getElementById('splitLiveCheck');
  const msgEl = document.getElementById('splitCheckStatus') || document.getElementById('splitCheckMessage');
  const mathEl = document.getElementById('splitCheckMath');

  if (uiState.currentSplitType === 'ITEMIZED') {
    const trip = getActiveTrip();
    const domainItems = (uiState.tempExpenseItems || []).map(it => ({
      id: it.id,
      name: it.name || '',
      pricePaise: rupeesToPaise(it.priceRupees || 0),
      sharedBy: it.sharedBy || []
    }));
    const taxTipInput = document.getElementById('expTaxTipInput');
    const taxTipPaise = rupeesToPaise(taxTipInput?.value || 0);
    const validMemberIds = trip ? trip.members.map(m => m.id) : [];
    const res = calculateItemizedSplits(domainItems, taxTipPaise, validMemberIds);

    if (amountInp) {
      amountInp.value = res.totalPaise > 0 ? (res.totalPaise / 100).toFixed(2) : '';
    }

    if (checkBox) {
      checkBox.classList.toggle('valid', res.isValid);
      checkBox.classList.toggle('invalid', !res.isValid);
    }
    if (msgEl) msgEl.textContent = res.message;
    if (mathEl) {
      mathEl.textContent = `Subtotal ${formatPaise(res.subtotalPaise)} + Tax/Tip ${formatPaise(res.taxTipPaise)} = ${formatPaise(res.totalPaise)}`;
    }

    const previewEl = document.getElementById('itemizedMemberPreview');
    if (previewEl && trip) {
      if (res.splits && res.splits.length > 0) {
        previewEl.innerHTML = res.splits.map(s => {
          const memName = getMemberName(trip, s.memberId);
          return `<span class="itemized-member-share"><strong>${escapeHtml(memName)}:</strong> ${formatPaise(s.amountPaise)}</span>`;
        }).join('');
      } else {
        previewEl.innerHTML = '';
      }
    }

    return res;
  }

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
  let totalPaise = rupeesToPaise(amountInp ? amountInp.value : 0);

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

  let splitCalc;
  let domainItems = null;
  if (uiState.currentSplitType === 'ITEMIZED') {
    domainItems = (uiState.tempExpenseItems || []).map(it => ({
      id: it.id,
      name: it.name || '',
      pricePaise: rupeesToPaise(it.priceRupees || 0),
      sharedBy: it.sharedBy || []
    }));
    const taxTipPaise = rupeesToPaise(document.getElementById('expTaxTipInput')?.value || 0);
    splitCalc = calculateItemizedSplits(domainItems, taxTipPaise, trip.members.map(m => m.id));
    if (!splitCalc.isValid) {
      showToast(splitCalc.message);
      return;
    }
    totalPaise = splitCalc.totalPaise;
  } else {
    if (totalPaise <= 0) {
      showToast('Please enter a valid amount greater than 0.');
      return;
    }
    splitCalc = updateLiveSplitCheck();
    if (!splitCalc.isValid) {
      showToast(splitCalc.message);
      return;
    }
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
      const updatedExpense = {
        ...trip.expenses[idx],
        title,
        amountPaise: totalPaise,
        category,
        paidBy,
        date,
        splitType: uiState.currentSplitType,
        splits: splitCalc.splits,
        revision: (trip.expenses[idx].revision || 1) + 1,
        updatedAt: safeUpdatedAt
      };
      if (uiState.currentSplitType === 'ITEMIZED') {
        updatedExpense.items = domainItems;
        updatedExpense.taxTipPaise = splitCalc.taxTipPaise;
      } else {
        delete updatedExpense.items;
        delete updatedExpense.taxTipPaise;
      }
      trip.expenses[idx] = updatedExpense;
      trip.updatedAt = safeUpdatedAt;
    }
    showToast('Expense updated!');
  } else {
    if (!Array.isArray(trip.expenses)) trip.expenses = [];
    const newExpense = {
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
      revision: 1,
      deleted: false
    };
    if (uiState.currentSplitType === 'ITEMIZED') {
      newExpense.items = domainItems;
      newExpense.taxTipPaise = splitCalc.taxTipPaise;
    }
    trip.expenses.push(newExpense);
    trip.updatedAt = now;
    showToast('Expense added!');
  }
  StorageService.saveState(uiState.appState);
  const modalEl = document.getElementById('expenseModal');
  if (modalEl) modalEl.classList.remove('open');
  renderAll();
}

function compressImageFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') {
        return resolve(null);
      }
      const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          const maxDim = 1200;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            return resolve(rawBase64);
          }
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.82);
          const compressedBase64 = compressed.includes(',') ? compressed.split(',')[1] : compressed;
          resolve(compressedBase64 || rawBase64);
        } catch {
          resolve(rawBase64);
        }
      };
      img.onerror = () => {
        resolve(rawBase64);
      };
      img.src = dataUrl;
    };
    reader.onerror = () => {
      resolve(null);
    };
    reader.readAsDataURL(file);
  });
}

export async function handleReceiptFileSelected(file, trip) {
  if (!file || !trip) return;

  const btnScan = document.getElementById('btnScanReceipt');
  if (btnScan) {
    btnScan.textContent = '⏳ Scanning...';
    btnScan.disabled = true;
  }

  try {
    const imageBase64 = await compressImageFile(file);
    if (!imageBase64) {
      showToast('Could not scan receipt — please enter items manually.');
      return;
    }

    const res = await fetch('/api/receipt/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' })
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (res.ok && data?.ok && Array.isArray(data.receipt?.items) && data.receipt.items.length > 0) {
      const expTitle = document.getElementById('expTitle');
      if (expTitle && !expTitle.value.trim() && data.receipt.merchant) {
        expTitle.value = data.receipt.merchant;
      }

      uiState.tempExpenseItems = data.receipt.items.map(it => ({
        id: StorageService.generateId('itm'),
        name: String(it.name || '').trim(),
        priceRupees: Number(it.priceRupees).toString(),
        sharedBy: trip.members.map(m => m.id)
      }));

      const taxTipInput = document.getElementById('expTaxTipInput');
      if (taxTipInput) {
        taxTipInput.value = Number(data.receipt.taxTipRupees || 0).toFixed(2);
      }
      uiState.tempTaxTipRupees = Number(data.receipt.taxTipRupees || 0).toFixed(2);

      renderItemizedRows(trip);
      updateLiveSplitCheck();
      showToast('Receipt scanned! Tap member names to assign who ate what.');
    } else {
      showToast(data?.error || 'Could not scan receipt — please enter items manually.');
    }
  } catch {
    showToast('Could not scan receipt — please enter items manually.');
  } finally {
    if (btnScan) {
      btnScan.textContent = '📷 Scan Receipt';
      btnScan.disabled = false;
    }
  }
}

