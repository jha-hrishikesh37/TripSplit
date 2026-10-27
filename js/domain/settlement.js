/**
 * Compute net balances and minimum cash-flow settlement plan.
 */
export function computeTripSettlement(trip) {
  const members = trip?.members || [];
  const activeExpenses = (trip?.expenses || []).filter(e => !e.deleted);

  const statsByMember = {};
  members.forEach(m => {
    statsByMember[m.id] = {
      memberId: m.id,
      name: m.name,
      paidPaise: 0,
      sharePaise: 0,
      expenseNetPaise: 0 // Pure net from expenses before settle-up payments
    };
  });

  let totalTripPaise = 0;

  activeExpenses.forEach(exp => {
    totalTripPaise += exp.amountPaise;
    if (statsByMember[exp.paidBy]) {
      statsByMember[exp.paidBy].paidPaise += exp.amountPaise;
    }
    (exp.splits || []).forEach(s => {
      if (statsByMember[s.memberId]) {
        statsByMember[s.memberId].sharePaise += s.amountPaise;
      }
    });
  });

  Object.values(statsByMember).forEach(st => {
    st.expenseNetPaise = st.paidPaise - st.sharePaise;
  });

  // Greedy Min-Cash-Flow Algorithm on expenseNetPaise
  const debtors = [];
  const creditors = [];

  Object.values(statsByMember).forEach(st => {
    if (st.expenseNetPaise < 0) {
      debtors.push({ memberId: st.memberId, amount: -st.expenseNetPaise });
    } else if (st.expenseNetPaise > 0) {
      creditors.push({ memberId: st.memberId, amount: st.expenseNetPaise });
    }
  });

  // Sort descending for deterministic minimal transfers
  debtors.sort((a, b) => b.amount - a.amount || a.memberId.localeCompare(b.memberId));
  creditors.sort((a, b) => b.amount - a.amount || a.memberId.localeCompare(b.memberId));

  const transactions = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];
    const transferPaise = Math.min(debtor.amount, creditor.amount);

    if (transferPaise > 0) {
      const settlementKey = `set_${debtor.memberId}_${creditor.memberId}`;
      const savedRecord = (trip?.settlements || []).find(
        s => s.id === settlementKey && !s.deleted
      );
      const amountMatches = !savedRecord?.amountPaise || savedRecord.amountPaise === transferPaise;
      const isSettled = Boolean(savedRecord && savedRecord.settled && amountMatches);
      const isStaleAmount = Boolean(savedRecord && savedRecord.settled && !amountMatches);

      transactions.push({
        id: settlementKey,
        fromId: debtor.memberId,
        toId: creditor.memberId,
        amountPaise: transferPaise,
        settled: isSettled,
        isStaleAmount,
        settledAt: savedRecord?.updatedAt || null
      });
    }

    debtor.amount -= transferPaise;
    creditor.amount -= transferPaise;

    if (debtor.amount === 0) dIdx++;
    if (creditor.amount === 0) cIdx++;
  }

  // Calculate remaining unsettled balance per member
  Object.values(statsByMember).forEach(st => {
    st.remainingNetPaise = st.expenseNetPaise;
  });

  transactions.forEach(tx => {
    if (tx.settled) {
      if (statsByMember[tx.fromId]) statsByMember[tx.fromId].remainingNetPaise += tx.amountPaise;
      if (statsByMember[tx.toId]) statsByMember[tx.toId].remainingNetPaise -= tx.amountPaise;
    }
  });

  return {
    totalTripPaise,
    memberStats: Object.values(statsByMember),
    transactions
  };
}
