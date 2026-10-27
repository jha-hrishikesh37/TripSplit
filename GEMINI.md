# TripSplit Project Rules for AI Agents (Gemini Flash)

## 1. Golden Rules (READ FIRST)
- **ONLY touch the exact files and functions named in the user's prompt.**
- **NEVER reformat, rename, or refactor unrelated code.** Do not remove comments or change CSS unless explicitly asked.
- **All money math MUST use integer paise (`amountPaise`).** Never store or sum floating-point Rupees. Use `rupeesToPaise()` at input boundaries and `formatPaise()` at display boundaries.
- **Preserve soft deletes (tombstones).** Never use `.splice()` or `.filter()` to permanently delete trips, expenses, or settlements from state. Always set `deleted: true` and `updatedAt: Date.now()`.

## 2. Architecture Boundaries
- `js/domain/*`: Pure functions only. **Zero DOM access (`document.*`), zero `localStorage` access, zero `Date.now()` side effects.**
- `js/storage/*`: Persistence, Base64/JSON serialization, and LWW merge only. **Zero DOM access.**
- `js/ui/*` and `js/app.js`: DOM rendering and event listeners. Must call `js/domain/*` for calculations and `js/storage/*` for persistence. Always escape user strings with `escapeHtml()`.

## 3. Data Model Invariants
- Every `expense.splits` array for an active expense MUST satisfy:
  `expense.splits.reduce((sum, s) => sum + s.amountPaise, 0) === expense.amountPaise`
- Across a trip, if all members referenced in active expenses exist in `trip.members`, net balances MUST satisfy:
  `memberStats.reduce((sum, m) => sum + m.expenseNetPaise, 0) === 0`
- Every mutation to a trip, member, expense, or settlement MUST update its `updatedAt` timestamp (`Date.now()`).

## 4. What NEVER to Change Without Explicit Instruction
- Do not change `CONFIG.APP_STORAGE_KEY` (`'tripsplit_v1_state'`) or `CONFIG.SYNC_PREFIX` (`'TRIPSYNC1:'`).
- Do not change existing HTML `id` attributes or `data-*` attributes (event delegation depends on them).
- Do not replace custom modals (`openConfirmModal`) with `window.confirm`, `window.alert`, or `window.prompt`.

## 5. How to Verify Changes (Tiered Testing — Save Time & Tokens)
- **Logic / Storage / Backend changes (`js/domain/*`, `js/storage/*`, `functions/*`):**
  Run ONLY unit tests: `node --test tests/domain.test.mjs`
  Do NOT run Playwright for pure logic or storage changes.
- **UI / DOM / CSS changes (`index.html`, `css/*`, `js/ui/*`, `js/app.js`):**
  Run syntax check first (`node --check <file>`), then run Playwright quietly:
  `npx playwright test --reporter=line --max-failures=1`

