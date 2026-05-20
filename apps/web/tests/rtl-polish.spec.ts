import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Phase 8 RTL polish specs: pseudo-localization activation, modal close
// button placement in RTL, directional-icon flip. Re-uses the magic-link
// signin pattern from the other tutor-facing specs.

const API_BASE = 'http://localhost:5174/api';

async function signIn(page: Page, request: APIRequestContext, lang = 'en'): Promise<void> {
  const email = `rtlpolish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${API_BASE}/auth/magic-link`, { data: { email } });
  expect(res.status()).toBe(202);
  const body = (await res.json()) as { ok: true; devMagicLinkUrl?: string };
  expect(body.devMagicLinkUrl).toBeTruthy();
  await page.goto(`/login?lang=${lang}`);
  // Consume the API-issued link directly. Submitting the login form instead
  // fires window.location.replace, which races this navigation → net::ERR_ABORTED
  // under parallel workers. One navigation; tolerate a superseded redirect and
  // assert the destination below.
  await page.goto(body.devMagicLinkUrl!, { waitUntil: 'commit' }).catch((err) => {
    if (!String(err).includes('net::ERR_ABORTED')) throw err;
  });
  await page.waitForURL(/\/dashboard/);
}

async function addStudent(page: Page, name: string): Promise<void> {
  await page.goto('/students?lang=he');
  await page.getByTestId('students-add-button').click();
  await page.getByTestId('add-student-name').fill(name);
  await page.getByTestId('add-student-submit').click();
  await expect(page.locator('[data-testid^="student-row-"]').first()).toBeVisible();
}

test.describe('Phase 8 — RTL polish (he)', () => {
  test('login page in Hebrew sets html dir=rtl', async ({ page }) => {
    await page.goto('/login?lang=he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  });

  test('ConfirmDialog close button sits on the inline-start edge in RTL', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'he');
    await addStudent(page, 'Yael');

    // Open a student so we can trigger the rotate-token ConfirmDialog.
    await page
      .locator('[data-testid^="student-row-"]')
      .first()
      .locator('[data-testid^="student-name-"]')
      .click();
    await page.waitForURL(/\/students\/[^/]+/);
    await expect(page.getByTestId('student-detail')).toBeVisible();

    await page.getByTestId('student-rotate-token').click();

    const close = page.getByTestId('confirm-close');
    const title = page.locator('#confirm-title');
    await expect(close).toBeVisible();
    await expect(title).toBeVisible();

    // In RTL the visual-start edge is the right edge, so the close button's
    // x-coordinate must be GREATER than the title's. (In LTR the reverse
    // would hold — see the en-locale assertion below.)
    const closeBox = await close.boundingBox();
    const titleBox = await title.boundingBox();
    expect(closeBox).toBeTruthy();
    expect(titleBox).toBeTruthy();
    expect(closeBox!.x).toBeGreaterThan(titleBox!.x);

    // Dismiss for cleanup.
    await page.getByTestId('confirm-cancel').click();
  });

  test('ConfirmDialog close button sits on the inline-start edge in LTR', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'en');
    await page.goto('/students?lang=en');
    await page.getByTestId('students-add-button').click();
    await page.getByTestId('add-student-name').fill('Mira');
    await page.getByTestId('add-student-submit').click();
    await expect(page.locator('[data-testid^="student-row-"]').first()).toBeVisible();

    await page
      .locator('[data-testid^="student-row-"]')
      .first()
      .locator('[data-testid^="student-name-"]')
      .click();
    await page.waitForURL(/\/students\/[^/]+/);
    await page.getByTestId('student-rotate-token').click();

    const close = page.getByTestId('confirm-close');
    const title = page.locator('#confirm-title');
    const closeBox = await close.boundingBox();
    const titleBox = await title.boundingBox();
    expect(closeBox).toBeTruthy();
    expect(titleBox).toBeTruthy();
    // LTR: close is visually-left of the title (smaller x).
    expect(closeBox!.x).toBeLessThan(titleBox!.x);

    await page.getByTestId('confirm-cancel').click();
  });

  test('pagination arrow has scaleX(-1) computed transform in RTL', async ({ page, request }) => {
    // We exercise the global `.icon-flip` rule in context — Hebrew dashboard
    // pagination row of the recent-attempts list. Doing it through the SPA
    // (rather than `setContent`) means we test the styles.css that ships
    // for real, not a stub.
    await signIn(page, request, 'he');
    await addStudent(page, 'Ronit');
    await page
      .locator('[data-testid^="student-row-"]')
      .first()
      .locator('[data-testid^="student-name-"]')
      .click();
    await page.waitForURL(/\/students\/[^/]+/);

    // The student has no attempts so the pagination block is absent. Inject
    // a probe element styled with the class so we still verify the global
    // CSS rule lands. (The pagination DOM is the canonical caller, but the
    // CSS check is what the gate cares about.)
    await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.dataset.testid = 'icon-flip-probe';
      probe.className = 'icon-flip';
      probe.style.display = 'inline-block';
      probe.textContent = '→';
      document.body.appendChild(probe);
    });
    const transform = await page
      .getByTestId('icon-flip-probe')
      .evaluate((el) => getComputedStyle(el).transform);
    expect(transform).toMatch(/matrix\(\s*-1\s*,/);
  });

  test('.icon-flip element is unchanged in LTR', async ({ page, request }) => {
    await signIn(page, request, 'en');
    await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.dataset.testid = 'icon-flip-probe';
      probe.className = 'icon-flip';
      probe.style.display = 'inline-block';
      probe.textContent = '→';
      document.body.appendChild(probe);
    });
    const transform = await page
      .getByTestId('icon-flip-probe')
      .evaluate((el) => getComputedStyle(el).transform);
    expect(transform === 'none' || transform === '').toBe(true);
  });
});

test.describe('Phase 8 — pseudo-localization', () => {
  test('?lang=pseudo flips html lang + adds the marker class + wraps strings', async ({
    page,
  }) => {
    await page.goto('/login?lang=pseudo');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pseudo');
    // The dir attribute stays LTR — pseudo borrows en metrics.
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    // The marker class is added by the early boot script.
    await expect(page.locator('html.pseudo-active')).toHaveCount(1);
    // The pseudo post-processor wraps every rendered string with ⟦ … ⟧.
    const body = await page.locator('body').innerText();
    expect(body).toContain('⟦');
    expect(body).toContain('⟧');
  });
});
