import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:5174/api';

interface TutorTestSession {
  email: string;
  consume(page: Page): Promise<void>;
}

async function newTutorSession(request: APIRequestContext): Promise<TutorTestSession> {
  const email = `integ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${API_BASE}/auth/magic-link`, { data: { email } });
  expect(res.status()).toBe(202);
  const body = (await res.json()) as { ok: true; devMagicLinkUrl?: string };
  expect(body.devMagicLinkUrl).toBeTruthy();
  return {
    email,
    async consume(page) {
      // Tolerate the consume endpoint's 302→/dashboard superseding the tracked
      // navigation (net::ERR_ABORTED); the caller asserts the destination.
      await page.goto(body.devMagicLinkUrl!).catch((err) => {
        if (!String(err).includes('net::ERR_ABORTED')) throw err;
      });
    },
  };
}

async function signIn(page: Page, request: APIRequestContext, lang = 'en'): Promise<void> {
  const session = await newTutorSession(request);
  await page.goto(`/login?lang=${lang}`);
  // Don't submit the login form — its window.location.replace would race the
  // consume navigation. Consuming the API-issued link is enough to authenticate.
  await session.consume(page);
  await page.waitForURL(/\/dashboard/);
}

// Calls the test-only seed route to pretend OAuth completed. Uses
// page.evaluate so the request piggybacks the browser's session + csrf cookies.
async function seedGoogleConnection(page: Page, calendarIds: string[]): Promise<void> {
  const result = await page.evaluate(async (ids) => {
    const csrf = decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? '');
    const res = await fetch('/api/__test__/google/fake-tokens', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ calendarIds: ids }),
    });
    return { status: res.status, body: await res.json() };
  }, calendarIds);
  expect(result.status).toBe(201);
  expect(result.body.ok).toBe(true);
}

test.describe('Google integrations (mocked)', () => {
  test('disconnect after connect surfaces the reconnect banner when status flips', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'en');
    await page.goto('/settings/integrations?lang=en');
    await seedGoogleConnection(page, ['cal-primary']);
    await page.reload();
    await expect(page.getByTestId('integrations-google-connected')).toBeVisible();

    // Wipe the connection at the server (simulating an invalid_grant).
    // Importantly we DON'T go through the UI's disconnect mutation here —
    // that would also clear sessionStorage and suppress the reconnect
    // banner. We hit the API directly to simulate a server-side invalidation.
    await page.evaluate(async () => {
      const csrf = decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? '');
      await fetch('/api/integrations/google/disconnect', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': csrf },
      });
    });

    // Reload the page — fresh component mount reads sessionStorage and sees
    // we were previously connected; status returns connected:false; banner.
    await page.reload();
    await page.waitForSelector('[data-testid="integrations-reconnect-banner"]', { timeout: 5_000 });
    await expect(page.getByTestId('integrations-reconnect-banner')).toBeVisible();
  });
});

test.describe('integrations RTL', () => {
  test('integrations page renders RTL with no horizontal scroll at common viewports', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'he');
    await page.goto('/settings/integrations?lang=he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');

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
});
