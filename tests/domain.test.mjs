import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../js/config.js';
import { rupeesToPaise, formatPaise, getLocalTodayStr } from '../js/domain/money.js';
import { calculateSplits, calculateItemizedSplits } from '../js/domain/splits.js';
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
import {
  StorageService,
  onSyncStatusChange,
  getSyncStatus,
  syncTripWithCloud,
  pullTripFromCloud,
  scheduleCloudSync,
  saveState,
  loadState
} from '../js/storage/storageAdapter.js';
import { onRequestGet, onRequestPost } from '../functions/api/trips/[id]/sync.js';
import { onRequestPost as onRequestPostReceiptScan } from '../functions/api/receipt/scan.js';

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

test('splits: calculateItemizedSplits 2 items with proportional taxTipPaise', () => {
  const items = [
    { name: 'Pizza', pricePaise: 30000, sharedBy: ['mem_b', 'mem_a'] },
    { name: 'Drink', pricePaise: 10000, sharedBy: ['mem_a'] }
  ];
  const taxTipPaise = 4000;

  const result = calculateItemizedSplits(items, taxTipPaise, ['mem_a', 'mem_b']);
  assert.equal(result.isValid, true);
  assert.equal(result.subtotalPaise, 40000);
  assert.equal(result.totalPaise, 44000);
  assert.equal(result.taxTipPaise, 4000);
  assert.equal(result.allocatedPaise, 44000);
  assert.equal(result.diffPaise, 0);

  const splitA = result.splits.find(s => s.memberId === 'mem_a');
  const splitB = result.splits.find(s => s.memberId === 'mem_b');
  assert.ok(splitA);
  assert.ok(splitB);
  assert.equal(splitA.amountPaise, 27500); // 25000 + 2500
  assert.equal(splitA.metaValue, 25000);
  assert.equal(splitB.amountPaise, 16500); // 15000 + 1500
  assert.equal(splitB.metaValue, 15000);

  const sumSplits = result.splits.reduce((sum, s) => sum + s.amountPaise, 0);
  assert.equal(sumSplits, 44000);

  // Also verify delegation via calculateSplits with ITEMIZED splitType
  const viaDelegate = calculateSplits(44000, 'ITEMIZED', null, {
    items,
    taxTipPaise,
    validMemberIds: ['mem_a', 'mem_b']
  });
  assert.equal(viaDelegate.isValid, true);
  assert.equal(viaDelegate.allocatedPaise, 44000);
  assert.deepEqual(viaDelegate.splits, result.splits);
});

test('splits: calculateItemizedSplits indivisible item and tax deterministic remainder distribution', () => {
  const items = [
    { name: 'Lunch', pricePaise: 10000, sharedBy: ['mem_c', 'mem_a', 'mem_b'] }
  ];
  const taxTipPaise = 100;

  const result = calculateItemizedSplits(items, taxTipPaise);
  assert.equal(result.isValid, true);
  assert.equal(result.subtotalPaise, 10000);
  assert.equal(result.totalPaise, 10100);

  const splitA = result.splits.find(s => s.memberId === 'mem_a');
  const splitB = result.splits.find(s => s.memberId === 'mem_b');
  const splitC = result.splits.find(s => s.memberId === 'mem_c');
  assert.ok(splitA);
  assert.ok(splitB);
  assert.ok(splitC);

  // Item 10000 across 3 members: base 3333, rem 1 -> mem_a gets 3334, mem_b gets 3333, mem_c gets 3333.
  // Tax 100: mem_a floor 33, rem 3400; mem_b floor 33, rem 3300; mem_c floor 33, rem 3300.
  // Remainder tax 1 paisa goes to mem_a.
  assert.equal(splitA.amountPaise, 3368);
  assert.equal(splitB.amountPaise, 3366);
  assert.equal(splitC.amountPaise, 3366);

  const sumSplits = result.splits.reduce((sum, s) => sum + s.amountPaise, 0);
  assert.equal(sumSplits, 10100);
});

