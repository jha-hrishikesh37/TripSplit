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
    await expect(firstCard).toContainText('Already paid:');
    await expect(firstCard).toContainText('Remaining to pay:');
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


  test('Test 6: Itemized Bill Split (Who Ate What) & Tax Rollup', async ({ page }) => {

    // Open Add Expense modal
    await page.click('#btnOpenAddExpense');
    await expect(page.locator('#expenseModal')).toHaveClass(/open/);

    // Enter title "Beach Shack Dinner"
    await page.fill('#expTitle', 'Beach Shack Dinner');

    // Click [data-split-type="ITEMIZED"]
    await page.click('[data-split-type="ITEMIZED"]');

    // Fill first item name "Prawns" and price "400"
    await page.locator('.item-name-input[data-item-idx="0"]').fill('Prawns');
    await page.locator('.item-price-input[data-item-idx="0"]').fill('400');

    // Click #btnAddItemRow
    await page.click('#btnAddItemRow');

    // Fill second item name "Lime Soda" and price "100"
    await page.locator('.item-name-input[data-item-idx="1"]').fill('Lime Soda');
    await page.locator('.item-price-input[data-item-idx="1"]').fill('100');

    // Uncheck one member pill on the second item
    await page.locator('[data-item-sharer="1"]').first().click();

    // Fill #expTaxTipInput with "50"
    await page.fill('#expTaxTipInput', '50');

    // Verify #expAmount auto-updates to "550.00" and #splitLiveCheck has class valid
    await expect(page.locator('#expAmount')).toHaveValue('550.00');
    await expect(page.locator('#splitLiveCheck')).toHaveClass(/valid/);

    // Submit the form
    await page.click('button[type="submit"][form="expenseForm"]');
    await expect(page.locator('#expenseModal')).not.toHaveClass(/open/);

    // Verify "Beach Shack Dinner" and "₹550" appear in #expensesListContainer
    const expensesContainer = page.locator('#expensesListContainer');
    await expect(expensesContainer).toContainText('Beach Shack Dinner');
    await expect(expensesContainer).toContainText('₹550');
  });

  test('Test 7: Receipt Scan Mock Populates Itemized Rows', async ({ page }) => {
    await page.route('**/api/receipt/scan', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          receipt: {
            merchant: 'Cafe Mondegar',
            items: [
              { name: 'Burger', priceRupees: 350 },
              { name: 'Fries', priceRupees: 150 }
            ],
            taxTipRupees: 30
          }
        })
      });
    });

    // Open Add Expense
    await page.click('#btnOpenAddExpense');
    await expect(page.locator('#expenseModal')).toHaveClass(/open/);

    // Switch to ITEMIZED
    await page.click('[data-split-type="ITEMIZED"]');

    // Upload a tiny dummy PNG buffer via page.setInputFiles('#receiptFileInput', ...)
    const tinyPngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    await page.setInputFiles('#receiptFileInput', {
      name: 'receipt.png',
      mimeType: 'image/png',
      buffer: tinyPngBuffer
    });

    // Verify #expTitle becomes 'Cafe Mondegar'
    await expect(page.locator('#expTitle')).toHaveValue('Cafe Mondegar');

    // 2 item rows render
    await expect(page.locator('.itemized-row')).toHaveCount(2);
    await expect(page.locator('.item-name-input[data-item-idx="0"]')).toHaveValue('Burger');
    await expect(page.locator('.item-price-input[data-item-idx="0"]')).toHaveValue('350');
    await expect(page.locator('.item-name-input[data-item-idx="1"]')).toHaveValue('Fries');
    await expect(page.locator('.item-price-input[data-item-idx="1"]')).toHaveValue('150');

    // #expTaxTipInput is '30.00'
    await expect(page.locator('#expTaxTipInput')).toHaveValue('30.00');

    // #expAmount becomes '530.00'
    await expect(page.locator('#expAmount')).toHaveValue('530.00');
  });

  test('Test 8: PWA Manifest & Service Worker Asset Availability', async ({ page }) => {
    // Verify link[rel="manifest"] is present in index.html
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', './manifest.json');

    // Fetch /manifest.json and verify status 200
    const manifestRes = await page.request.get('/manifest.json');
    expect(manifestRes.status()).toBe(200);
    const manifestJson = await manifestRes.json();
    expect(manifestJson.name).toBe('TripSplit — Smart Group Expense Manager');
    expect(manifestJson.short_name).toBe('TripSplit');

    // Fetch /sw.js and verify status 200
    const swRes = await page.request.get('/sw.js');
    expect(swRes.status()).toBe(200);
  });
});
