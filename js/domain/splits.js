import { CONFIG } from '../config.js';
import { rupeesToPaise, formatPaise } from './money.js';

/**
 * Calculate exact paise splits for EQUAL, EXACT, or PERCENT split types.
 * Deterministic remainder allocation guarantees sum(splits) === totalPaise.
 */
export function calculateSplits(totalPaise, splitType, memberInputs, itemizedPayload = null) {
  if (splitType === 'ITEMIZED' && itemizedPayload) {
    return calculateItemizedSplits(
      itemizedPayload.items,
      itemizedPayload.taxTipPaise,
      itemizedPayload.validMemberIds
    );
  }
  // memberInputs: [{ memberId, included, rawValue }]
  const activeMembers = (memberInputs || []).filter(m => m.included);
  if (activeMembers.length === 0 || totalPaise <= 0) {
    return {
      isValid: false,
      allocatedPaise: 0,
      diffPaise: -totalPaise,
      splits: [],
      message: activeMembers.length === 0 ? 'Select at least 1 member' : 'Enter an amount > 0'
    };
  }

  if (splitType === 'EQUAL') {
    const count = activeMembers.length;
    const baseShare = Math.floor(totalPaise / count);
    let remainder = totalPaise - (baseShare * count);

    // Sort deterministically by memberId for remainder distribution
    const sortedMembers = [...activeMembers].sort((a, b) => a.memberId.localeCompare(b.memberId));
    const splits = sortedMembers.map((m, idx) => {
      const extra = idx < remainder ? 1 : 0;
      return {
        memberId: m.memberId,
        amountPaise: baseShare + extra,
        metaValue: 1
      };
    });

    return {
      isValid: true,
      allocatedPaise: totalPaise,
      diffPaise: 0,
      splits,
      message: `Split equally (${formatPaise(baseShare)} each)`
    };
  }

  if (splitType === 'EXACT') {
    let sumPaise = 0;
    const splits = activeMembers.map(m => {
      const p = rupeesToPaise(m.rawValue || 0);
      sumPaise += p;
      return {
        memberId: m.memberId,
        amountPaise: p,
        metaValue: Number(m.rawValue || 0)
      };
    });

    const diff = sumPaise - totalPaise;
    return {
      isValid: diff === 0,
      allocatedPaise: sumPaise,
      diffPaise: diff,
      splits,
      message: diff === 0
        ? 'Custom amounts match total exactly'
        : (diff < 0 ? `${formatPaise(Math.abs(diff))} remaining to allocate` : `${formatPaise(diff)} over total`)
    };
  }

  if (splitType === 'PERCENT') {
    let totalBps = 0;
    let hasNegative = false;
    activeMembers.forEach(m => {
      const val = Number(m.rawValue || 0);
      if (val < 0 || !Number.isFinite(val)) hasNegative = true;
      totalBps += Math.round(val * 100);
    });

    if (hasNegative) {
      return {
        isValid: false,
        allocatedPaise: 0,
        diffPaise: 0,
        totalPercent: 0,
        splits: [],
        message: 'Percentages cannot be negative'
      };
    }

    const isPercentValid = totalBps === 10000;
    let runningPaise = 0;

    const rawItems = activeMembers.map((m, idx) => {
      const bps = Math.round(Number(m.rawValue || 0) * 100);
      const exactNumerator = totalPaise * bps;
      const baseShare = Math.floor(exactNumerator / 10000);
      const remainder = exactNumerator % 10000;
      runningPaise += baseShare;
      return {
        idx,
        remainder,
        split: {
          memberId: m.memberId,
          amountPaise: baseShare,
          metaValue: bps / 100
        }
      };
    });

    if (isPercentValid && rawItems.length > 0) {
      let remPaise = totalPaise - runningPaise;
      const byRemainder = [...rawItems].sort((a, b) => b.remainder - a.remainder || a.idx - b.idx);
      for (let i = 0; i < remPaise && i < byRemainder.length; i++) {
        byRemainder[i].split.amountPaise += 1;
      }
      runningPaise = totalPaise;
    }

    const totalPercent = totalBps / 100;
    return {
      isValid: isPercentValid,
      allocatedPaise: runningPaise,
      diffPaise: totalBps - 10000,
      totalPercent,
      splits: rawItems.map(item => item.split),
      message: isPercentValid
        ? 'Percentages total 100%'
        : `Total is ${totalPercent.toFixed(2)}% (must be 100%)`
    };
  }

  return { isValid: false, allocatedPaise: 0, diffPaise: 0, splits: [], message: 'Invalid split type' };
}