test('splits: calculateItemizedSplits validation failure cases', () => {
  // Empty items
  const resEmpty = calculateItemizedSplits([]);
  assert.equal(resEmpty.isValid, false);
  assert.equal(resEmpty.message, 'Add at least one bill item');

  // Negative tax/tip
  const resNegTax = calculateItemizedSplits([{ name: 'Coffee', pricePaise: 500, sharedBy: ['m1'] }], -10);
  assert.equal(resNegTax.isValid, false);
  assert.equal(resNegTax.message, 'Tax/tip cannot be negative');

  // pricePaise: 0
  const resZeroPrice = calculateItemizedSplits([{ name: 'Water', pricePaise: 0, sharedBy: ['m1'] }]);
  assert.equal(resZeroPrice.isValid, false);
  assert.equal(resZeroPrice.message, 'Every item must have a price greater than ₹0');

  // empty sharedBy: []
  const resEmptySharers = calculateItemizedSplits([{ name: 'Salad', pricePaise: 1000, sharedBy: [] }]);
  assert.equal(resEmptySharers.isValid, false);
  assert.equal(resEmptySharers.message, 'Select at least one person for "Salad"');

  // sharedBy filtered out by validMemberIds
  const resFilteredOut = calculateItemizedSplits(
    [{ name: 'Bread', pricePaise: 500, sharedBy: ['m_ghost'] }],
    0,
    ['m_real']
  );
  assert.equal(resFilteredOut.isValid, false);
  assert.equal(resFilteredOut.message, 'Select at least one person for "Bread"');
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

test('storage: mergeTripInMemory preserves items and taxTipPaise on ITEMIZED expense and rounds floats', () => {
  const state = {
    version: 1,
    activeTripId: null,
    activeIdentities: {},
    trips: []
  };

  const payload = {
    type: 'TRIPSPLIT_SYNC_V1',
    trip: {
      id: 'trip_itemized_sync',
      name: 'Itemized Dinner',
      organizerId: 'mem_1',
      members: [
        { id: 'mem_1', name: 'Alice' },
        { id: 'mem_2', name: 'Bob' }
      ],
      expenses: [
        {
          id: 'exp_itemized_1',
          description: 'Dinner with Items',
          splitType: 'ITEMIZED',
          amountPaise: 4400.4,
          taxTipPaise: 400.6,
          paidBy: 'mem_1',
          createdAt: 1000,
          updatedAt: 1000,
          splits: [
            { memberId: 'mem_1', amountPaise: 2750.2 },
            { memberId: 'mem_2', amountPaise: 1650.2 }
          ],
          items: [
            {
              id: 'it_1',
              name: '  Tacos  ',
              pricePaise: 2999.4,
              sharedBy: ['mem_1', 'mem_2']
            },
            {
              id: 'it_2',
              name: 'Drink',
              pricePaise: 1000.2,
              sharedBy: ['mem_1']
            }
          ]
        }
      ],
      settlements: [],
      createdAt: 1000,
      updatedAt: 1000
    }
  };

  mergeTripInMemory(state, payload);
  assert.equal(state.trips.length, 1);
  const trip = state.trips[0];
  assert.equal(trip.expenses.length, 1);
  const exp = trip.expenses[0];

  assert.equal(exp.splitType, 'ITEMIZED');
  assert.equal(exp.amountPaise, 4400);
  assert.equal(exp.taxTipPaise, 401);
  assert.equal(exp.items.length, 2);
  assert.equal(exp.items[0].id, 'it_1');
  assert.equal(exp.items[0].name, 'Tacos');
  assert.equal(exp.items[0].pricePaise, 2999);
  assert.deepEqual(exp.items[0].sharedBy, ['mem_1', 'mem_2']);
  assert.equal(exp.items[1].pricePaise, 1000);
  assert.deepEqual(exp.items[1].sharedBy, ['mem_1']);
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
  assert.equal(typeof StorageService.onSyncStatusChange, 'function');
  assert.equal(typeof StorageService.getSyncStatus, 'function');
  assert.equal(typeof StorageService.syncTripWithCloud, 'function');
  assert.equal(typeof StorageService.pullTripFromCloud, 'function');
  assert.equal(typeof StorageService.scheduleCloudSync, 'function');

  const demo = createInitialDemoState();
  assert.equal(demo.version, 1);
  assert.equal(demo.trips.length, 1);
  assert.equal(demo.trips[0].id, 'trip_goa_demo');
});

test('storage: mergeTripInMemory monotonic revision beats skewed client clock on expense edit', () => {
  const state = {
    version: 1,
    activeTripId: 'trip_skew_test',
    activeIdentities: {},
    trips: [
      {
        id: 'trip_skew_test',
        name: 'Skew Test',
        members: [{ id: 'm1', name: 'Aarav' }],
        expenses: [
          {
            id: 'exp_1',
            title: 'Stale Clock Expense',
            amountPaise: 5000,
            revision: 1,
            updatedAt: 9999,
            deleted: false,
            splits: [{ memberId: 'm1', amountPaise: 5000 }]
          }
        ],
        settlements: [],
        updatedAt: 9999
      }
    ]
  };

  const payload = {
    type: 'TRIPSPLIT_SYNC_V1',
    trip: {
      id: 'trip_skew_test',
      name: 'Skew Test',
      members: [{ id: 'm1', name: 'Aarav' }],
      expenses: [
        {
          id: 'exp_1',
          title: 'Edited Expense Newer Revision',
          amountPaise: 6000,
          revision: 2,
          updatedAt: 1000,
          deleted: false,
          splits: [{ memberId: 'm1', amountPaise: 6000 }]
        }
      ],
      updatedAt: 1000
    }
  };

  const stats = mergeTripInMemory(state, payload);
  assert.equal(stats.updatedExpenses, 1);

  const localTrip = state.trips[0];
  const exp = localTrip.expenses.find(e => e.id === 'exp_1');
  assert.equal(exp.revision, 2);
  assert.equal(exp.title, 'Edited Expense Newer Revision');
  assert.equal(exp.amountPaise, 6000);
  assert.equal(exp.updatedAt, 1000);
});

test('storage: mergeTripInMemory metaUpdatedAt protects group rename from expense-only update with newer updatedAt', () => {
  const state = {
    version: 1,
    activeTripId: 'trip_meta_test',
    activeIdentities: {},
    trips: [
      {
        id: 'trip_meta_test',
        name: 'Renamed Group Name',
        organizerId: 'm1',
        members: [{ id: 'm1', name: 'Aarav' }],
        expenses: [],
        settlements: [],
        metaUpdatedAt: 300,
        updatedAt: 300
      }
    ]
  };

  const payload = {
    type: 'TRIPSPLIT_SYNC_V1',
    trip: {
      id: 'trip_meta_test',
      name: 'Old Group Name',
      organizerId: 'm1',
      members: [{ id: 'm1', name: 'Aarav' }],
      expenses: [
        {
          id: 'exp_new',
          title: 'Snacks',
          amountPaise: 2000,
          revision: 1,
          updatedAt: 500,
          splits: [{ memberId: 'm1', amountPaise: 2000 }]
        }
      ],
      settlements: [],
      metaUpdatedAt: 100,
      updatedAt: 500
    }
  };

  mergeTripInMemory(state, payload);

  const localTrip = state.trips[0];
  // Group name is preserved because local metaUpdatedAt (300) > incoming metaUpdatedAt (100)
  assert.equal(localTrip.name, 'Renamed Group Name');
  assert.equal(localTrip.metaUpdatedAt, 300);
  assert.equal(localTrip.updatedAt, 500);
  assert.equal(localTrip.expenses.length, 1);
  assert.equal(localTrip.expenses[0].id, 'exp_new');
});


function createMockD1Database(initialRows = {}) {
  const store = new Map(Object.entries(initialRows));

  return {
    _store: store,
    prepare(sql) {
      let boundArgs = [];
      const stmt = {
        bind(...args) {
          boundArgs = args;
          return stmt;
        },
        async first() {
          if (sql.includes('SELECT trip_json FROM trips WHERE id = ?1')) {
            const tripId = boundArgs[0];
            const row = store.get(tripId);
            return row ? { trip_json: row.trip_json } : null;
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO trips')) {
            const [
              id,
              name,
              currency,
              organizer_id,
              created_at,
              updated_at,
              meta_updated_at,
              deleted,
              trip_json
            ] = boundArgs;
            store.set(id, {
              id,
              name,
              currency,
              organizer_id,
              created_at,
              updated_at,
              meta_updated_at,
              deleted,
              trip_json
            });
            return { success: true };
          }
          return { success: true };
        }
      };
      return stmt;
    }
  };
}

test('backend sync: onRequestPost inserts new trip and returns ok', async () => {
  const mockDB = createMockD1Database();
  const tripId = 'trip_sync_test_1';
  const initialTrip = {
    id: tripId,
    name: 'Goa Holiday',
    currency: 'INR',
    organizerId: 'mem_1',
    members: [
      { id: 'mem_1', name: 'Alice Smith', updatedAt: 200, revision: 2 },
      { id: 'mem_2', name: 'Bob', updatedAt: 100, revision: 1 }
    ],
    expenses: [
      {
        id: 'exp_1',
        title: 'Hotel',
        amountPaise: 500000,
        payerId: 'mem_1',
        splits: [
          { memberId: 'mem_1', amountPaise: 250000 },
          { memberId: 'mem_2', amountPaise: 250000 }
        ],
        updatedAt: 100,
        revision: 1
      }
    ],
    settlements: [],
    createdAt: 100,
    updatedAt: 200,
    metaUpdatedAt: 200
  };

  const context = {
    params: { id: tripId },
    env: { DB: mockDB },
    request: {
      json: async () => ({ trip: initialTrip })
    }
  };

  const res = await onRequestPost(context);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.trip.id, tripId);
  assert.equal(body.trip.name, 'Goa Holiday');
  assert.equal(body.stats.isNewTrip, true);

  const storedRow = mockDB._store.get(tripId);
  assert.ok(storedRow);
  assert.equal(storedRow.id, tripId);
  assert.equal(storedRow.name, 'Goa Holiday');
  const storedTrip = JSON.parse(storedRow.trip_json);
  assert.equal(storedTrip.id, tripId);
});

test('backend sync: onRequestPost merges second device with new expense and older member name', async () => {
  const mockDB = createMockD1Database();
  const tripId = 'trip_sync_test_2';

  const d1Trip = {
    id: tripId,
    name: 'Goa Holiday',
    currency: 'INR',
    organizerId: 'mem_1',
    members: [
      { id: 'mem_1', name: 'Alice Smith', updatedAt: 200, revision: 2 },
      { id: 'mem_2', name: 'Bob', updatedAt: 100, revision: 1 }
    ],
    expenses: [
      {
        id: 'exp_1',
        title: 'Hotel',
        amountPaise: 500000,
        payerId: 'mem_1',
        splits: [
          { memberId: 'mem_1', amountPaise: 250000 },
          { memberId: 'mem_2', amountPaise: 250000 }
        ],
        updatedAt: 100,
        revision: 1
      }
    ],
    settlements: [],
    createdAt: 100,
    updatedAt: 200,
    metaUpdatedAt: 200
  };
  mockDB._store.set(tripId, {
    id: tripId,
    name: d1Trip.name,
    currency: d1Trip.currency,
    organizer_id: d1Trip.organizerId,
    created_at: d1Trip.createdAt,
    updated_at: d1Trip.updatedAt,
    meta_updated_at: d1Trip.metaUpdatedAt,
    deleted: 0,
    trip_json: JSON.stringify(d1Trip)
  });

  const device2Trip = {
    id: tripId,
    name: 'Goa Holiday',
    currency: 'INR',
    organizerId: 'mem_1',
    members: [
      { id: 'mem_1', name: 'Alice', updatedAt: 100, revision: 1 },
      { id: 'mem_2', name: 'Bob', updatedAt: 100, revision: 1 }
    ],
    expenses: [
      d1Trip.expenses[0],
      {
        id: 'exp_2',
        title: 'Seafood Dinner',
        amountPaise: 200000,
        payerId: 'mem_2',
        splits: [
          { memberId: 'mem_1', amountPaise: 100000 },
          { memberId: 'mem_2', amountPaise: 100000 }
        ],
        updatedAt: 300,
        revision: 1
      }
    ],
    settlements: [],
    createdAt: 100,
    updatedAt: 300,
    metaUpdatedAt: 100
  };

  const context = {
    params: { id: tripId },
    env: { DB: mockDB },
    request: {
      json: async () => ({ app: 'TripSplit', version: 1, trip: device2Trip })
    }
  };

  const res = await onRequestPost(context);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.stats.isNewTrip, false);
  assert.equal(body.stats.addedExpenses, 1);

  const member1 = body.trip.members.find(m => m.id === 'mem_1');
  assert.equal(member1.name, 'Alice Smith');

  assert.equal(body.trip.expenses.length, 2);
  assert.ok(body.trip.expenses.some(e => e.id === 'exp_1'));
  assert.ok(body.trip.expenses.some(e => e.id === 'exp_2'));

  const stored = JSON.parse(mockDB._store.get(tripId).trip_json);
  assert.equal(stored.members.find(m => m.id === 'mem_1').name, 'Alice Smith');
  assert.equal(stored.expenses.length, 2);
});

