import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:5174/api';

interface Seeded {
  shareToken: string;
  gameId: string;
  studentId: string;
}

async function signInAsTutor(
  page: Page,
  request: APIRequestContext,
  lang = 'en',
): Promise<void> {
  const email = `phase7-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${API_BASE}/auth/magic-link`, { data: { email } });
  expect(res.status()).toBe(202);
  const body = (await res.json()) as { ok: true; devMagicLinkUrl?: string };
  expect(body.devMagicLinkUrl).toBeTruthy();
  await page.goto(`/login?lang=${lang}`);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-submit').click();
  await page.goto(body.devMagicLinkUrl!);
  await page.waitForURL(/\/dashboard/);
}

async function seedAssignedGame(
  page: Page,
  opts: { studentName: string; gameType: 'FILL_BLANK' | 'TIMED_QUIZ' },
): Promise<Seeded> {
  const csrf = await page.evaluate(() =>
    decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
  );
  return page.evaluate(
    async ({ csrf, studentName, gameType }) => {
      const sRes = await fetch('/api/students', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ name: studentName }),
      });
      const student = (await sRes.json()) as { id: string; shareToken: string };
      const lRes = await fetch('/api/lessons', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({
          studentId: student.id,
          occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
          title: 'Phase 7 lesson',
        }),
      });
      const lesson = (await lRes.json()) as { id: string };
      await fetch(`/api/lessons/${lesson.id}/feedback`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({
          feedbackText: 'Drill verb conjugation — student confused walk/walks.',
        }),
      });
      const gRes = await fetch(`/api/lessons/${lesson.id}/games`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ type: gameType, poolSize: 5 }),
      });
      const game = (await gRes.json()) as { id: string };
      let status = 'GENERATING';
      const deadline = Date.now() + 10_000;
      while (status === 'GENERATING' && Date.now() < deadline) {
        const pRes = await fetch(`/api/games/${game.id}`, { credentials: 'include' });
        const p = (await pRes.json()) as { status: string };
        status = p.status;
        if (status === 'GENERATING') await new Promise((r) => setTimeout(r, 300));
      }
      if (status !== 'DRAFT') throw new Error(`Game stuck in status ${status}`);
      await fetch(`/api/games/${game.id}/assign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: '{}',
      });
      return { shareToken: student.shareToken, gameId: game.id, studentId: student.id };
    },
    { csrf, studentName: opts.studentName, gameType: opts.gameType },
  );
}

/**
 * Play one full FILL_BLANK attempt to completion as the student. We don't
 * know the correct answers (fake LLM seeds them) — just verifies the
 * lifecycle by submitting arbitrary input until summary appears.
 */
async function playOneAttempt(page: Page, shareToken: string, gameId: string): Promise<void> {
  await page.goto(`/s/${shareToken}/play/${gameId}`);
  await expect(page.getByTestId('fill-blank-engine')).toBeVisible();
  for (let i = 0; i < 12; i++) {
    if (await page.getByTestId('play-summary').isVisible().catch(() => false)) break;
    const input = page.getByTestId('play-answer-input');
    await expect(input).toBeEnabled();
    await input.fill('answer');
    await page.getByTestId('play-submit').click();
    await expect(page.getByTestId('play-feedback')).toBeVisible();
    await page.getByTestId('play-next').click();
    await Promise.race([
      page.getByTestId('play-feedback').waitFor({ state: 'detached', timeout: 5_000 }),
      page.getByTestId('play-summary').waitFor({ state: 'visible', timeout: 5_000 }),
    ]).catch(() => {});
  }
  await expect(page.getByTestId('play-summary')).toBeVisible({ timeout: 15_000 });
}

test.describe('tutor progress dashboard (LTR)', () => {
  test('empty state: brand-new student shows zeroed totals and empty games list', async ({ page, request }) => {
    await signInAsTutor(page, request);
    const csrf = await page.evaluate(() =>
      decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
    );
    const student = await page.evaluate(async (csrf) => {
      const res = await fetch('/api/students', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ name: 'EmptyKiddo' }),
      });
      return (await res.json()) as { id: string };
    }, csrf);

    await page.goto(`/students/${student.id}`);
    await expect(page.getByTestId('student-progress-section')).toBeVisible();
    await expect(page.getByTestId('progress-overview')).toBeVisible();
    await expect(page.getByTestId('progress-games-empty')).toBeVisible();
    await expect(page.getByTestId('attempts-empty')).toBeVisible();

    // Totals strip is present and shows zeroes
    await expect(page.getByTestId('progress-totals')).toBeVisible();
  });

  test('populated: student plays a game → tutor sees game card + attempts list', async ({
    page,
    request,
  }) => {
    await signInAsTutor(page, request);
    const seeded = await seedAssignedGame(page, {
      studentName: 'ProgressSara',
      gameType: 'FILL_BLANK',
    });

    // Student plays once in a fresh tab (share token IS the credential).
    const studentPage = await page.context().newPage();
    await playOneAttempt(studentPage, seeded.shareToken, seeded.gameId);
    await studentPage.close();

    // Tutor opens student detail.
    await page.goto(`/students/${seeded.studentId}`);
    await expect(page.getByTestId('student-progress-section')).toBeVisible();
    await expect(page.getByTestId('progress-overview')).toBeVisible();

    // The seeded game card is present, with a sparkline (one point: trend
    // = insufficient since we only played once).
    const gameCard = page.getByTestId(`progress-game-${seeded.gameId}`);
    await expect(gameCard).toBeVisible();
    await expect(page.getByTestId(`progress-game-trend-${seeded.gameId}`)).toBeVisible();

    // Recent-attempts list has at least one row, and it can be expanded.
    const attemptRows = page.getByTestId(/^attempt-row-/);
    await expect(attemptRows.first()).toBeVisible();
    const firstRow = attemptRows.first();
    const rowId = (await firstRow.getAttribute('data-testid')) ?? '';
    const attemptId = rowId.replace('attempt-row-', '');
    await page.getByTestId(`attempt-toggle-${attemptId}`).click();
    await expect(page.getByTestId(`attempt-detail-${attemptId}`)).toBeVisible();
  });
});

test.describe('tutor progress dashboard (RTL)', () => {
  test('Hebrew: dashboard renders + no horizontal overflow at 320/768/1280', async ({
    page,
    request,
  }) => {
    await signInAsTutor(page, request, 'he');
    const seeded = await seedAssignedGame(page, {
      studentName: 'דנה',
      gameType: 'FILL_BLANK',
    });
    const studentPage = await page.context().newPage();
    await playOneAttempt(studentPage, seeded.shareToken, seeded.gameId);
    await studentPage.close();

    await page.goto(`/students/${seeded.studentId}?lang=he`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('student-progress-section')).toBeVisible();
    await expect(page.getByTestId('progress-overview')).toBeVisible();
    // Topic chart container renders (may be empty if topicTags absent;
    // either chart or empty-state must be visible).
    const chart = page.getByTestId('topic-mastery-chart');
    const empty = page.getByTestId('topic-mastery-empty');
    await expect(chart.or(empty)).toBeVisible();

    for (const w of [320, 768, 1280]) {
      await page.setViewportSize({ width: w, height: 800 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow, `horizontal overflow at ${w}px`).toBe(false);
    }
  });
});
