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
      await page.goto(body.devMagicLinkUrl!);
    },
  };
}

async function signIn(page: Page, request: APIRequestContext, lang = 'en'): Promise<void> {
  const session = await newTutorSession(request);
  await page.goto(`/login?lang=${lang}`);
  await page.getByTestId('login-email').fill(session.email);
  await page.getByTestId('login-submit').click();
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
  // Skipped during the Calendar → Schedule rewrite: the new /schedule no
  // longer renders Google-only events (deferred). Re-enable once that flow
  // is re-introduced in a follow-up.
  test.skip('connect → pick calendar → calendar renders events → open lesson detail', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'en');

    // Empty state on integrations page.
    await page.goto('/settings/integrations?lang=en');
    await expect(page.getByTestId('integrations-google')).toBeVisible();
    await expect(page.getByTestId('integrations-google-connect')).toBeVisible();

    // Simulate a completed OAuth.
    await seedGoogleConnection(page, []);
    await page.reload();
    await expect(page.getByTestId('integrations-google-connected')).toBeVisible();

    // Calendars list is populated by the fake.
    await expect(page.getByTestId('integrations-cal-cal-primary')).toBeVisible();
    await page.getByTestId('integrations-cal-cal-primary').check();
    await page.getByTestId('integrations-google-save').click();
    await expect(page.getByTestId('integrations-toast')).toBeVisible();

    // Calendar page shows the canned events.
    await page.goto('/calendar?lang=en');
    await expect(page.getByTestId('calendar-page')).toBeVisible();
    await expect(page.getByTestId('calendar-events-list')).toBeVisible();
    // Future event row exists (FullCalendar also renders the title in its
    // grid, so scope to our explicit events-list container to avoid match
    // ambiguity).
    const eventsList = page.getByTestId('calendar-events-list');
    await expect(eventsList.getByText('Sara — Spanish lesson')).toBeVisible();
    await expect(eventsList.getByText('Sara — upcoming lesson')).toBeVisible();
    // Future event has the "Upcoming" badge inside its article (exact match
    // since the article title also contains the word "upcoming").
    const futureRow = page.locator('[data-testid^="calendar-event-evt-future-1"]');
    await expect(futureRow.getByText('Upcoming', { exact: true })).toBeVisible();

    // The past event has the "Add feedback" button.
    const pastRow = page.locator('[data-testid^="calendar-event-evt-past-1"]');
    await expect(pastRow.getByRole('button', { name: 'Add feedback' })).toBeVisible();

    // Disconnect flow.
    await page.goto('/settings/integrations?lang=en');
    await page.getByTestId('integrations-google-disconnect').click();
    await page.getByTestId('confirm-submit').click();
    await expect(page.getByTestId('integrations-google-connect')).toBeVisible();
  });

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

  // FullCalendar was removed in the Schedule rewrite — the new /schedule is a
  // plain list. Replace this test with an RTL check on /schedule when the
  // Google-events-in-schedule flow returns.
  test.skip('calendar page renders FullCalendar with direction=rtl in Hebrew', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'he');
    await page.goto('/settings/integrations?lang=he');
    await seedGoogleConnection(page, ['cal-primary']);
    await page.goto('/calendar?lang=he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('calendar-page')).toBeVisible();

    // FullCalendar adds .fc-direction-rtl on its root when direction=rtl.
    await expect(page.locator('.fc-direction-rtl').first()).toBeVisible();

    // No horizontal scroll at common viewports.
    for (const vw of [1280, 768, 320]) {
      await page.setViewportSize({ width: vw, height: 900 });
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
