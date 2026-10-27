import { CONFIG } from '../config.js';

// Convert decimal Rupee string/number to exact integer paise
export function rupeesToPaise(rupeeVal) {
  const num = Number(rupeeVal);
  if (isNaN(num) || num < 0) return 0;
  return Math.round(num * CONFIG.CURRENCY.SUBUNITS);
}

// Format integer paise to display string (e.g., ₹1,250.50)
export function formatPaise(paise, includeSymbol = true) {
  const isNegative = paise < 0;
  const absPaise = Math.abs(Math.round(paise));
  const rupees = (absPaise / CONFIG.CURRENCY.SUBUNITS).toFixed(2);
  const parts = rupees.split('.');
  // Indian number system formatting (lakhs/crores)
  let intPart = parts[0];
  let lastThree = intPart.substring(intPart.length - 3);
  const otherNumbers = intPart.substring(0, intPart.length - 3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const formattedInt = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
  const decPart = parts[1] === '00' ? '' : `.${parts[1]}`;
  const sign = isNegative ? '-' : '';
  const sym = includeSymbol ? CONFIG.CURRENCY.SYMBOL : '';
  return `${sign}${sym}${formattedInt}${decPart}`;
}

// Return local today date string in YYYY-MM-DD format
export function getLocalTodayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
