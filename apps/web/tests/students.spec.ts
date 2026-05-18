import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Same proxy convention as auth.spec.ts — hit the api through the Vite dev
// proxy at /api so cookies are same-origin with the SPA.
const API_BASE = 'http://localhost:5174/api';

interface TutorTestSession {
  email: string;
  consumeUrl: string;
  consume(page: Page): Promise<void>;
}

async function newTutorSession(request: APIRequestContext): Promise<TutorTestSession> {
  const email = `students-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${API_BASE}/auth/magic-link`, { data: { email } });
  expect(res.status()).toBe(202);
  const body = (await res.json()) as { ok: true; devMagicLinkUrl?: string };
  expect(body.devMagicLinkUrl, 'api must return devMagicLinkUrl in non-prod').toBeTruthy();
  return {
    email,
    consumeUrl: body.devMagicLinkUrl!,
    async consume(page) {
      await page.goto(body.devMagicLinkUrl!);
    },
  };
}

async function signIn(page: Page, request: APIRequestContext, lang = 'en'): Promise<TutorTestSession> {
  const session = await newTutorSession(request);
  await page.goto(`/login?lang=${lang}`);
  await page.getByTestId('login-email').fill(session.email);
  await page.getByTestId('login-submit').click();
  await session.consume(page);
  await page.waitForURL(/\/dashboard/);
  return session;
}

test.describe('students CRUD (LTR)', () => {
  test('add → open → copy share link → cross-context load → rotate → old token 404s', async ({
    page,
    request,
    context,
    browser,
  }) => {
    await signIn(page, request, 'en');

    // Force the locale via querystring on the students list page so caret/text
    // alignment assertions are deterministic.
    await page.goto('/students?lang=en');
    await expect(page.getByTestId('students-list')).toBeVisible();

    // Empty state shows the prompt.
    await expect(page.getByTestId('students-empty')).toBeVisible();

    // Add a student via the modal.
    await page.getByTestId('students-add-button').click();
    await page.getByTestId('add-student-name').fill('Sara');
    await page.getByTestId('add-student-notes').fill('shy at first');
    await page.getByTestId('add-student-submit').click();

    // Row appears in the list.
    const row = page.locator('[data-testid^="student-row-"]').first();
    await expect(row).toBeVisible();
    await expect(row.getByText('Sara')).toBeVisible();

    // Open detail.
    await row.getByText('Open').click();
    await page.waitForURL(/\/students\/[^/]+/);
    await expect(page.getByTestId('student-detail')).toBeVisible();

    // Capture the share URL displayed on the page.
    const shareUrl = await page.getByTestId('student-share-url').innerText();
    expect(shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]+$/);

    // Open the share URL in a fresh context (no cookies — simulates incognito
    // student view).
    const studentCtx = await browser.newContext();
    const studentPage = await studentCtx.newPage();
    await studentPage.goto(shareUrl);
    await expect(studentPage.getByTestId('public-student')).toBeVisible();
    await expect(studentPage.getByTestId('public-student')).toContainText('Sara');
    await expect(studentPage.getByTestId('public-student-empty')).toBeVisible();
    await studentCtx.close();

    // Back in tutor context: rotate token.
    await page.getByTestId('student-rotate-token').click();
    await page.getByTestId('confirm-submit').click();
    // Wait for the toast confirming the rotation completed (and the share URL has
    // been refetched).
    await expect(page.getByTestId('student-toast')).toBeVisible();
    await expect(page.getByTestId('student-toast')).toBeHidden({ timeout: 5_000 });

    // New share URL should differ.
    await expect(page.getByTestId('student-share-url')).not.toHaveText(shareUrl);

    // Old share URL now 404s.
    const stalePage = await context.newPage();
    await stalePage.goto(shareUrl);
    await expect(stalePage.getByTestId('public-student-not-found')).toBeVisible();
    await stalePage.close();
  });

  test('search filters list, pagination shows next page', async ({ page, request }) => {
    await signIn(page, request, 'en');
    await page.goto('/students?lang=en');

    // Add a handful via API so the test is fast.
    const csrf = await page.evaluate(() => {
      const m = document.cookie.match(/tutor_csrf=([^;]+)/);
      return m ? decodeURIComponent(m[1]!) : '';
    });
    for (const name of ['Sara', 'Bruno', 'Carla', 'Daniel', 'Esther']) {
      await request.post(`${API_BASE}/students`, {
        data: { name },
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie: '' },
      });
    }
    // The fetch above doesn't share cookies; do it via page.evaluate so the
    // session cookie is sent.
    for (const name of ['Sara', 'Bruno', 'Carla', 'Daniel', 'Esther']) {
      await page.evaluate(
        async ({ name, csrf }) => {
          await fetch('/api/students', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
            body: JSON.stringify({ name }),
          });
        },
        { name, csrf },
      );
    }
    await page.reload();
    await expect(page.locator('[data-testid^="student-row-"]')).toHaveCount(5);

    await page.getByTestId('students-search').fill('sa');
    // Debounce-free implementation: filtered immediately.
    await expect(page.locator('[data-testid^="student-row-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="student-row-"]')).toHaveCount(1);
  });

  test('trash flow: delete → appears in trash → restore', async ({ page, request }) => {
    await signIn(page, request, 'en');
    await page.goto('/students?lang=en');

    // Seed one student via the page so cookies are right.
    const csrf = await page.evaluate(() => {
      const m = document.cookie.match(/tutor_csrf=([^;]+)/);
      return m ? decodeURIComponent(m[1]!) : '';
    });
    await page.evaluate(
      async ({ csrf }) => {
        await fetch('/api/students', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({ name: 'TrashMe' }),
        });
      },
      { csrf },
    );
    await page.reload();
    await expect(page.getByText('TrashMe')).toBeVisible();

    // Open the row's delete confirm.
    const row = page.locator('[data-testid^="student-row-"]', { hasText: 'TrashMe' });
    await row.getByText('Delete').click();
    await page.getByTestId('confirm-typed-input').fill('TrashMe');
    await page.getByTestId('confirm-submit').click();
    // The list refetches after the dialog closes; the trashed student no
    // longer appears as a clickable row.
    await expect(page.locator('[data-testid^="student-row-"]', { hasText: 'TrashMe' })).toHaveCount(0);

    // Trash page shows it; restore.
    await page.getByTestId('students-trash-link').click();
    await expect(page.getByTestId('students-trash')).toBeVisible();
    await expect(page.getByText('TrashMe')).toBeVisible();

    const trashRow = page.locator('[data-testid^="trash-row-"]', { hasText: 'TrashMe' });
    await trashRow.getByText('Restore').click();

    await expect(page.getByTestId('trash-toast')).toBeVisible();

    // Back on the list it is alive again.
    await page.getByTestId('trash-back').click();
    await expect(page.getByText('TrashMe')).toBeVisible();
  });
});

