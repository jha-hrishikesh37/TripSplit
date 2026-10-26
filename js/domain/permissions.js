/**
 * Check if a member has permission to edit or delete an expense.
 * Organizer can edit/delete any expense; regular members can edit/delete only their own.
 */
export function canModifyExpense(trip, expense, activeMemberId) {
  if (!trip || !expense || !activeMemberId) return false;
  if (trip.organizerId === activeMemberId) return true;
  return expense.createdBy === activeMemberId;
}

/**
 * Check if a member can be safely removed from a trip.
 * Returns false if any non-deleted expense in trip.expenses has paidBy === memberId
 * or a split with s.memberId === memberId, and true otherwise.
 */
export function canRemoveMember(trip, memberId) {
  const expenses = trip?.expenses || [];
  const hasExpenses = expenses.some(e =>
    !e.deleted && (e.paidBy === memberId || (e.splits || []).some(s => s.memberId === memberId))
  );
  return !hasExpenses;
}
