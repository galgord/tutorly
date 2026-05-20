import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:5174/api';

async function signIn(page: Page, request: APIRequestContext, lang = 'en'): Promise<void> {
  const email = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function createStudent(page: Page, name: string): Promise<string> {
  await page.goto('/students?lang=en');
  await page.getByTestId('students-add-button').click();
  await page.getByTestId('add-student-name').fill(name);
  await page.getByTestId('add-student-submit').click();
  // Navigate to detail by clicking the student name (the row is a link; clicking
  // the name navigates and avoids the row's invite/menu buttons on narrow widths).
  const row = page.locator('[data-testid^="student-row-"]', { hasText: name }).first();
  await expect(row).toBeVisible();
  await row.locator('[data-testid^="student-name-"]').click();
  await page.waitForURL(/\/students\/[^/]+/);
  const url = page.url();
  return url.split('/students/')[1]!;
}

test.describe('manual lesson creation (no Google connection)', () => {
  test('add lesson manually → appears in recent → opens lesson detail with feedback editor', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'en');
    await createStudent(page, 'Bruno');
    await expect(page.getByTestId('student-lessons')).toBeVisible();
    // Empty state present.
    await expect(page.getByTestId('student-lessons-empty')).toBeVisible();

    // Open the manual-lesson modal.
    await page.getByTestId('student-add-lesson').click();
    await expect(page.getByTestId('add-lesson-modal')).toBeVisible();

    // datetime-local pre-fills to current hour; just add a title and submit.
    await page.getByTestId('add-lesson-title').fill('first session');
    await page.getByTestId('add-lesson-submit').click();

    // On success the modal closes and we navigate to /lessons/:id where the
    // Phase 4 feedback editor + games panel are now mounted.
    await page.waitForURL(/\/lessons\/[^/]+/);
    await expect(page.getByTestId('lesson-detail')).toBeVisible();
    await expect(page.getByTestId('feedback-editor')).toBeVisible();
    await expect(page.getByTestId('games-panel')).toBeVisible();
  });
});

test.describe('manual lesson creation (RTL)', () => {
  test('flow works in Hebrew (no Google)', async ({ page, request }) => {
    await signIn(page, request, 'he');
    await page.goto('/students?lang=he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // Add student via API to keep test fast.
    const csrf = await page.evaluate(() =>
      decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
    );
    const created = await page.evaluate(
      async ({ csrf }) => {
        const r = await fetch('/api/students', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({ name: 'דניאל' }),
        });
        return r.json();
      },
      { csrf },
    );
    await page.goto(`/students/${created.id}?lang=he`);
    await expect(page.getByTestId('student-detail')).toBeVisible();

    // No horizontal scrollbar at any viewport.
    for (const vw of [1280, 768, 320]) {
      await page.setViewportSize({ width: vw, height: 800 });
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `vw=${vw}`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }

    // Manual-add button works.
    await page.getByTestId('student-add-lesson').click();
    await page.getByTestId('add-lesson-title').fill('שיעור ראשון');
    await page.getByTestId('add-lesson-submit').click();
    await page.waitForURL(/\/lessons\/[^/]+/);
    await expect(page.getByTestId('lesson-detail')).toBeVisible();
    // Hebrew title preserved in the detail page heading.
    await expect(page.locator('h1')).toContainText('שיעור ראשון');
  });
});
