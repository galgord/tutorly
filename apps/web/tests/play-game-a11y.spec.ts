import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:5174/api';

async function signInAsTutor(page: Page, request: APIRequestContext): Promise<void> {
  const email = `phase6a11y-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${API_BASE}/auth/magic-link`, { data: { email } });
  expect(res.status()).toBe(202);
  const body = (await res.json()) as { ok: true; devMagicLinkUrl?: string };
  await page.goto('/login');
  // Consume the API-issued link directly. Submitting the login form instead
  // fires window.location.replace, which races this navigation → net::ERR_ABORTED
  // under parallel workers. One navigation; tolerate a superseded redirect and
  // assert the destination below.
  await page.goto(body.devMagicLinkUrl!, { waitUntil: 'commit' }).catch((err) => {
    if (!String(err).includes('net::ERR_ABORTED')) throw err;
  });
  await page.waitForURL(/\/dashboard/);
}

async function seed(
  page: Page,
  gameType: 'FILL_BLANK' | 'TIMED_QUIZ',
): Promise<{ shareToken: string; gameId: string }> {
  const csrf = await page.evaluate(() =>
    decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
  );
  return page.evaluate(
    async ({ csrf, gameType }) => {
      const s = await fetch('/api/students', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ name: `A11y-${gameType}` }),
      }).then((r) => r.json() as Promise<{ id: string; shareToken: string }>);
      const l = await fetch('/api/lessons', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({
          studentId: s.id,
          occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
        }),
      }).then((r) => r.json() as Promise<{ id: string }>);
      await fetch(`/api/lessons/${l.id}/feedback`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ feedbackText: 'Drill verb conjugation.' }),
      });
      const g = await fetch(`/api/lessons/${l.id}/games`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ type: gameType, poolSize: 5 }),
      }).then((r) => r.json() as Promise<{ id: string }>);
      let status = 'GENERATING';
      const deadline = Date.now() + 10_000;
      while (status === 'GENERATING' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
        const p = await fetch(`/api/games/${g.id}`, { credentials: 'include' }).then((r) =>
          r.json() as Promise<{ status: string }>,
        );
        status = p.status;
      }
      await fetch(`/api/games/${g.id}/assign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: '{}',
      });
      return { shareToken: s.shareToken, gameId: g.id };
    },
    { csrf, gameType },
  );
}

test.describe('axe a11y — FILL_BLANK engine', () => {
  test('zero serious or critical violations', async ({ page, request }) => {
    await signInAsTutor(page, request);
    const { shareToken, gameId } = await seed(page, 'FILL_BLANK');
    const studentPage = await page.context().newPage();
    await studentPage.goto(`/s/${shareToken}/play/${gameId}`);
    await expect(studentPage.getByTestId('fill-blank-engine')).toBeVisible();
    const results = await new AxeBuilder({ page: studentPage })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    if (serious.length > 0) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(serious, null, 2));
    }
    expect(serious).toEqual([]);
  });
});

test.describe('axe a11y — TIMED_QUIZ engine', () => {
  test('zero serious or critical violations', async ({ page, request }) => {
    await signInAsTutor(page, request);
    const { shareToken, gameId } = await seed(page, 'TIMED_QUIZ');
    const studentPage = await page.context().newPage();
    await studentPage.goto(`/s/${shareToken}/play/${gameId}`);
    await expect(studentPage.getByTestId('timed-quiz-engine')).toBeVisible();
    const results = await new AxeBuilder({ page: studentPage })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    if (serious.length > 0) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(serious, null, 2));
    }
    expect(serious).toEqual([]);
  });
});
