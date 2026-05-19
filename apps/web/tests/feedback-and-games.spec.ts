import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:5174/api';

async function signIn(page: Page, request: APIRequestContext, lang = 'en'): Promise<void> {
  const email = `phase4-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function createManualLessonViaApi(
  page: Page,
  studentId: string,
  occurredAtIso: string,
): Promise<string> {
  const csrf = await page.evaluate(() =>
    decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
  );
  return page.evaluate(
    async ({ csrf, studentId, occurredAtIso }) => {
      const r = await fetch('/api/lessons', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ studentId, occurredAt: occurredAtIso, title: 'Phase 4 lesson' }),
      });
      const j = (await r.json()) as { id: string };
      return j.id;
    },
    { csrf, studentId, occurredAtIso },
  );
}

test.describe('lesson feedback + game generation (LTR)', () => {
  test('write feedback → generate fill-blank → review pool → edit → assign', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    const studentId = await createStudentViaApi(page, 'Sara');
    const lessonId = await createManualLessonViaApi(
      page,
      studentId,
      new Date(Date.now() - 86_400_000).toISOString(),
    );

    // Visit lesson detail.
    await page.goto(`/lessons/${lessonId}`);
    await expect(page.getByTestId('lesson-detail')).toBeVisible();
    await expect(page.getByTestId('feedback-editor')).toBeVisible();
    await expect(page.getByTestId('games-panel')).toBeVisible();

    // Generate-buttons start disabled until feedback exists.
    await expect(page.getByTestId('games-generate-fill-blank')).toBeDisabled();
    await expect(page.getByTestId('games-need-feedback')).toBeVisible();

    // Write feedback + save.
    await page.getByTestId('feedback-input').fill(
      'Sara confused ser/estar during exam. Drill physical vs emotional state.',
    );
    await expect(page.getByTestId('feedback-dirty-indicator')).toBeVisible();
    await page.getByTestId('feedback-save').click();
    await expect(page.getByTestId('feedback-toast')).toBeVisible();

    // Generate-button now enabled.
    await expect(page.getByTestId('games-generate-fill-blank')).toBeEnabled();
    await page.getByTestId('games-generate-fill-blank').click();

    // Review modal opens immediately; polls until the fake LLM completes.
    await expect(page.getByTestId('question-review-modal')).toBeVisible();
    // Wait for first question to render — fake LLM resolves quickly.
    await expect(page.locator('[data-testid^="review-question-"]').first()).toBeVisible({
      timeout: 10_000,
    });
    const questionCount = await page.locator('[data-testid^="review-question-"]').count();
    expect(questionCount).toBe(30); // default pool size

    // Edit the first question's prompt.
    const firstQuestion = page.locator('[data-testid^="review-question-"]').first();
    const promptId = await firstQuestion.getAttribute('data-testid');
    expect(promptId).toMatch(/^review-question-q_/);
    const qid = promptId!.replace('review-question-', '');
    await page.getByTestId(`review-prompt-${qid}`).fill('EDITED: She ___ to school.');
    await page.getByTestId('review-save').click();
    await expect(page.getByTestId('review-toast')).toBeVisible();

    // Assign to student.
    await page.getByTestId('review-assign').click();
    // Modal closes shortly after success.
    await expect(page.getByTestId('question-review-modal')).toBeHidden({ timeout: 3_000 });

    // Game card on the lesson detail now shows ASSIGNED status.
    await expect(page.locator('[data-testid^="games-status-"]').first()).toContainText(/Assigned/);
  });

  test('TIMED_QUIZ generation includes distractors', async ({ page, request }) => {
    await signIn(page, request);
    const studentId = await createStudentViaApi(page, 'Marco');
    const lessonId = await createManualLessonViaApi(
      page,
      studentId,
      new Date(Date.now() - 86_400_000).toISOString(),
    );
    await page.goto(`/lessons/${lessonId}`);
    await page.getByTestId('feedback-input').fill('Verb conjugation in past tense — irregular forms.');
    await page.getByTestId('feedback-save').click();
    await expect(page.getByTestId('feedback-toast')).toBeVisible();
    await page.getByTestId('games-generate-timed-quiz').click();
    await expect(page.getByTestId('question-review-modal')).toBeVisible();
    await expect(page.locator('[data-testid^="review-question-"]').first()).toBeVisible({
      timeout: 10_000,
    });
    // Distractors field is rendered for TIMED_QUIZ.
    const firstQ = page.locator('[data-testid^="review-question-"]').first();
    const tid = (await firstQ.getAttribute('data-testid'))!.replace('review-question-', '');
    const distractors = await page.getByTestId(`review-distractors-${tid}`).inputValue();
    expect(distractors.length).toBeGreaterThan(0);
    // 3 lines = 3 distractors.
    expect(distractors.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });

  test('generate refuses with friendly error when no feedback (server-side)', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    const studentId = await createStudentViaApi(page, 'NoFb');
    const lessonId = await createManualLessonViaApi(
      page,
      studentId,
      new Date(Date.now() - 86_400_000).toISOString(),
    );
    await page.goto(`/lessons/${lessonId}`);
    // Sanity: button is disabled. Force the API call via fetch to verify
    // the server-side guard returns a 400.
    const csrf = await page.evaluate(() =>
      decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
    );
    const status = await page.evaluate(
      async ({ csrf, lessonId }) => {
        const r = await fetch(`/api/lessons/${lessonId}/games`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({ type: 'FILL_BLANK' }),
        });
        return r.status;
      },
      { csrf, lessonId },
    );
    expect(status).toBe(400);
  });
});

test.describe('lesson feedback (RTL)', () => {
  test('Hebrew feedback flow — direction follows content, layout flips cleanly', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'he');
    const studentId = await createStudentViaApi(page, 'דניאל');
    const lessonId = await createManualLessonViaApi(
      page,
      studentId,
      new Date(Date.now() - 86_400_000).toISOString(),
    );

    await page.goto(`/lessons/${lessonId}?lang=he`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('feedback-editor')).toBeVisible();

    // No horizontal scrollbar at any viewport.
    for (const vw of [1280, 768, 320]) {
      await page.setViewportSize({ width: vw, height: 800 });
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `vw=${vw}`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }

    // Reset viewport, then write Hebrew feedback.
    await page.setViewportSize({ width: 1280, height: 800 });
    const feedbackInput = page.getByTestId('feedback-input');
    await feedbackInput.fill('דניאל התקשה היום עם פעלים בזמן הווה. כדאי לתרגל גוף ראשון.');
    // `dir="auto"` should leave the textarea visually RTL when content is Hebrew.
    const detectedDir = await feedbackInput.evaluate((el: HTMLElement) => el.dir);
    expect(detectedDir).toBe('auto');

    await page.getByTestId('feedback-save').click();
    await expect(page.getByTestId('feedback-toast')).toBeVisible();

    // Generate a fill-blank pool.
    await page.getByTestId('games-generate-fill-blank').click();
    await expect(page.getByTestId('question-review-modal')).toBeVisible();
    await expect(page.locator('[data-testid^="review-question-"]').first()).toBeVisible({
      timeout: 10_000,
    });

    // The fake LLM produces Hebrew questions when the locale is `he`.
    const firstQ = page.locator('[data-testid^="review-question-"]').first();
    const qid = (await firstQ.getAttribute('data-testid'))!.replace('review-question-', '');
    const promptValue = await page.getByTestId(`review-prompt-${qid}`).inputValue();
    expect(promptValue).toMatch(/[֐-׿]/); // contains Hebrew

    // Assign — modal closes, lesson detail shows ASSIGNED.
    await page.getByTestId('review-assign').click();
    await expect(page.getByTestId('question-review-modal')).toBeHidden({ timeout: 3_000 });
    await expect(page.locator('[data-testid^="games-status-"]').first()).toBeVisible();
  });
});

test.describe('calendar Add feedback student picker (Phase 3 deferred)', () => {
  // Skipped during the Calendar → Schedule rewrite: the new /schedule view
  // intentionally hides Google-only events while we re-design the attach flow.
  // Re-enable once the schedule surfaces Google events again.
  test.skip('Google-only event → student picker → creates lesson → lands on detail', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    const studentId = await createStudentViaApi(page, 'Calendar-Sara');

    // Seed the fake Google connection WITHOUT overriding events — that
    // way we share the canned `evt-past-1` ("Sara — Spanish lesson") fixture
    // with the other E2E specs. Passing an `events: []` here would replace
    // them and break parallel-running specs (the fake's event list is
    // module-scoped).
    const csrf = await page.evaluate(() =>
      decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
    );
    await page.evaluate(
      async ({ csrf }) => {
        await fetch('/api/__test__/google/fake-tokens', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({ calendarIds: ['cal-primary'] }),
        });
      },
      { csrf },
    );

    await page.goto('/calendar');
    await expect(page.getByTestId('calendar-page')).toBeVisible();
    // The canned past event row's Add-feedback button opens the picker.
    await page.getByTestId('calendar-add-feedback-evt-past-1').click();
    await expect(page.getByTestId('student-picker-modal')).toBeVisible();
    // Select Calendar-Sara from the picker.
    await page.getByTestId(`student-picker-row-${studentId}`).click();
    // Lesson created → navigate to its detail.
    await page.waitForURL(/\/lessons\/[^/]+/);
    await expect(page.getByTestId('lesson-detail')).toBeVisible();
    await expect(page.getByTestId('feedback-editor')).toBeVisible();
    // Detail shows the student name and the calendar source.
    await expect(page.getByTestId('lesson-detail-student')).toContainText('Calendar-Sara');
  });
});
