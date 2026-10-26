import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../js/config.js';
import { rupeesToPaise, formatPaise, getLocalTodayStr } from '../js/domain/money.js';
import { calculateSplits } from '../js/domain/splits.js';
import { computeTripSettlement } from '../js/domain/settlement.js';
import { canModifyExpense, canRemoveMember } from '../js/domain/permissions.js';
import { createInitialDemoState } from '../js/storage/seed.js';
import {
  generateId,
  encodePayloadToBase64,
  decodePayloadFromBase64,
  exportTripPayload
} from '../js/storage/syncCodec.js';
import { mergeTripInMemory } from '../js/storage/merge.js';
import { StorageService } from '../js/storage/storageAdapter.js';

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

test('storage: encodePayloadToBase64 and decodePayloadFromBase64 with simulated WhatsApp URL', () => {
  const originalObj = {
    type: 'TRIPSPLIT_SYNC_V1',
    exportedAt: 1700000000000,
    trip: {
      id: 'trip_sync_test',
      name: 'Goa 2026',
      members: [{ id: 'm1', name: 'Aarav' }]
    }
  };

  const code = encodePayloadToBase64(originalObj);
  assert.ok(code.startsWith(CONFIG.SYNC_PREFIX));

  // Simulated WhatsApp URL: 'https://tripsplit.pages.dev/#sync=' + encodeURIComponent(code)
  const whatsappUrl = 'https://tripsplit.pages.dev/#sync=' + encodeURIComponent(code);
  const decodedFromUrl = decodePayloadFromBase64(whatsappUrl);
  assert.deepEqual(decodedFromUrl, originalObj);

  // Direct code string decode
  const decodedDirect = decodePayloadFromBase64(code);
  assert.deepEqual(decodedDirect, originalObj);
});

test('storage: mergeTripInMemory sanitizes float amountPaise and filters invalid expenses', () => {
  const state = {
    version: 1,
    activeTripId: null,
    activeIdentities: {},
    trips: []
  };

  const payload = {
    type: 'TRIPSPLIT_SYNC_V1',
    trip: {
      id: 'trip_sanitize_test',
      name: 'Sanitization Test',
      members: [{ id: 'm1', name: 'Aarav' }],
      expenses: [
        // Valid with float amountPaise to be rounded to integer
        {
          id: 'exp_float',
          amountPaise: 123.4,
          splits: [{ memberId: 'm1', amountPaise: 123.4 }],
          deleted: false
        },
        // Invalid: missing/invalid id
        {
          id: null,
          amountPaise: 500,
          splits: []
        },
        // Invalid: zero amount
        {
          id: 'exp_zero',
          amountPaise: 0,
          splits: []
        },
        // Invalid: negative amount
        {
          id: 'exp_neg',
          amountPaise: -100,
          splits: []
        },
        // Invalid: NaN amount
        {
          id: 'exp_nan',
          amountPaise: 'invalid',
          splits: []
        },
        // Invalid: splits is not array
        {
          id: 'exp_no_splits',
          amountPaise: 200,
          splits: null
        }
      ]
    }
  };

  const stats = mergeTripInMemory(state, payload);
  assert.equal(stats.isNewTrip, true);
  assert.equal(stats.addedExpenses, 1);

  const importedTrip = state.trips.find(t => t.id === 'trip_sanitize_test');
  assert.ok(importedTrip);
  assert.equal(importedTrip.expenses.length, 1);
  assert.equal(importedTrip.expenses[0].id, 'exp_float');
  assert.equal(importedTrip.expenses[0].amountPaise, 123);
  assert.equal(importedTrip.expenses[0].splits[0].amountPaise, 123);
});

test('storage: mergeTripInMemory preserves soft-deleted expense against older incoming edit', () => {
  const state = {
    version: 1,
    activeTripId: 'trip_soft_del',
    activeIdentities: {},
    trips: [
      {
        id: 'trip_soft_del',
        name: 'Soft Delete Test',
        members: [{ id: 'm1', name: 'Aarav' }],
        expenses: [
          {
            id: 'exp_1',
            title: 'Dinner',
            amountPaise: 5000,
            deleted: true,
            updatedAt: 200,
            splits: [{ memberId: 'm1', amountPaise: 5000 }]
          }
        ],
        settlements: [],
        updatedAt: 200
      }
    ]
  };

  const payload = {
    type: 'TRIPSPLIT_SYNC_V1',
    trip: {
      id: 'trip_soft_del',
      name: 'Soft Delete Test',
      members: [{ id: 'm1', name: 'Aarav' }],
      expenses: [
        {
          id: 'exp_1',
          title: 'Dinner Edited',
          amountPaise: 6000,
          deleted: false,
          updatedAt: 100,
          splits: [{ memberId: 'm1', amountPaise: 6000 }]
        }
      ],
      updatedAt: 100
    }
  };

  const stats = mergeTripInMemory(state, payload);
  assert.equal(stats.updatedExpenses, 0);

  const localTrip = state.trips[0];
  const exp = localTrip.expenses.find(e => e.id === 'exp_1');
  assert.equal(exp.deleted, true);
  assert.equal(exp.updatedAt, 200);
  assert.equal(exp.amountPaise, 5000);
  assert.equal(exp.title, 'Dinner');
});

test('storage: mergeTripInMemory preserves renamed member against older member in newer trip payload', () => {
  const state = {
    version: 1,
    activeTripId: 'trip_member_lww',
    activeIdentities: {},
    trips: [
      {
        id: 'trip_member_lww',
        name: 'Trip Original',
        organizerId: 'm1',
        members: [
          { id: 'm1', name: 'Aarav', isOrganizer: true, updatedAt: 300 }
        ],
        expenses: [],
        settlements: [],
        updatedAt: 200
      }
    ]
  };

  const payload = {
    type: 'TRIPSPLIT_SYNC_V1',
    trip: {
      id: 'trip_member_lww',
      name: 'Trip Updated',
      organizerId: 'm1',
      members: [
        { id: 'm1', name: 'Me (Organizer)', isOrganizer: true, updatedAt: 100 }
      ],
      expenses: [],
      settlements: [],
      updatedAt: 500 // Newer trip updatedAt
    }
  };

  mergeTripInMemory(state, payload);

  const localTrip = state.trips[0];
  // Trip name updated because trip.updatedAt (500) > localTrip.updatedAt (200)
  assert.equal(localTrip.name, 'Trip Updated');
  assert.equal(localTrip.updatedAt, 500);

  // Member name 'Aarav' preserved because local member updatedAt (300) > incoming member updatedAt (100)
  const member = localTrip.members.find(m => m.id === 'm1');
  assert.ok(member);
  assert.equal(member.name, 'Aarav');
  assert.equal(member.updatedAt, 300);
});

test('storage: StorageService exports and methods contract', () => {
  assert.equal(typeof StorageService.generateId, 'function');
  assert.equal(typeof StorageService.encodePayloadToBase64, 'function');
  assert.equal(typeof StorageService.decodePayloadFromBase64, 'function');
  assert.equal(typeof StorageService.exportTripPayload, 'function');
  assert.equal(typeof StorageService.loadState, 'function');
  assert.equal(typeof StorageService.saveState, 'function');
  assert.equal(typeof StorageService.mergeTripPayload, 'function');
  assert.equal(typeof StorageService.exportFullBackup, 'function');
  assert.equal(typeof StorageService.restoreFullBackup, 'function');

  const demo = createInitialDemoState();
  assert.equal(demo.version, 1);
  assert.equal(demo.trips.length, 1);
  assert.equal(demo.trips[0].id, 'trip_goa_demo');
});
