/**
 * Idempotent Last-Write-Wins (LWW) Merge for a Trip in-memory.
 * Pure function: operates directly on state object without localStorage side-effects.
 */
export function mergeTripInMemory(state, payload) {
  if (!payload || payload.type !== 'TRIPSPLIT_SYNC_V1' || !payload.trip || !payload.trip.id) {
    throw new Error('Invalid TripSplit sync code or file.');
  }

  const incomingTrip = payload.trip;
  if (!Array.isArray(incomingTrip.members) || incomingTrip.members.length === 0) {
    throw new Error('Sync payload is missing valid group members.');
  }
  incomingTrip.expenses = (Array.isArray(incomingTrip.expenses) ? incomingTrip.expenses : []).filter(exp =>
    exp && typeof exp.id === 'string' &&
    Number.isFinite(Number(exp.amountPaise)) && Number(exp.amountPaise) > 0 &&
    Array.isArray(exp.splits)
  ).map(exp => ({
    ...exp,
    amountPaise: Math.round(Number(exp.amountPaise)),
    splits: exp.splits.map(s => ({
      ...s,
      amountPaise: Math.round(Number(s.amountPaise || 0))
    }))
  }));
  const localTripIndex = state.trips.findIndex(t => t.id === incomingTrip.id);

  let stats = {
    tripId: incomingTrip.id,
    tripName: incomingTrip.name,
    isNewTrip: false,
    addedExpenses: 0,
    updatedExpenses: 0
  };

  if (!state.activeIdentities) {
    state.activeIdentities = {};
  }

  if (localTripIndex === -1) {
    // Brand new trip being imported onto this phone
    state.trips.push({
      id: incomingTrip.id,
      name: incomingTrip.name,
      organizerId: incomingTrip.organizerId,
      members: incomingTrip.members || [],
      expenses: incomingTrip.expenses || [],
      settlements: incomingTrip.settlements || [],
      createdAt: incomingTrip.createdAt || Date.now(),
      updatedAt: incomingTrip.updatedAt || Date.now(),
      deleted: Boolean(incomingTrip.deleted)
    });
    state.activeTripId = incomingTrip.id;
    if (!state.activeIdentities[incomingTrip.id] && incomingTrip.members?.length) {
      state.activeIdentities[incomingTrip.id] = incomingTrip.members[0].id;
    }
    stats.isNewTrip = true;
    stats.addedExpenses = (incomingTrip.expenses || []).filter(e => !e.deleted).length;
    return stats;
  }

  // Merge with existing local trip using Last-Write-Wins on updatedAt
  const localTrip = state.trips[localTripIndex];

  if ((incomingTrip.updatedAt || 0) > (localTrip.updatedAt || 0)) {
    localTrip.name = incomingTrip.name;
    localTrip.organizerId = incomingTrip.organizerId;
    localTrip.deleted = Boolean(incomingTrip.deleted);
    localTrip.updatedAt = incomingTrip.updatedAt;
  }

  // Merge members by ID (preserve union of members, newest name wins)
  const memberMap = new Map();
  (localTrip.members || []).forEach(m => memberMap.set(m.id, { ...m }));
  (incomingTrip.members || []).forEach(m => {
    if (!memberMap.has(m.id)) {
      memberMap.set(m.id, { ...m });
    } else {
      const localMem = memberMap.get(m.id);
      const incTime = m.updatedAt || 0;
      const locTime = localMem.updatedAt || 0;
      if (
        incTime > locTime ||
        (incTime === locTime && localMem.name === 'Me (Organizer)' && m.name !== 'Me (Organizer)')
      ) {
        memberMap.set(m.id, { ...localMem, ...m });
      }
    }
  });
  localTrip.members = Array.from(memberMap.values());

  // Merge expenses (LWW by expense.id and expense.updatedAt, including soft deletes)
  const expenseMap = new Map();
  (localTrip.expenses || []).forEach(e => expenseMap.set(e.id, e));

  (incomingTrip.expenses || []).forEach(incExp => {
    const existing = expenseMap.get(incExp.id);
    if (!existing) {
      expenseMap.set(incExp.id, incExp);
      if (!incExp.deleted) stats.addedExpenses++;
    } else if ((incExp.updatedAt || 0) > (existing.updatedAt || 0)) {
      expenseMap.set(incExp.id, incExp);
      stats.updatedExpenses++;
    }
  });
  localTrip.expenses = Array.from(expenseMap.values());

  // Merge settlement records (LWW by settlement.id and settlement.updatedAt)
  const settlementMap = new Map();
  (localTrip.settlements || []).forEach(s => settlementMap.set(s.id, s));
  (incomingTrip.settlements || []).forEach(incSet => {
    const existing = settlementMap.get(incSet.id);
    if (!existing || (incSet.updatedAt || 0) > (existing.updatedAt || 0)) {
      settlementMap.set(incSet.id, incSet);
    }
  });
  localTrip.settlements = Array.from(settlementMap.values());

  state.activeTripId = localTrip.id;
  stats.tripName = localTrip.name;
  return stats;
}
