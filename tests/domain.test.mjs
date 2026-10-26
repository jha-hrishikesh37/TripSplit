import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../js/config.js';
import { rupeesToPaise, formatPaise, getLocalTodayStr } from '../js/domain/money.js';
import { calculateSplits } from '../js/domain/splits.js';
import { computeTripSettlement } from '../js/domain/settlement.js';
import { canModifyExpense, canRemoveMember } from '../js/domain/permissions.js';

test('CONFIG invariants', () => {
  assert.equal(CONFIG.APP_STORAGE_KEY, 'tripsplit_v1_state');
  assert.equal(CONFIG.SYNC_PREFIX, 'TRIPSYNC1:');
  assert.equal(CONFIG.CURRENCY.SUBUNITS, 100);
  assert.equal(CONFIG.CURRENCY.SYMBOL, '₹');
  assert.ok(Object.isFrozen(CONFIG));
});

test('money: rupeesToPaise conversion', () => {
  assert.equal(rupeesToPaise('19.99'), 1999);
  assert.equal(rupeesToPaise(19.99), 1999);
  assert.equal(rupeesToPaise('0'), 0);
  assert.equal(rupeesToPaise(0), 0);
  assert.equal(rupeesToPaise('-5'), 0);
  assert.equal(rupeesToPaise('invalid'), 0);
  assert.equal(rupeesToPaise('100.50'), 10050);
});

test('money: formatPaise formatting', () => {
  assert.equal(formatPaise(1440050), '₹14,400.50');
  assert.equal(formatPaise(-5000), '-₹50');
  assert.equal(formatPaise(1440050, false), '14,400.50');
  assert.equal(formatPaise(-5000, false), '-50');
  assert.equal(formatPaise(0), '₹0');
  assert.equal(formatPaise(10000000), '₹1,00,000'); // 1 Lakh Indian format
});

test('money: getLocalTodayStr', () => {
  const today = getLocalTodayStr();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);

  const customDate = new Date(2026, 0, 5); // 2026-01-05
  assert.equal(getLocalTodayStr(customDate), '2026-01-05');
});

test('splits: EQUAL deterministic remainder allocation and sort', () => {
  const memberInputs = [
    { memberId: 'mem_c', included: true },
    { memberId: 'mem_a', included: true },
    { memberId: 'mem_b', included: true }
  ];

  const result = calculateSplits(10000, 'EQUAL', memberInputs);
  assert.equal(result.isValid, true);
  assert.equal(result.allocatedPaise, 10000);
  assert.equal(result.diffPaise, 0);

  const splitA = result.splits.find(s => s.memberId === 'mem_a');
  const splitB = result.splits.find(s => s.memberId === 'mem_b');
  const splitC = result.splits.find(s => s.memberId === 'mem_c');

  assert.ok(splitA);
  assert.ok(splitB);
  assert.ok(splitC);

  // Deterministic sort by localeCompare puts mem_a first, receiving the 1-paisa remainder
  assert.equal(splitA.amountPaise, 3334);
  assert.equal(splitB.amountPaise, 3333);
  assert.equal(splitC.amountPaise, 3333);

  const totalSum = result.splits.reduce((sum, s) => sum + s.amountPaise, 0);
  assert.equal(totalSum, 10000);
});

test('splits: PERCENT split basis-point validation and largest-remainder sorting', () => {
  const validInputs = [
    { memberId: 'mem_1', included: true, rawValue: '33.34' },
    { memberId: 'mem_2', included: true, rawValue: '33.33' },
    { memberId: 'mem_3', included: true, rawValue: '33.33' }
  ];

  const resultValid = calculateSplits(10000, 'PERCENT', validInputs);
  assert.equal(resultValid.isValid, true);
  assert.equal(resultValid.allocatedPaise, 10000);
  assert.equal(resultValid.totalPercent, 100);

  const sumValid = resultValid.splits.reduce((sum, s) => sum + s.amountPaise, 0);
  assert.equal(sumValid, 10000);

  // Test 33.33 * 3 = 99.99% (9999 bps) -> invalid
  const invalidInputs = [
    { memberId: 'mem_1', included: true, rawValue: '33.33' },
    { memberId: 'mem_2', included: true, rawValue: '33.33' },
    { memberId: 'mem_3', included: true, rawValue: '33.33' }
  ];
  const resultInvalid = calculateSplits(10000, 'PERCENT', invalidInputs);
  assert.equal(resultInvalid.isValid, false);
  assert.equal(resultInvalid.diffPaise, -1); // 9999 - 10000 = -1 bps

  // Negative percentage
  const negativeInputs = [
    { memberId: 'mem_1', included: true, rawValue: '-10' },
    { memberId: 'mem_2', included: true, rawValue: '110' }
  ];
  const resultNeg = calculateSplits(10000, 'PERCENT', negativeInputs);
  assert.equal(resultNeg.isValid, false);
});

test('splits: EXACT split matching vs under-allocated', () => {
  const underAllocatedInputs = [
    { memberId: 'mem_1', included: true, rawValue: '30' }, // 3000 paise
    { memberId: 'mem_2', included: true, rawValue: '40' }  // 4000 paise
  ];
  const underResult = calculateSplits(10000, 'EXACT', underAllocatedInputs);
  assert.equal(underResult.isValid, false);
  assert.equal(underResult.allocatedPaise, 7000);
  assert.equal(underResult.diffPaise, -3000);

  const exactMatchInputs = [
    { memberId: 'mem_1', included: true, rawValue: '40' }, // 4000 paise
    { memberId: 'mem_2', included: true, rawValue: '60' }  // 6000 paise
  ];
  const exactResult = calculateSplits(10000, 'EXACT', exactMatchInputs);
  assert.equal(exactResult.isValid, true);
  assert.equal(exactResult.allocatedPaise, 10000);
  assert.equal(exactResult.diffPaise, 0);
});