test('backend sync: onRequestGet returns merged trip from mock D1', async () => {
  const mockDB = createMockD1Database();
  const tripId = 'trip_sync_test_3';

  const tripData = {
    id: tripId,
    name: 'Mountain Trek',
    currency: 'INR',
    organizerId: 'mem_1',
    members: [
      { id: 'mem_1', name: 'Alice Smith', updatedAt: 200, revision: 2 },
      { id: 'mem_2', name: 'Bob', updatedAt: 100, revision: 1 }
    ],
    expenses: [
      {
        id: 'exp_1',
        title: 'Gear Rental',
        amountPaise: 400000,
        payerId: 'mem_1',
        splits: [
          { memberId: 'mem_1', amountPaise: 200000 },
          { memberId: 'mem_2', amountPaise: 200000 }
        ],
        updatedAt: 100,
        revision: 1
      },
      {
        id: 'exp_2',
        title: 'Camp Permit',
        amountPaise: 150000,
        payerId: 'mem_2',
        splits: [
          { memberId: 'mem_1', amountPaise: 75000 },
          { memberId: 'mem_2', amountPaise: 75000 }
        ],
        updatedAt: 300,
        revision: 1
      }
    ],
    settlements: [],
    createdAt: 100,
    updatedAt: 300,
    metaUpdatedAt: 200
  };

  mockDB._store.set(tripId, {
    id: tripId,
    name: tripData.name,
    currency: tripData.currency,
    organizer_id: tripData.organizerId,
    created_at: tripData.createdAt,
    updated_at: tripData.updatedAt,
    meta_updated_at: tripData.metaUpdatedAt,
    deleted: 0,
    trip_json: JSON.stringify(tripData)
  });

  const context = {
    params: { id: tripId },
    env: { DB: mockDB }
  };

  const res = await onRequestGet(context);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.trip.id, tripId);
  assert.equal(body.trip.name, 'Mountain Trek');
  assert.equal(body.trip.members.find(m => m.id === 'mem_1').name, 'Alice Smith');
  assert.equal(body.trip.expenses.length, 2);
  assert.ok(body.trip.expenses.some(e => e.id === 'exp_2'));
});