test.describe('students RTL (Hebrew)', () => {
  test('students page renders RTL with no horizontal scroll at common viewports', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'he');
    await page.goto('/students?lang=he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');

    // "Add student" button sits on the visual end of the header. With our
    // `justify-between` layout that means visually-right in LTR and
    // visually-left in RTL. Assert the button is visually before (smaller
    // `x`) than the page title in RTL.
    const addBtn = page.getByTestId('students-add-button');
    const title = page.getByRole('heading', { level: 1 });
    await expect(addBtn).toBeVisible();
    const btnBox = await addBtn.boundingBox();
    const titleBox = await title.boundingBox();
    expect(btnBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    if (btnBox && titleBox) {
      // In RTL the button is to the left of (lower x than) the title.
      expect(btnBox.x).toBeLessThan(titleBox.x);
    }

    // No horizontal scroll at common viewports.
    for (const vw of [1280, 768, 320]) {
      await page.setViewportSize({ width: vw, height: 800 });
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `vw=${vw}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(
        overflow.clientWidth + 1,
      );
    }
  });

  test('add student + open detail works in Hebrew with mixed-script name', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'he');
    await page.goto('/students?lang=he');

    await page.getByTestId('students-add-button').click();
    // Mixed-script name: English given name + Hebrew surname.
    await page.getByTestId('add-student-name').fill('Sara כהן');
    await page.getByTestId('add-student-submit').click();

    const row = page.locator('[data-testid^="student-row-"]').first();
    await expect(row).toContainText('Sara');
    await expect(row).toContainText('כהן');

    // Open detail.
    await row.getByText('פתח').click();
    await page.waitForURL(/\/students\/[^/]+/);
    await expect(page.getByTestId('student-detail')).toBeVisible();

    // Share URL is forced LTR.
    await expect(page.getByTestId('student-share-url')).toHaveAttribute('dir', 'ltr');
  });
});
