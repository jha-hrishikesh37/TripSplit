import { CONFIG } from '../config.js';
import { formatPaise, getLocalTodayStr } from '../domain/money.js';
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

  lines.push('', 'Tabsolute (Scan. Split. Settle.)');
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

  downloadFile(`tabsolute_${slugify(trip.name)}_report.csv`, csvContent, 'text/csv;charset=utf-8;');
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

/**
 * Zero-dependency pure function that generates a valid multi-page PDF 1.4 binary (Uint8Array).
 * Uses standard built-in Type1 fonts (/Helvetica and /Helvetica-Bold).
 * All currency is formatted as "Rs. X,XXX.XX".
 */
export function generateTripPdfBytes(trip) {
  const safeTrip = trip || { name: 'Trip', members: [], expenses: [], settlements: [] };
  const settlement = computeTripSettlement(safeTrip);
  const activeExpenses = (safeTrip.expenses || []).filter(e => !e.deleted);

  // A4 dimensions in points: 595.28 x 841.89
  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;
  const LEFT_MARGIN = 40;
  const RIGHT_MARGIN = 555.28;
  const TOP_START_Y = 790;
  const BOTTOM_Y = 60;

  const pages = [];
  let currentCmds = [];
  let y = TOP_START_Y;

  function newPage() {
    if (currentCmds.length > 0) {
      pages.push(currentCmds.join('\n'));
      currentCmds = [];
    }
    y = TOP_START_Y;
  }

  function ensureSpace(neededHeight) {
    if (y - neededHeight < BOTTOM_Y) {
      newPage();
    }
  }

  function escapePdfText(str) {
    if (str == null) return '';
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function sanitizePdfString(str) {
    if (str == null) return '';
    let s = String(str);
    s = s.replace(/₹/g, 'Rs. ');
    s = s.replace(/[\u2010-\u2015]/g, '-');
    s = s.replace(/[\u2018\u2019]/g, "'");
    s = s.replace(/[\u201C\u201D]/g, '"');
    s = s.replace(/[^\x20-\x7E]/g, '');
    return escapePdfText(s);
  }

  function formatPaiseForPdf(paise) {
    const formatted = formatPaise(paise);
    const withRs = formatted.replace(/₹/g, 'Rs. ');
    return withRs.replace(/[^\x20-\x7E]/g, '');
  }

  function drawText(text, x, targetY, options = {}) {
    const font = options.font || 'F1';
    const size = options.size || 10;
    const color = options.color || [0.1, 0.1, 0.1];
    const safeText = sanitizePdfString(text);

    currentCmds.push(
      'BT',
      `/${font} ${size} Tf`,
      `${color[0]} ${color[1]} ${color[2]} rg`,
      `1 0 0 1 ${x.toFixed(2)} ${targetY.toFixed(2)} Tm`,
      `(${safeText}) Tj`,
      'ET'
    );
  }

  function wrapText(text, maxChars = 85) {
    if (text.length <= maxChars) return [text];
    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length <= maxChars) {
        cur = (cur + ' ' + w).trim();
      } else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function addLine(text, options = {}) {
    const size = options.size || 10;
    const lineHeight = options.lineHeight || (size + 4);
    const maxChars = options.maxChars || 85;
    const lines = wrapText(String(text ?? ''), maxChars);
    for (const l of lines) {
      ensureSpace(lineHeight);
      const x = options.x || LEFT_MARGIN;
      drawText(l, x, y, options);
      y -= lineHeight;
    }
  }

  function addSpacing(points) {
    if (y - points < BOTTOM_Y) {
      newPage();
    } else {
      y -= points;
    }
  }

  function addDivider(options = {}) {
    const height = options.spacing || 14;
    ensureSpace(height);
    const color = options.color || [0.8, 0.85, 0.9];
    const lineY = y - 4;
    currentCmds.push(
      'q',
      `${color[0]} ${color[1]} ${color[2]} RG`,
      '0.75 w',
      `${LEFT_MARGIN.toFixed(2)} ${lineY.toFixed(2)} m ${RIGHT_MARGIN.toFixed(2)} ${lineY.toFixed(2)} l S`,
      'Q'
    );
    y -= height;
  }

  function addSectionHeader(title) {
    ensureSpace(40);
    addSpacing(8);
    addLine(title, { font: 'F2', size: 12, color: [0.08, 0.18, 0.35], lineHeight: 16 });
    currentCmds.push(
      'q',
      '0.2 0.35 0.55 RG',
      '1 w',
      `${LEFT_MARGIN.toFixed(2)} ${(y + 2).toFixed(2)} m ${(LEFT_MARGIN + 120).toFixed(2)} ${(y + 2).toFixed(2)} l S`,
      'Q'
    );
    addSpacing(6);
  }

  // --- a) HEADER ---
  // "tabsolute — Scan. Split. Settle."
  addLine('tabsolute — Scan. Split. Settle.', {
    font: 'F2',
    size: 10,
    color: [0.25, 0.35, 0.55],
    lineHeight: 14
  });

  // Trip Name
  addLine(safeTrip.name || 'Untitled Trip', {
    font: 'F2',
    size: 18,
    color: [0.08, 0.12, 0.2],
    lineHeight: 22
  });

  // Date Generated, Total Spend, Active Expenses count
  const dateStr = safeTrip.date || getLocalTodayStr();
  const totalSpendStr = formatPaiseForPdf(settlement.totalTripPaise);
  addLine(
    `Date: ${dateStr}   |   Total Spend: ${totalSpendStr}   |   Active Expenses: ${activeExpenses.length}`,
    {
      font: 'F1',
      size: 9.5,
      color: [0.35, 0.4, 0.45],
      lineHeight: 14
    }
  );

  addDivider({ spacing: 16 });

  // --- b) "1. SETTLEMENT PLAN (WHO PAYS WHOM)" ---
  addSectionHeader('1. SETTLEMENT PLAN (WHO PAYS WHOM)');
  if (settlement.transactions.length === 0) {
    addLine('All settled up! Everyone has an equal or cleared balance.', {
      font: 'F1',
      size: 9.5,
      color: [0.35, 0.4, 0.45]
    });
  } else {
    settlement.transactions.forEach(tx => {
      const fromName = getMemberName(safeTrip, tx.fromId);
      const toName = getMemberName(safeTrip, tx.toId);
      const status = tx.settled ? 'PAID' : 'PENDING';
      const amountStr = formatPaiseForPdf(tx.amountPaise);
      let line = `${fromName} -> ${toName}: ${amountStr} [${status}]`;
      if (tx.isStaleAmount && tx.remainingToPayPaise > 0) {
        line += ` (Paid: ${formatPaiseForPdf(tx.previouslyPaidPaise)}, Remaining: ${formatPaiseForPdf(tx.remainingToPayPaise)})`;
      }
      addLine(`• ${line}`, {
        font: tx.settled ? 'F1' : 'F2',
        size: 9.5,
        color: tx.settled ? [0.4, 0.45, 0.5] : [0.1, 0.15, 0.25],
        lineHeight: 14
      });
    });
  }

  addSpacing(6);

  // --- c) "2. MEMBER BALANCES" ---
  addSectionHeader('2. MEMBER BALANCES');
  if (settlement.memberStats.length === 0) {
    addLine('No members found.', { font: 'F1', size: 9.5, color: [0.35, 0.4, 0.45] });
  } else {
    settlement.memberStats.forEach(st => {
      const netPaise = st.remainingNetPaise ?? st.expenseNetPaise;
      const sign = netPaise > 0 ? '+' : '';
      const netStr = `${sign}${formatPaiseForPdf(netPaise)}`;
      const paidStr = formatPaiseForPdf(st.paidPaise);
      const shareStr = formatPaiseForPdf(st.sharePaise);
      addLine(`• ${st.name}: Paid ${paidStr} | Fair Share: ${shareStr} | Net Balance: ${netStr}`, {
        font: 'F1',
        size: 9.5,
        color: [0.15, 0.18, 0.22],
        lineHeight: 14
      });
    });
  }

  addSpacing(6);

  // --- d) "3. EXPENSE HISTORY" ---
  addSectionHeader('3. EXPENSE HISTORY');
  if (activeExpenses.length === 0) {
    addLine('No active expenses recorded.', {
      font: 'F1',
      size: 9.5,
      color: [0.35, 0.4, 0.45]
    });
  } else {
    activeExpenses.forEach((exp, idx) => {
      const paidByName = getMemberName(safeTrip, exp.paidBy);
      const amountStr = formatPaiseForPdf(exp.amountPaise);
      const expDate = exp.date || '-';
      const categoryStr = exp.category || 'General';
      const splitTypeStr = exp.splitType || 'EQUAL';

      // Estimate needed block height
      const hasItems = exp.splitType === 'ITEMIZED' && Array.isArray(exp.items) && exp.items.length > 0;
      const extraLines = hasItems ? exp.items.length + (exp.taxTipPaise ? 1 : 0) : 0;
      ensureSpace(28 + extraLines * 12);

      addLine(`${idx + 1}. ${expDate} — ${exp.title} (${categoryStr}): ${amountStr}`, {
        font: 'F2',
        size: 9.5,
        color: [0.1, 0.12, 0.18],
        lineHeight: 13
      });

      addLine(`   Paid By: ${paidByName} | Split Type: ${splitTypeStr}`, {
        font: 'F1',
        size: 8.5,
        color: [0.35, 0.4, 0.45],
        lineHeight: 12
      });

      if (hasItems) {
        exp.items.forEach(item => {
          const itemPriceStr = formatPaiseForPdf(item.pricePaise);
          const sharedNames = (item.sharedBy || []).map(id => getMemberName(safeTrip, id)).join(', ');
          const itemText = sharedNames
            ? `   - ${item.name}: ${itemPriceStr} (Shared by: ${sharedNames})`
            : `   - ${item.name}: ${itemPriceStr}`;
          addLine(itemText, { font: 'F1', size: 8, color: [0.25, 0.3, 0.35], lineHeight: 11 });
        });
        if (exp.taxTipPaise && exp.taxTipPaise > 0) {
          const taxStr = formatPaiseForPdf(exp.taxTipPaise);
          addLine(`   - Taxes & Fees: ${taxStr}`, { font: 'F1', size: 8, color: [0.25, 0.3, 0.35], lineHeight: 11 });
        }
      }
      addSpacing(3);
    });
  }

  // Finalize pages
  if (currentCmds.length > 0) {
    pages.push(currentCmds.join('\n'));
    currentCmds = [];
  }
  if (pages.length === 0) {
    pages.push('');
  }

  // Footer on each page
  const totalPages = pages.length;
  for (let i = 0; i < totalPages; i++) {
    const footerText = sanitizePdfString(`Page ${i + 1} of ${totalPages}  |  tabsolute`);
    const footerCmds = [
      'q',
      '0.85 0.88 0.92 RG',
      '0.5 w',
      `${LEFT_MARGIN.toFixed(2)} 42.00 m ${RIGHT_MARGIN.toFixed(2)} 42.00 l S`,
      'Q',
      'BT',
      '/F1 8 Tf',
      '0.5 0.55 0.6 rg',
      `1 0 0 1 ${LEFT_MARGIN.toFixed(2)} 28.00 Tm`,
      `(${footerText}) Tj`,
      'ET'
    ].join('\n');
    pages[i] = pages[i] ? `${pages[i]}\n${footerCmds}` : footerCmds;
  }

  // Build PDF indirect objects
  const kids = [];
  for (let i = 0; i < totalPages; i++) {
    kids.push(`${5 + i * 2} 0 R`);
  }

  const objects = [];
  objects.push({ id: 1, body: '<<\n  /Type /Catalog\n  /Pages 2 0 R\n>>' });
  objects.push({ id: 2, body: `<<\n  /Type /Pages\n  /Kids [ ${kids.join(' ')} ]\n  /Count ${totalPages}\n>>` });
  objects.push({ id: 3, body: '<<\n  /Type /Font\n  /Subtype /Type1\n  /BaseFont /Helvetica\n  /Encoding /WinAnsiEncoding\n>>' });
  objects.push({ id: 4, body: '<<\n  /Type /Font\n  /Subtype /Type1\n  /BaseFont /Helvetica-Bold\n  /Encoding /WinAnsiEncoding\n>>' });

  for (let i = 0; i < totalPages; i++) {
    const pageObjId = 5 + i * 2;
    const contentObjId = 6 + i * 2;
    const streamData = pages[i];
    objects.push({
      id: pageObjId,
      body: `<<\n  /Type /Page\n  /Parent 2 0 R\n  /MediaBox [0 0 595.28 841.89]\n  /Resources <<\n    /Font <<\n      /F1 3 0 R\n      /F2 4 0 R\n    >>\n  >>\n  /Contents ${contentObjId} 0 R\n>>`
    });
    objects.push({
      id: contentObjId,
      body: `<<\n  /Length ${streamData.length}\n>>\nstream\n${streamData}\nendstream`
    });
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets[obj.id] = pdf.length;
    pdf += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  const totalObjCount = objects.length;
  pdf += `xref\n0 ${totalObjCount + 1}\n`;
  pdf += '0000000000 65535 f \r\n';

  for (let id = 1; id <= totalObjCount; id++) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \r\n`;
  }

  pdf += `trailer\n<<\n  /Size ${totalObjCount + 1}\n  /Root 1 0 R\n>>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) {
    bytes[i] = pdf.charCodeAt(i) & 0xff;
  }
  return bytes;
}

export async function exportTripToPDF(trip) {
  const pdfBytes = generateTripPdfBytes(trip);
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const safeName = (trip.name || 'trip').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'trip';
  const fileName = `tabsolute_${safeName}_report.pdf`;

  const isStandaloneOrMobile =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator?.standalone === true ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  if (isStandaloneOrMobile && typeof File !== 'undefined' && navigator.canShare) {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: `${trip.name} — Expense Report`,
          text: `Expense report for ${trip.name}`
        });
        showToast('PDF ready to save or share!');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // User closed share sheet
      }
    }
  }

  // Fallback / Desktop download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('PDF report downloaded!');
}