test('backend sync: error cases for onRequestGet and onRequestPost', async () => {
  const mockDB = createMockD1Database();

  // 1. Missing DB binding on GET
  const resNoDbGet = await onRequestGet({ params: { id: 't1' }, env: {} });
  assert.equal(resNoDbGet.status, 503);
  const bodyNoDbGet = await resNoDbGet.json();
  assert.equal(bodyNoDbGet.ok, false);
  assert.equal(bodyNoDbGet.error, 'Database binding DB is not configured');

  // 2. Missing DB binding on POST
  const resNoDbPost = await onRequestPost({ params: { id: 't1' }, env: {}, request: { json: async () => ({}) } });
  assert.equal(resNoDbPost.status, 503);
  const bodyNoDbPost = await resNoDbPost.json();
  assert.equal(bodyNoDbPost.ok, false);
  assert.equal(bodyNoDbPost.error, 'Database binding DB is not configured');

  // 3. Not found on GET
  const resNotFound = await onRequestGet({ params: { id: 'unknown_trip' }, env: { DB: mockDB } });
  assert.equal(resNotFound.status, 404);
  const bodyNotFound = await resNotFound.json();
  assert.equal(bodyNotFound.ok, false);
  assert.equal(bodyNotFound.error, 'Trip not found in cloud');

  // 4. Trip ID mismatch on POST
  const resMismatch = await onRequestPost({
    params: { id: 'trip_a' },
    env: { DB: mockDB },
    request: { json: async () => ({ trip: { id: 'trip_b' } }) }
  });
  assert.equal(resMismatch.status, 400);
  const bodyMismatch = await resMismatch.json();
  assert.equal(bodyMismatch.ok, false);
  assert.equal(bodyMismatch.error, 'Trip ID mismatch or invalid payload');
});

