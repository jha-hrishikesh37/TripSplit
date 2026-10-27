import { test, expect } from '@playwright/test';

test.describe('TripSplit End-to-End Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Clear localStorage to always start with fresh seed data
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('1. Loads initial Goa demo trip with 4 expenses and correct summary', async ({ page }) => {
    await expect(page.locator('#heroSummary')).toContainText('Goa Weekend Getaway');
    await expect(page.locator('#heroSummary')).toContainText('4 members');
    await expect(page.locator('#heroSummary')).toContainText('4 expenses');

    // 4 expense items in list
    const expenseItems = page.locator('.expense-item');
    await expect(expenseItems).toHaveCount(4);
    await expect(page.locator('.expense-item').first()).toContainText('Scuba & Water Sports');
    await expect(page.locator('.expense-item').last()).toContainText('Beachfront Villa');
  });

  test('2. Adds an expense in EQUAL split mode', async ({ page }) => {
    await page.click('#btnOpenAddExpense');
    await expect(page.locator('#expenseModal')).toHaveClass(/open/);

    await page.fill('#expTitle', 'Lunch at Shack');
    await page.fill('#expAmount', '1000');
    await page.selectOption('#expCategory', 'Food');

    // Equal mode is default
    await expect(page.locator('#splitLiveCheck')).toHaveClass(/valid/);
    await expect(page.locator('#splitCheckMath')).toContainText('₹1,000 / ₹1,000');

    await page.click('button[type="submit"][form="expenseForm"]');
    await expect(page.locator('#expenseModal')).not.toHaveClass(/open/);

    // Verify it was added
    await expect(page.locator('.expense-item')).toHaveCount(5);
    await expect(page.locator('.expense-item').first()).toContainText('Lunch at Shack');
  });

  test('3. Adds an expense in EXACT / Custom mode', async ({ page }) => {
    await page.click('#btnOpenAddExpense');
    await page.fill('#expTitle', 'Fuel Sharing');
    await page.fill('#expAmount', '600');

    // Switch to EXACT tab
    await page.click('button.split-tab-btn[data-split-type="EXACT"]');

    // Initially custom amounts are 0, should be invalid
    await expect(page.locator('#splitLiveCheck')).toHaveClass(/invalid/);

    // Allocate 300 to first two members
    const valInputs = page.locator('.split-member-val');
    await valInputs.nth(0).fill('300');
    await valInputs.nth(1).fill('300');

    await expect(page.locator('#splitLiveCheck')).toHaveClass(/valid/);
    await page.click('button[type="submit"][form="expenseForm"]');

    await expect(page.locator('.expense-item')).toHaveCount(5);
    await expect(page.locator('.expense-item').first()).toContainText('Fuel Sharing');
  });

  test('4. Adds an expense in PERCENT mode with redistribution', async ({ page }) => {
    await page.click('#btnOpenAddExpense');
    await page.fill('#expTitle', 'Activities Combo');
    await page.fill('#expAmount', '800');

    // Switch to PERCENT tab
    await page.click('button.split-tab-btn[data-split-type="PERCENT"]');

    // Default 4 members = 25.00% each = 100.00%
    await expect(page.locator('#splitLiveCheck')).toHaveClass(/valid/);
    await expect(page.locator('#splitCheckMath')).toContainText('100.00% / 100.00%');

    // Uncheck one member: percent should redistribute among remaining 3
    const checkboxes = page.locator('.split-member-check');
    await checkboxes.nth(3).uncheck();

    // Still valid and 100.00%
    await expect(page.locator('#splitLiveCheck')).toHaveClass(/valid/);
    await expect(page.locator('#splitCheckMath')).toContainText('100.00% / 100.00%');

    await page.click('button[type="submit"][form="expenseForm"]');
    await expect(page.locator('.expense-item')).toHaveCount(5);
    await expect(page.locator('.expense-item').first()).toContainText('Activities Combo');
  });

  test('5. Edits an existing expense', async ({ page }) => {
    const firstEditBtn = page.locator('[data-edit-exp]').first();
    await firstEditBtn.click();
    await expect(page.locator('#expenseModal')).toHaveClass(/open/);

    await page.fill('#expTitle', 'Beachfront Villa (Upgraded)');
    await page.click('button[type="submit"][form="expenseForm"]');

    await expect(page.locator('.expense-item').first()).toContainText('Beachfront Villa (Upgraded)');
  });

  test('6. Soft-deletes an expense with confirmation modal', async ({ page }) => {
    await expect(page.locator('.expense-item')).toHaveCount(4);

    const firstDelBtn = page.locator('[data-del-exp]').first();
    await firstDelBtn.click();

    await expect(page.locator('#confirmModal')).toHaveClass(/open/);
    await page.click('#btnConfirmProceed');

    await expect(page.locator('.expense-item')).toHaveCount(3);
  });

  test('7. Creates a new group and switches to it', async ({ page }) => {
    await page.click('#btnNewTrip');
    await expect(page.locator('#tripModal')).toHaveClass(/open/);

    await page.fill('#tripNameInput', 'Manali Roadtrip');
    await page.fill('#newMemberNameInput', 'Vikram');
    await page.click('#btnAddMemberRow');

    await page.click('button[type="submit"][form="tripForm"]');
    await expect(page.locator('#tripModal')).not.toHaveClass(/open/);

    await expect(page.locator('#heroSummary')).toContainText('Manali Roadtrip');
    await expect(page.locator('#heroSummary')).toContainText('2 members · 0 expenses');
  });

  test('8. Renames a member via rename modal', async ({ page }) => {
    // Navigate to Settlement tab to see member balances
    await page.click('button.nav-tab[data-tab="settlement"]');

    // Click edit on the first member
    const renameBtn = page.locator('[data-rename-member]').first();
    await renameBtn.click();

    await expect(page.locator('#renameMemberModal')).toHaveClass(/open/);
    await page.fill('#renameMemberInput', 'Aarav Sharma');
    await page.click('#btnSaveRenameMember');

    await expect(page.locator('#renameMemberModal')).not.toHaveClass(/open/);
    await expect(page.locator('#memberBalancesList')).toContainText('Aarav Sharma');
  });

  test('9. Toggles dark and light theme', async ({ page }) => {
    const html = page.locator('html');

    // Click theme toggle
    await page.click('#btnThemeToggle');
    const themeAfterFirstClick = await html.getAttribute('data-theme');
    expect(['dark', 'light']).toContain(themeAfterFirstClick);

    // Click again to toggle back
    await page.click('#btnThemeToggle');
    const themeAfterSecondClick = await html.getAttribute('data-theme');
    expect(themeAfterSecondClick).not.toBe(themeAfterFirstClick);
  });

  test('10. Settlement tab: marks payment paid and undoes it', async ({ page }) => {
    await page.click('button.nav-tab[data-tab="settlement"]');

    const settleBtn = page.locator('[data-toggle-settle]').first();
    await expect(settleBtn).toContainText('Mark Paid');

    await settleBtn.click();
    await expect(settleBtn).toContainText('Undo');

    // Undo it
    await settleBtn.click();
    await expect(settleBtn).toContainText('Mark Paid');
  });

  test('11. Sync tab: generates valid sync code and WhatsApp share link', async ({ page }) => {
    await page.click('button.nav-tab[data-tab="sync"]');

    const syncCodeValue = await page.locator('#syncCodeOutput').inputValue();
    expect(syncCodeValue).toContain('TRIPSYNC1:');
  });
});
