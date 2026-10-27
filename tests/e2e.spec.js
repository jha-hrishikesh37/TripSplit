import { test, expect } from '@playwright/test';

test.describe('TripSplit E2E Test Suite', () => {

  test.beforeEach(async ({ page }) => {
    // Clear localStorage to always start with fresh seed data
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('Test 1: Add Expense & Percent Split Redistribution', async ({ page }) => {
    // Open the app, click #btnOpenAddExpense
    await page.click('#btnOpenAddExpense');
    await expect(page.locator('#expenseModal')).toHaveClass(/open/);

    // Fill #expTitle with "Playwright Cab" and #expAmount with "300"
    await page.fill('#expTitle', 'Playwright Cab');
    await page.fill('#expAmount', '300');

    // Click [data-split-type="PERCENT"]
    await page.click('[data-split-type="PERCENT"]');

    // Uncheck one member checkbox (.split-member-check)
    const memberCheckboxes = page.locator('.split-member-check');
    await memberCheckboxes.first().uncheck();

    // Verify #splitLiveCheck has class valid and #splitCheckMath shows 100.00% / 100.00%
    await expect(page.locator('#splitLiveCheck')).toHaveClass(/valid/);
    await expect(page.locator('#splitCheckMath')).toContainText('100.00% / 100.00%');

    // Submit the form
    await page.click('button[type="submit"][form="expenseForm"]');
    await expect(page.locator('#expenseModal')).not.toHaveClass(/open/);

    // Verify "Playwright Cab" and "₹300" appear in #expensesListContainer
    const expensesContainer = page.locator('#expensesListContainer');
    await expect(expensesContainer).toContainText('Playwright Cab');
    await expect(expensesContainer).toContainText('₹300');
  });

  test('Test 2: Settlement Mark Paid & Stale Amount Warning', async ({ page }) => {
    // Switch to [data-tab="settlement"]
    await page.click('[data-tab="settlement"]');

    // Click the first [data-toggle-settle] ("Mark Paid") button
    const firstCard = page.locator('.settlement-card').first();
    const firstSettleBtn = page.locator('[data-toggle-settle]').first();
    await expect(firstSettleBtn).toContainText('Mark Paid');
    await firstSettleBtn.click();

    // Verify the card gets class is-settled
    await expect(firstCard).toHaveClass(/is-settled/);

    // Then add a new expense of "500" paid by the first member
    await page.click('#btnOpenAddExpense');
    await expect(page.locator('#expenseModal')).toHaveClass(/open/);

    await page.fill('#expTitle', 'Playwright Dinner');
    await page.fill('#expAmount', '500');
    await page.locator('#expPaidBy').selectOption({ index: 0 });

    await page.click('button[type="submit"][form="expenseForm"]');
    await expect(page.locator('#expenseModal')).not.toHaveClass(/open/);

    // Return to the Settlement tab
    await page.click('[data-tab="settlement"]');

    // Verify the settled status resets and shows the stale warning
    await expect(firstCard).not.toHaveClass(/is-settled/);
    await expect(firstCard).toContainText('⚠️ Amount changed since marked paid — please re-verify');
  });

  test('Test 3: URL #sync= Invite Link Import & Identity Picker', async ({ page }) => {
    // Switch to [data-tab="sync"]
    await page.click('[data-tab="sync"]');

    // Read the value of #syncCodeOutput
    const syncCode = await page.locator('#syncCodeOutput').inputValue();
    expect(syncCode).toContain('TRIPSYNC1:');

    // Navigate to /?#sync= + encodeURIComponent(syncCode)
    await page.goto('/?#sync=' + encodeURIComponent(syncCode));

    // Verify #welcomeIdentityModal opens with class open
    const welcomeModal = page.locator('#welcomeIdentityModal');
    await expect(welcomeModal).toHaveClass(/open/);

    // Click the first [data-pick-identity] button and verify the modal closes
    const firstIdentityBtn = page.locator('[data-pick-identity]').first();
    await firstIdentityBtn.click();
    await expect(welcomeModal).not.toHaveClass(/open/);
  });

  test('Test 4: Dark Mode Print Media Forces Light Paper Theme', async ({ page }) => {
    // Click #btnThemeToggle until document.documentElement.getAttribute('data-theme') === 'dark'
    const currentTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (currentTheme !== 'dark') {
      await page.click('#btnThemeToggle');
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Call await page.emulateMedia({ media: 'print' })
    await page.emulateMedia({ media: 'print' });

    // Verify the computed backgroundColor of document.body is rgb(255, 255, 255)
    const bodyBg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).toBe('rgb(255, 255, 255)');

    // Verify .no-print elements are hidden (display: none)
    const noPrintDisplays = await page.$$eval('.no-print', elements =>
      elements.map(el => window.getComputedStyle(el).display)
    );
    expect(noPrintDisplays.length).toBeGreaterThan(0);
    for (const display of noPrintDisplays) {
      expect(display).toBe('none');
    }
  });

  test('Test 5: Cloud Sync Endpoint Roundtrip / Mock Sync UI', async ({ page }) => {
    let interceptedPost = null;

    await page.route('**/api/trips/*/sync', async (route, request) => {
      if (request.method() === 'POST') {
        interceptedPost = {
          url: request.url(),
          postData: request.postDataJSON()
        };
        const payload = request.postDataJSON();
        const incomingTrip = payload?.trip || payload;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            trip: incomingTrip
          })
        });
      } else {
        await route.continue();
      }
    });

    // Click #btnCloudSyncNow to trigger sync
    await page.click('#btnCloudSyncNow');

    // Verify #cloudSyncLabel updates to 'Synced'
    const syncLabel = page.locator('#cloudSyncLabel');
    await expect(syncLabel).toHaveText('Synced');

    // Verify intercepted request contained the active trip's ID and expenses
    expect(interceptedPost).not.toBeNull();
    const tripData = interceptedPost.postData?.trip || interceptedPost.postData;
    expect(tripData.id).toBeTruthy();
    expect(Array.isArray(tripData.expenses)).toBe(true);
    expect(interceptedPost.url).toContain(encodeURIComponent(tripData.id));

    // Verify #cloudSyncDot has class 'synced'
    await expect(page.locator('#cloudSyncDot')).toHaveClass(/synced/);
  });

});