test('backend sync: auto-initializes trips schema when table is missing and recovers', async () => {
  let execCalled = false;
  let tableCreated = false;
  const store = new Map();

  const mockDbWithRecovery = {
    exec: async (sql) => {
      execCalled = true;
      tableCreated = true;
    },
    prepare: (sql) => {
      let bound = [];
      const stmt = {
        bind: (...args) => {
          bound = args;
          return stmt;
        },
        first: async () => {
          if (!tableCreated) {
            throw new Error('D1_ERROR: no such table: trips: SQLITE_ERROR');
          }
          return null;
        },
        run: async () => {
          if (!tableCreated) {
            throw new Error('D1_ERROR: no such table: trips: SQLITE_ERROR');
          }
          store.set(bound[0], { trip_json: bound[8] });
          return { success: true };
        }
      };
      return stmt;
    }
  };

  const tripId = 'trip_recover_test';
  const tripPayload = {
    id: tripId,
    name: 'Auto Init Trip',
    members: [{ id: 'm1', name: 'User' }],
    expenses: [],
    settlements: [],
    createdAt: 1000,
    updatedAt: 1000
  };

  // Calling onRequestPost on an uninitialized DB will auto-run ensureSchema and recover
  const res = await onRequestPost({
    params: { id: tripId },
    env: { DB: mockDbWithRecovery },
    request: { json: async () => ({ app: 'TripSplit', version: 1, trip: tripPayload }) }
  });

  assert.equal(res.status, 200);
  assert.equal(execCalled, true);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.trip.id, tripId);
});

test('storage: onSyncStatusChange and getSyncStatus manage listeners and status state', () => {
  const events = [];
  const unsubscribe = onSyncStatusChange(evt => {
    events.push(evt);
  });

  const initialStatus = getSyncStatus();
  assert.ok(['idle', 'synced', 'syncing', 'offline', 'error'].includes(initialStatus.status));

  unsubscribe();
  const countBefore = events.length;
  assert.equal(events.length, countBefore);
});

