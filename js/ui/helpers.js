import { uiState } from './state.js';
import { StorageService } from '../storage/storageAdapter.js';

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'trip';
}

export function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 2800);
}

export function openConfirmModal(title, message, onConfirm, confirmBtnText = 'Confirm', isDanger = true) {
  const titleEl = document.getElementById('confirmModalTitle');
  const msgEl = document.getElementById('confirmModalMessage');
  const confirmBtn = document.getElementById('btnConfirmProceed');
  const modalEl = document.getElementById('confirmModal');
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.innerHTML = message;
  if (confirmBtn) {
    confirmBtn.textContent = confirmBtnText;
    confirmBtn.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
  }
  uiState.pendingConfirmCallback = onConfirm;
  if (modalEl) modalEl.classList.add('open');
}

function fallbackCopy(text, successMsg) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    showToast(successMsg);
  } catch (err) {
    showToast('Please copy manually from the text box.');
  }
  document.body.removeChild(ta);
}

export function copyTextToClipboard(text, successMsg = 'Copied to clipboard!') {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => showToast(successMsg)).catch(() => fallbackCopy(text, successMsg));
  } else {
    fallbackCopy(text, successMsg);
  }
}

export function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function applyTheme() {
  if (!uiState.appState) return;
  const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = uiState.appState.theme === 'dark' || (uiState.appState.theme === null && prefersDark);
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }
}

export function toggleTheme() {
  if (!uiState.appState) return;
  const currentAttr = document.documentElement.getAttribute('data-theme');
  uiState.appState.theme = currentAttr === 'dark' ? 'light' : 'dark';
  StorageService.saveState(uiState.appState);
  applyTheme();
}
