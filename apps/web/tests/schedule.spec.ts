import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Hit the api through the Vite dev-proxy at /api so cookies are same-origin
// with the SPA (mirrors auth.spec.ts / students.spec.ts).
const API_BASE = 'http://localhost:5174/api';

/**
 * Requests a magic link from the real api and consumes it to authenticate.
 * In non-prod the controller returns the consume URL in the response body
 * (`devMagicLinkUrl`) so tests don't scrape mailer logs.
 */
async function signIn(page: Page, request: APIRequestContext, lang = 'en'): Promise<void> {
  const email = `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${API_BASE}/auth/magic-link`, { data: { email } });
  expect(res.status()).toBe(202);
  const body = (await res.json()) as { ok: true; devMagicLinkUrl?: string };
  expect(body.devMagicLinkUrl, 'api must return devMagicLinkUrl in non-prod').toBeTruthy();
  await page.goto(`/login?lang=${lang}`);
  // Consume the API-issued link directly. The consume endpoint's 302→/dashboard
  // can supersede the tracked navigation (net::ERR_ABORTED) under parallel
  // workers — tolerate it and assert the destination below.
  await page.goto(body.devMagicLinkUrl!, { waitUntil: 'commit' }).catch((err) => {
    if (!String(err).includes('net::ERR_ABORTED')) throw err;
  });
  await page.waitForURL(/\/dashboard/);
}

/** Creates a student via the API, piggybacking the browser's session + csrf. */
async function createStudentViaApi(page: Page, name: string): Promise<string> {
  const csrf = await page.evaluate(() =>
    decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
  );
  return page.evaluate(
    async ({ csrf, name }) => {
      const r = await fetch('/api/students', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ name }),
      });
      const j = (await r.json()) as { id: string };
      return j.id;
    },
    { csrf, name },
  );
}

test.describe('schedule (LTR)', () => {
  test('renders the schedule page', async ({ page, request }) => {
    await signIn(page, request, 'en');
    await page.goto('/schedule?lang=en');
    await expect(page.getByTestId('schedule-page')).toBeVisible();
  });

  test('with no students the primary action is "Add a student" and the empty state shows', async ({
    page,
    request,
  }) => {
    // A fresh tutor session has no students.
    await signIn(page, request, 'en');
    await page.goto('/schedule?lang=en');
    await expect(page.getByTestId('schedule-page')).toBeVisible();

    // Primary action adapts to the no-students case.
    const addLink = page.getByTestId('schedule-add-link');
    await expect(addLink).toBeVisible();
    await expect(addLink).toContainText('Add a student');

    // Empty state is shown — no lessons, no students.
    await expect(page.getByTestId('schedule-empty')).toBeVisible();
  });

  test('with a student, "Add a lesson" → student picker → add-lesson modal opens', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'en');
    const studentId = await createStudentViaApi(page, 'Schedule-Sara');

    await page.goto('/schedule?lang=en');
    await expect(page.getByTestId('schedule-page')).toBeVisible();

    // With at least one student the primary action becomes "Add a lesson".
    const addLink = page.getByTestId('schedule-add-link');
    await expect(addLink).toBeVisible();
    await expect(addLink).toContainText('Add a lesson');

    // Opens the student picker.
    await addLink.click();
    await expect(page.getByTestId('student-picker-modal')).toBeVisible();

    // Picking the student opens the add-lesson modal for them.
    await page.getByTestId(`student-picker-row-${studentId}`).click();
    await expect(page.getByTestId('student-picker-modal')).toBeHidden();
    await expect(page.getByTestId('add-lesson-modal')).toBeVisible();
  });
});

test.describe('schedule (RTL — Hebrew)', () => {
  test('renders RTL with no horizontal scroll at common viewports', async ({ page, request }) => {
    await signIn(page, request, 'he');
    await page.goto('/schedule?lang=he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('schedule-page')).toBeVisible();

    for (const vw of [1280, 768, 320]) {
      await page.setViewportSize({ width: vw, height: 800 });
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `vw=${vw}`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  });
});