test('storage: syncTripWithCloud handles missing trip and offline status', async () => {
  // 1. Missing active trip
  const resNoTrip = await syncTripWithCloud({ activeTripId: 'none', trips: [] });
  assert.equal(resNoTrip.ok, false);
  assert.equal(resNoTrip.error, 'No active trip');

  // 2. Offline navigator
  const origOnLine = globalThis.navigator?.onLine;
  try {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true, writable: true });
    const trip = { id: 'trip_offline', name: 'Offline Trip', members: [{ id: 'm1', name: 'Aarav' }] };
    const state = { activeTripId: 'trip_offline', trips: [trip] };

    const statusEvents = [];
    const unsub = onSyncStatusChange(e => statusEvents.push(e));
    const resOffline = await syncTripWithCloud(state, 'trip_offline');
    unsub();

    assert.equal(resOffline.ok, false);
    assert.equal(resOffline.offline, true);
    assert.ok(statusEvents.some(e => e.status === 'offline'));
  } finally {
    if (origOnLine !== undefined) {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: origOnLine, configurable: true, writable: true });
    } else {
      delete globalThis.navigator.onLine;
    }
  }
});

test('storage: syncTripWithCloud successfully syncs, merges and persists to localStorage', async () => {
  const tripId = 'trip_cloud_test_1';
  const localTrip = {
    id: tripId,
    name: 'Goa Holiday',
    members: [
      { id: 'm1', name: 'Aarav', updatedAt: 100, revision: 1 },
      { id: 'm2', name: 'Priya', updatedAt: 100, revision: 1 }
    ],
    expenses: [
      {
        id: 'exp_1',
        title: 'Cab',
        amountPaise: 200000,
        splits: [{ memberId: 'm1', amountPaise: 100000 }, { memberId: 'm2', amountPaise: 100000 }],
        updatedAt: 100,
        revision: 1
      }
    ],
    settlements: [],
    updatedAt: 100
  };

  const state = {
    version: 1,
    activeTripId: tripId,
    trips: [localTrip]
  };

  const origFetch = globalThis.fetch;
  const origLocalStorage = globalThis.localStorage;
  let savedStorage = null;

  try {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: (key, val) => { savedStorage = { key, val }; }
    };

    let postBody = null;
    let postUrl = null;

    globalThis.fetch = async (url, opts) => {
      postUrl = url;
      postBody = JSON.parse(opts.body);
      const incomingTrip = postBody.trip;
      const remoteTrip = {
        ...incomingTrip,
        expenses: [
          ...incomingTrip.expenses,
          {
            id: 'exp_2',
            title: 'Dinner',
            amountPaise: 300000,
            splits: [{ memberId: 'm1', amountPaise: 150000 }, { memberId: 'm2', amountPaise: 150000 }],
            updatedAt: 200,
            revision: 1
          }
        ],
        updatedAt: 200
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          trip: remoteTrip,
          stats: { tripId, isNewTrip: false, addedExpenses: 1, updatedExpenses: 0 }
        })
      };
    };

    const statusEvents = [];
    const unsub = onSyncStatusChange(e => statusEvents.push(e));
    const result = await syncTripWithCloud(state, tripId);
    unsub();

    assert.equal(result.ok, true);
    assert.equal(postUrl, `/api/trips/${encodeURIComponent(tripId)}/sync`);
    assert.equal(postBody.type, 'TRIPSPLIT_SYNC_V1');
    assert.equal(postBody.trip.id, tripId);
    assert.ok(result.stats);
    assert.equal(result.trip.id, tripId);
    assert.equal(result.trip.expenses.length, 2);

    // Verify localStorage was written directly
    assert.ok(savedStorage);
    assert.equal(savedStorage.key, CONFIG.APP_STORAGE_KEY);
    const parsedState = JSON.parse(savedStorage.val);
    assert.equal(parsedState.trips[0].expenses.length, 2);

    // Verify sync events: syncing followed by synced
    assert.ok(statusEvents.some(e => e.status === 'syncing' && e.tripId === tripId));
    assert.ok(statusEvents.some(e => e.status === 'synced' && e.tripId === tripId && e.lastSyncedAt > 0));
    assert.equal(getSyncStatus().status, 'synced');
  } finally {
    globalThis.fetch = origFetch;
    globalThis.localStorage = origLocalStorage;
  }
});