test('settlement: computeTripSettlement 1-paisa net balance and zero-sum invariant', () => {
  const trip = {
    id: 'trip_paisa_test',
    members: [
      { id: 'mem_1', name: 'Member 1' },
      { id: 'mem_2', name: 'Member 2' }
    ],
    expenses: [
      {
        id: 'exp_1',
        amountPaise: 1,
        paidBy: 'mem_1',
        splits: [
          { memberId: 'mem_1', amountPaise: 0 },
          { memberId: 'mem_2', amountPaise: 1 }
        ],
        deleted: false
      }
    ],
    settlements: []
  };

  const settlement = computeTripSettlement(trip);
  assert.equal(settlement.totalTripPaise, 1);

  const sumExpenseNet = settlement.memberStats.reduce((sum, m) => sum + m.expenseNetPaise, 0);
  assert.equal(sumExpenseNet, 0);

  assert.equal(settlement.transactions.length, 1);
  const tx = settlement.transactions[0];
  assert.equal(tx.fromId, 'mem_2');
  assert.equal(tx.toId, 'mem_1');
  assert.equal(tx.amountPaise, 1);
});

test('settlement: settlement record matching vs stale amount', () => {
  // b) When settlement record matches transfer: settled === true and isStaleAmount === false
  const trip = {
    id: 'trip_stale_test',
    members: [
      { id: 'm1', name: 'Member 1' },
      { id: 'm2', name: 'Member 2' }
    ],
    expenses: [
      {
        id: 'exp_1',
        amountPaise: 100000,
        paidBy: 'm1',
        splits: [
          { memberId: 'm1', amountPaise: 50000 },
          { memberId: 'm2', amountPaise: 50000 }
        ],
        deleted: false
      }
    ],
    settlements: [
      {
        id: 'set_m2_m1',
        settled: true,
        amountPaise: 50000,
        updatedAt: 1700000000000,
        deleted: false
      }
    ]
  };

  let settlement = computeTripSettlement(trip);
  assert.equal(settlement.transactions.length, 1);
  let tx = settlement.transactions[0];
  assert.equal(tx.id, 'set_m2_m1');
  assert.equal(tx.amountPaise, 50000);
  assert.equal(tx.settled, true);
  assert.equal(tx.isStaleAmount, false);

  // c) When a new expense changes that transfer to 80000: settled === false and isStaleAmount === true
  trip.expenses.push({
    id: 'exp_2',
    amountPaise: 60000,
    paidBy: 'm1',
    splits: [
      { memberId: 'm1', amountPaise: 30000 },
      { memberId: 'm2', amountPaise: 30000 }
    ],
    deleted: false
  });

  settlement = computeTripSettlement(trip);
  assert.equal(settlement.transactions.length, 1);
  tx = settlement.transactions[0];
  assert.equal(tx.id, 'set_m2_m1');
  assert.equal(tx.amountPaise, 80000);
  assert.equal(tx.settled, false);
  assert.equal(tx.isStaleAmount, true);
});

test('permissions: canModifyExpense permissions rules', () => {
  const trip = {
    id: 'trip_1',
    organizerId: 'mem_organizer',
    members: [
      { id: 'mem_organizer', name: 'Organizer' },
      { id: 'mem_creator', name: 'Creator' },
      { id: 'mem_other', name: 'Other' }
    ]
  };

  const expense = {
    id: 'exp_1',
    createdBy: 'mem_creator',
    amountPaise: 1000
  };

  // Organizer can modify any expense
  assert.equal(canModifyExpense(trip, expense, 'mem_organizer'), true);

  // Creator can modify their own expense
  assert.equal(canModifyExpense(trip, expense, 'mem_creator'), true);

  // Other member cannot modify expense
  assert.equal(canModifyExpense(trip, expense, 'mem_other'), false);

  // Null/missing inputs return false
  assert.equal(canModifyExpense(null, expense, 'mem_creator'), false);
  assert.equal(canModifyExpense(trip, null, 'mem_creator'), false);
  assert.equal(canModifyExpense(trip, expense, null), false);
});

test('permissions: canRemoveMember pure helper', () => {
  const trip = {
    id: 'trip_1',
    members: [
      { id: 'mem_payer', name: 'Payer' },
      { id: 'mem_split', name: 'Split Member' },
      { id: 'mem_free', name: 'Free Member' },
      { id: 'mem_deleted_only', name: 'Deleted Exp Member' }
    ],
    expenses: [
      {
        id: 'exp_active',
        paidBy: 'mem_payer',
        splits: [
          { memberId: 'mem_payer', amountPaise: 500 },
          { memberId: 'mem_split', amountPaise: 500 }
        ],
        deleted: false
      },
      {
        id: 'exp_deleted',
        paidBy: 'mem_deleted_only',
        splits: [
          { memberId: 'mem_deleted_only', amountPaise: 1000 }
        ],
        deleted: true
      }
    ]
  };

  // Cannot remove payer of an active expense
  assert.equal(canRemoveMember(trip, 'mem_payer'), false);

  // Cannot remove member included in split of an active expense
  assert.equal(canRemoveMember(trip, 'mem_split'), false);

  // Can remove member with no expense involvement
  assert.equal(canRemoveMember(trip, 'mem_free'), true);

  // Can remove member who is only referenced in soft-deleted expenses
  assert.equal(canRemoveMember(trip, 'mem_deleted_only'), true);

  // Empty expenses allows removal
  assert.equal(canRemoveMember({ expenses: [] }, 'any_mem'), true);
});
