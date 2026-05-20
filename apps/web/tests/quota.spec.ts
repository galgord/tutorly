import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:5174/api';

async function signIn(page: Page, request: APIRequestContext, lang = 'en'): Promise<void> {
  const email = `quota-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function createLesson(page: Page, studentId: string): Promise<string> {
  const csrf = await page.evaluate(() =>
    decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
  );
  return page.evaluate(
    async ({ csrf, studentId }) => {
      const r = await fetch('/api/lessons', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({
          studentId,
          occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
          title: 'Quota test lesson',
        }),
      });
      const j = (await r.json()) as { id: string };
      return j.id;
    },
    { csrf, studentId },
  );
}

async function seedQuota(page: Page, monthlyGenerations: number): Promise<void> {
  const csrf = await page.evaluate(() =>
    decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
  );
  await page.evaluate(
    async ({ csrf, monthlyGenerations }) => {
      await fetch('/api/__test__/quota/set', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ monthlyGenerations }),
      });
    },
    { csrf, monthlyGenerations },
  );
}

test.describe('Phase 9 — monthly generation cap', () => {
  test('over-cap → 429 → friendly banner; new generation refuses until reset', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    const studentId = await createStudent(page, 'Quota-Sara');
    const lessonId = await createLesson(page, studentId);
    // Push the tutor right at the cap (default 100 in tests).
    await seedQuota(page, 100);

    await page.goto(`/lessons/${lessonId}`);
    await expect(page.getByTestId('feedback-editor')).toBeVisible();
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="feedback-input"]') as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(el, 'Sara confused ser/estar today; drill physical vs emotional.');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.getByTestId('feedback-save').click();
    await expect(page.getByTestId('feedback-toast')).toBeVisible();

    await page.getByTestId('games-generate-fill-blank').click();
    // The banner shows the cap + reset date and the generate buttons go disabled.
    await expect(page.getByTestId('games-quota-banner')).toBeVisible();
    await expect(page.getByText(/100 of 100|100 \/ 100/)).toBeVisible();
    await expect(page.getByTestId('games-generate-fill-blank')).toBeDisabled();
    await expect(page.getByTestId('games-generate-timed-quiz')).toBeDisabled();

    // No game row was created — the server refuses before persisting.
    await expect(page.locator('[data-testid^="games-row-"]')).toHaveCount(0);
  });

  test('admin/usage endpoint refuses without admin token', async ({ request }) => {
    const r = await request.get(`${API_BASE}/admin/usage`);
    expect(r.status()).toBe(403);
  });
});