test('storage: syncTripWithCloud handles server error and network error gracefully', async () => {
  const tripId = 'trip_err_test';
  const state = {
    activeTripId: tripId,
    trips: [{ id: tripId, name: 'Error Test', members: [{ id: 'm1', name: 'Alice' }] }]
  };

  const origFetch = globalThis.fetch;
  try {
    // 1. Non-200 HTTP response
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ ok: false, error: 'Database crashed' })
    });

    const res500 = await syncTripWithCloud(state, tripId);
    assert.equal(res500.ok, false);
    assert.ok(res500.error.includes('Database crashed') || res500.error.includes('500'));
    assert.equal(getSyncStatus().status, 'error');

    // 2. Fetch throws network failure (e.g. connection refused)
    globalThis.fetch = async () => {
      throw new Error('Connection refused');
    };

    const resNetwork = await syncTripWithCloud(state, tripId);
    assert.equal(resNetwork.ok, false);
    assert.equal(resNetwork.error, 'Connection refused');
    assert.equal(getSyncStatus().status, 'error');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('storage: pullTripFromCloud merges remote data and handles missing/error responses', async () => {
  const tripId = 'trip_pull_test';
  const state = {
    activeTripId: tripId,
    trips: [{ id: tripId, name: 'Local Version', members: [{ id: 'm1', name: 'Alice', updatedAt: 100, revision: 1 }] }]
  };

  const origFetch = globalThis.fetch;
  const origLocalStorage = globalThis.localStorage;
  let savedStorage = null;

  try {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: (key, val) => { savedStorage = { key, val }; }
    };

    // 1. Successful 200 pull
    globalThis.fetch = async (url) => {
      assert.equal(url, `/api/trips/${encodeURIComponent(tripId)}/sync`);
      return {
        status: 200,
        ok: true,
        json: async () => ({
          ok: true,
          trip: {
            id: tripId,
            name: 'Cloud Version',
            members: [{ id: 'm1', name: 'Alice Cooper', updatedAt: 200, revision: 2 }],
            expenses: [],
            settlements: [],
            updatedAt: 200,
            metaUpdatedAt: 200
          }
        })
      };
    };

    const pullRes = await pullTripFromCloud(state, tripId);
    assert.equal(pullRes.ok, true);
    assert.equal(pullRes.trip.name, 'Cloud Version');
    assert.equal(pullRes.trip.members[0].name, 'Alice Cooper');
    assert.ok(savedStorage);

    // 2. 404 response
    globalThis.fetch = async () => ({
      status: 404,
      ok: false,
      json: async () => ({ ok: false, error: 'Trip not found' })
    });

    const pull404 = await pullTripFromCloud(state, 'nonexistent_trip');
    assert.equal(pull404.ok, false);
    assert.equal(pull404.status, 404);

    // 3. Network rejection handled without throwing
    globalThis.fetch = async () => {
      throw new Error('Network timeout');
    };
    const pullFail = await pullTripFromCloud(state, tripId);
    assert.equal(pullFail.ok, false);
    assert.equal(pullFail.status, 0);
  } finally {
    globalThis.fetch = origFetch;
    globalThis.localStorage = origLocalStorage;
  }
});

test('storage: scheduleCloudSync and saveState debouncing and skipCloud option', async () => {
  const origWindow = globalThis.window;
  const origSync = StorageService.syncTripWithCloud;

  let syncCalls = [];
  StorageService.syncTripWithCloud = async (st, id) => {
    syncCalls.push({ st, id });
    return { ok: true };
  };

  try {
    // In Node (no window), scheduleCloudSync is a no-op
    const state = { activeTripId: 'trip_deb_1', trips: [{ id: 'trip_deb_1' }] };
    scheduleCloudSync(state, 'trip_deb_1', 10);
    assert.equal(syncCalls.length, 0);

    // With window defined, schedules with debounce
    globalThis.window = {};
    scheduleCloudSync(state, 'trip_deb_1', 30);
    scheduleCloudSync(state, 'trip_deb_1', 30); // reset debounce timer
    assert.equal(syncCalls.length, 0);

    await new Promise(r => setTimeout(r, 60));
    assert.equal(syncCalls.length, 1);
    assert.equal(syncCalls[0].id, 'trip_deb_1');

    // saveState with skipCloud: true doesn't trigger sync
    syncCalls = [];
    saveState(state, { skipCloud: true });
    await new Promise(r => setTimeout(r, 60));
    assert.equal(syncCalls.length, 0);
  } finally {
    globalThis.window = origWindow;
    StorageService.syncTripWithCloud = origSync;
  }
});

