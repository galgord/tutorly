import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:5174/api';

// Minimal valid WAV file header (44 bytes RIFF/WAVE). Smallest possible
// audio we can feed through the upload endpoint that passes server-side
// MIME sniffing.
const WAV_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
  0x66, 0x6d, 0x74, 0x20, 0x10, 0, 0, 0, 0x01, 0, 0x01, 0,
  0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 0x02, 0, 0x10, 0,
  0x64, 0x61, 0x74, 0x61, 0, 0, 0, 0,
]);

async function signIn(page: Page, request: APIRequestContext, lang = 'en'): Promise<void> {
  const email = `phase5-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
          title: 'Phase 5 voice lesson',
        }),
      });
      const j = (await r.json()) as { id: string };
      return j.id;
    },
    { csrf, studentId },
  );
}

/**
 * Upload a WAV blob via the API directly (bypassing the real
 * MediaRecorder dance). The recorder UI itself is exercised via the
 * "shows recorder controls" test below; this helper lets us drive the
 * end-to-end transcribe flow without faking MediaRecorder in the page.
 */
async function uploadAudioViaApi(
  page: Page,
  lessonId: string,
  durationSeconds = 15,
): Promise<{ status: number }> {
  const csrf = await page.evaluate(() =>
    decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
  );
  return page.evaluate(
    async ({ csrf, lessonId, durationSeconds, wavBytes }) => {
      const form = new FormData();
      const blob = new Blob([new Uint8Array(wavBytes)], { type: 'audio/wav' });
      form.append('audio', blob, 'fixture.wav');
      form.append('durationSeconds', String(durationSeconds));
      const r = await fetch(`/api/lessons/${lessonId}/audio`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': csrf },
        body: form,
      });
      return { status: r.status };
    },
    { csrf, lessonId, durationSeconds, wavBytes: Array.from(WAV_BYTES) },
  );
}

test.describe('voice feedback — upload + transcribe + review (LTR)', () => {
  test('voice tab uploads → fake Whisper transcribes → editor pre-fills → tutor saves', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    const studentId = await createStudent(page, 'Sara');
    const lessonId = await createLesson(page, studentId);

    await page.goto(`/lessons/${lessonId}`);
    await expect(page.getByTestId('lesson-detail')).toBeVisible();

    // Recorder is initially hidden behind the toggle; switch to voice.
    await page.getByTestId('feedback-mode-voice').click();
    await expect(page.getByTestId('voice-recorder')).toBeVisible();

    // Drive an upload via the API (avoids the MediaRecorder permissions
    // dance — that's tested separately in the "shows recorder controls"
    // case below).
    const upload = await uploadAudioViaApi(page, lessonId);
    expect(upload.status).toBe(202);

    // Eventually the lesson detail reflects the transcript. The polling
    // hook should pick this up within a few seconds.
    await expect(async () => {
      const text = await page.getByTestId('feedback-input').inputValue();
      expect(text.length).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });

    // The mode auto-switches back to text once transcription completes;
    // the "transcribed from voice" hint should be visible until save.
    await expect(page.getByTestId('feedback-mode-text')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('feedback-transcribed-hint')).toBeVisible();

    // Tutor edits the suggested transcript and saves.
    const editorText = await page.getByTestId('feedback-input').inputValue();
    await page.getByTestId('feedback-input').fill(editorText + ' (edited)');
    await page.getByTestId('feedback-save').click();
    await expect(page.getByTestId('feedback-toast')).toBeVisible();
  });

  test('voice tab shows recorder controls + start button respects mic-denied state', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    const studentId = await createStudent(page, 'Marco');
    const lessonId = await createLesson(page, studentId);

    await page.goto(`/lessons/${lessonId}`);
    await page.getByTestId('feedback-mode-voice').click();
    await expect(page.getByTestId('voice-recorder')).toBeVisible();
    await expect(page.getByTestId('voice-start')).toBeVisible();

    // Simulate mic denied by stubbing getUserMedia to reject; clicking
    // start should surface the friendly error.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        get: () => ({
          getUserMedia: () =>
            Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
        }),
      });
    });
    await page.getByTestId('voice-start').click();
    await expect(page.getByTestId('voice-error')).toBeVisible();
  });

  test('upload endpoint rejects non-audio bytes with 400', async ({ page, request }) => {
    await signIn(page, request);
    const studentId = await createStudent(page, 'NotAudio');
    const lessonId = await createLesson(page, studentId);

    const csrf = await page.evaluate(() =>
      decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
    );
    const status = await page.evaluate(
      async ({ csrf, lessonId }) => {
        const form = new FormData();
        const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
          type: 'audio/wav', // lie about the type to confirm server-side sniff catches it
        });
        form.append('audio', blob, 'fake.wav');
        form.append('durationSeconds', '10');
        const r = await fetch(`/api/lessons/${lessonId}/audio`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'x-csrf-token': csrf },
          body: form,
        });
        return r.status;
      },
      { csrf, lessonId },
    );
    expect(status).toBe(400);
  });

  test('upload endpoint rejects audio over the 5-min duration cap', async ({ page, request }) => {
    await signIn(page, request);
    const studentId = await createStudent(page, 'TooLong');
    const lessonId = await createLesson(page, studentId);
    const upload = await uploadAudioViaApi(page, lessonId, 600);
    expect(upload.status).toBe(400);
  });
});

test.describe('voice feedback (RTL)', () => {
  test('Hebrew tutor: recorder is visible + layout flips cleanly at all viewports', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'he');
    // The tutor row's locale defaults to `en` at signup; the api uses
    // that as the Whisper language hint. Update it via the /me endpoint
    // so the fake transcriber returns Hebrew text.
    const csrf = await page.evaluate(() =>
      decodeURIComponent(document.cookie.match(/tutor_csrf=([^;]+)/)?.[1] ?? ''),
    );
    await page.evaluate(
      async ({ csrf }) => {
        await fetch('/api/me', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({ locale: 'he' }),
        });
      },
      { csrf },
    );

    const studentId = await createStudent(page, 'דניאל');
    const lessonId = await createLesson(page, studentId);

    await page.goto(`/lessons/${lessonId}?lang=he`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByTestId('feedback-mode-voice').click();
    await expect(page.getByTestId('voice-recorder')).toBeVisible();

    for (const vw of [1280, 768, 320]) {
      await page.setViewportSize({ width: vw, height: 800 });
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `vw=${vw}`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }

    // Upload via API + verify the Hebrew-canned transcript lands in the
    // editor with the right content (fake transcriber is locale-aware).
    await page.setViewportSize({ width: 1280, height: 800 });
    const upload = await uploadAudioViaApi(page, lessonId);
    expect(upload.status).toBe(202);

    await expect(async () => {
      const text = await page.getByTestId('feedback-input').inputValue();
      expect(text).toMatch(/[֐-׿]/);
    }).toPass({ timeout: 15_000 });
  });
});