/**
 * Calculate itemized splits where each item is divided equally among its sharers,
 * and tax/tip is distributed proportionally according to each participant's item subtotal.
 */
export function calculateItemizedSplits(items = [], taxTipPaise = 0, validMemberIds = []) {
  const cleanTaxTipPaise = Math.round(Number(taxTipPaise || 0));
  if (cleanTaxTipPaise < 0) {
    return {
      isValid: false,
      totalPaise: 0,
      subtotalPaise: 0,
      taxTipPaise: cleanTaxTipPaise,
      allocatedPaise: 0,
      diffPaise: 0,
      splits: [],
      message: 'Tax/tip cannot be negative'
    };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return {
      isValid: false,
      totalPaise: 0,
      subtotalPaise: 0,
      taxTipPaise: cleanTaxTipPaise,
      allocatedPaise: 0,
      diffPaise: 0,
      splits: [],
      message: 'Add at least one bill item'
    };
  }

  const subtotalByMember = new Map();
  let subtotalPaise = 0;

  for (const item of items) {
    const pricePaise = Math.round(Number(item?.pricePaise || 0));
    if (pricePaise <= 0) {
      return {
        isValid: false,
        totalPaise: 0,
        subtotalPaise: 0,
        taxTipPaise: cleanTaxTipPaise,
        allocatedPaise: 0,
        diffPaise: 0,
        splits: [],
        message: 'Every item must have a price greater than ₹0'
      };
    }

    let sharerIds = (item?.sharedBy || []).filter(Boolean);
    if (Array.isArray(validMemberIds) && validMemberIds.length > 0) {
      const validSet = new Set(validMemberIds);
      sharerIds = sharerIds.filter(id => validSet.has(id));
    }
    const sharers = Array.from(new Set(sharerIds)).sort((a, b) => a.localeCompare(b));

    if (sharers.length === 0) {
      return {
        isValid: false,
        totalPaise: 0,
        subtotalPaise: 0,
        taxTipPaise: cleanTaxTipPaise,
        allocatedPaise: 0,
        diffPaise: 0,
        splits: [],
        message: `Select at least one person for "${item?.name || 'item'}"`
      };
    }

    subtotalPaise += pricePaise;
    const base = Math.floor(pricePaise / sharers.length);
    const rem = pricePaise % sharers.length;
    sharers.forEach((sharerId, idx) => {
      const share = base + (idx < rem ? 1 : 0);
      const current = subtotalByMember.get(sharerId) || 0;
      subtotalByMember.set(sharerId, current + share);
    });
  }

  const participantIds = Array.from(subtotalByMember.keys()).sort((a, b) => a.localeCompare(b));
  const taxShares = new Map();
  let sumFloorTax = 0;
  const remEntries = [];

  for (const memberId of participantIds) {
    const itemSubtotal = subtotalByMember.get(memberId) || 0;
    const exactNumer = itemSubtotal * cleanTaxTipPaise;
    const floorTax = subtotalPaise > 0 ? Math.floor(exactNumer / subtotalPaise) : 0;
    const remNumer = subtotalPaise > 0 ? (exactNumer % subtotalPaise) : 0;
    taxShares.set(memberId, floorTax);
    sumFloorTax += floorTax;
    remEntries.push({ memberId, remNumer });
  }

  const remTaxPaise = cleanTaxTipPaise - sumFloorTax;
  remEntries.sort((a, b) => b.remNumer - a.remNumer || a.memberId.localeCompare(b.memberId));
  for (let i = 0; i < remTaxPaise && i < remEntries.length; i++) {
    const mId = remEntries[i].memberId;
    taxShares.set(mId, taxShares.get(mId) + 1);
  }

  const splits = participantIds.map(memberId => {
    const itemSubtotal = subtotalByMember.get(memberId) || 0;
    const memberTaxShare = taxShares.get(memberId) || 0;
    return {
      memberId,
      amountPaise: itemSubtotal + memberTaxShare,
      metaValue: itemSubtotal
    };
  });

  const totalPaise = subtotalPaise + cleanTaxTipPaise;
  return {
    isValid: true,
    totalPaise,
    subtotalPaise,
    taxTipPaise: cleanTaxTipPaise,
    allocatedPaise: totalPaise,
    diffPaise: 0,
    splits,
    message: 'Itemized bill matches total'
  };
}