test('storage: pullTripFromCloud switches activeTripId to pulled trip and background sync preserves user active trip', async () => {
  const origFetch = globalThis.fetch;
  const origLocalStorage = globalThis.localStorage;

  try {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {}
    };

    const state = {
      activeTripId: 'default_trip',
      trips: [
        { id: 'default_trip', name: 'Default Trip', members: [{ id: 'm0', name: 'Owner' }] },
        { id: 'existing_trip', name: 'Existing Trip', members: [{ id: 'm1', name: 'Alice' }] }
      ]
    };

    // 1. pullTripFromCloud for an invited trip switches activeTripId
    const invitedTripId = 'invited_trip_123';
    globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        ok: true,
        trip: {
          id: invitedTripId,
          name: 'Invited Trip',
          members: [{ id: 'm2', name: 'Bob' }],
          expenses: [],
          settlements: []
        }
      })
    });

    const pullRes = await StorageService.pullTripFromCloud(state, invitedTripId);
    assert.equal(pullRes.ok, true);
    assert.equal(state.activeTripId, invitedTripId);

    // 2. background sync of another trip does NOT overwrite state.activeTripId
    globalThis.fetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        ok: true,
        trip: {
          id: 'existing_trip',
          name: 'Existing Trip Synced',
          members: [{ id: 'm1', name: 'Alice' }],
          expenses: [],
          settlements: []
        }
      })
    });

    const syncRes = await StorageService.syncTripWithCloud(state, 'existing_trip');
    assert.equal(syncRes.ok, true);
    // User was on invitedTripId, so background sync of existing_trip must preserve invitedTripId!
    assert.equal(state.activeTripId, invitedTripId);
  } finally {
    globalThis.fetch = origFetch;
    globalThis.localStorage = origLocalStorage;
  }
});

test('receipt scan backend: missing GEMINI_API_KEY returns status 503', async () => {
  const context = {
    env: {},
    request: {
      json: async () => ({ imageBase64: 'dGVzdA==' })
    }
  };
  const res = await onRequestPostReceiptScan(context);
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'Receipt scanning is not configured on this server (missing GEMINI_API_KEY).');
});

test('receipt scan backend: empty or missing imageBase64 returns status 400', async () => {
  const resMissing = await onRequestPostReceiptScan({
    env: { GEMINI_API_KEY: 'mock-key' },
    request: { json: async () => ({}) }
  });
  assert.equal(resMissing.status, 400);
  const dataMissing = await resMissing.json();
  assert.equal(dataMissing.ok, false);
  assert.equal(dataMissing.error, 'Invalid receipt image payload');

  const resEmpty = await onRequestPostReceiptScan({
    env: { GEMINI_API_KEY: 'mock-key' },
    request: { json: async () => ({ imageBase64: '   ' }) }
  });
  assert.equal(resEmpty.status, 400);
  const dataEmpty = await resEmpty.json();
  assert.equal(dataEmpty.ok, false);
  assert.equal(dataEmpty.error, 'Invalid receipt image payload');

  const resInvalidType = await onRequestPostReceiptScan({
    env: { GEMINI_API_KEY: 'mock-key' },
    request: { json: async () => ({ imageBase64: 12345 }) }
  });
  assert.equal(resInvalidType.status, 400);
  const dataInvalidType = await resInvalidType.json();
  assert.equal(dataInvalidType.ok, false);
  assert.equal(dataInvalidType.error, 'Invalid receipt image payload');

  const resBadJson = await onRequestPostReceiptScan({
    env: { GEMINI_API_KEY: 'mock-key' },
    request: { json: async () => { throw new Error('Bad JSON'); } }
  });
  assert.equal(resBadJson.status, 400);
  const dataBadJson = await resBadJson.json();
  assert.equal(dataBadJson.ok, false);
  assert.equal(dataBadJson.error, 'Invalid receipt image payload');
});

test('backend sync: onRequestPost updates deleted column to 1 when a trip is deleted', async () => {
  const mockDB = createMockD1Database();
  const tripId = 'trip_del_sync_test';

  const activeTrip = {
    id: tripId,
    name: 'Goa Trip',
    currency: 'INR',
    organizerId: 'mem_1',
    members: [{ id: 'mem_1', name: 'Alice', updatedAt: 100, revision: 1 }],
    expenses: [],
    settlements: [],
    createdAt: 100,
    updatedAt: 100,
    metaUpdatedAt: 100,
    deleted: false
  };

  mockDB._store.set(tripId, {
    id: tripId,
    name: activeTrip.name,
    currency: activeTrip.currency,
    organizer_id: activeTrip.organizerId,
    created_at: activeTrip.createdAt,
    updated_at: activeTrip.updatedAt,
    meta_updated_at: activeTrip.metaUpdatedAt,
    deleted: 0,
    trip_json: JSON.stringify(activeTrip)
  });

  const deletedTrip = {
    ...activeTrip,
    deleted: true,
    updatedAt: 200,
    metaUpdatedAt: 200
  };

  const context = {
    params: { id: tripId },
    env: { DB: mockDB },
    request: {
      json: async () => ({ trip: deletedTrip })
    }
  };

  const res = await onRequestPost(context);
  assert.equal(res.status, 200);

  const storedRow = mockDB._store.get(tripId);
  assert.ok(storedRow);
  assert.equal(storedRow.deleted, 1);
  const storedJson = JSON.parse(storedRow.trip_json);
  assert.equal(storedJson.deleted, true);
});
