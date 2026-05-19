import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Tests hit the api through the Vite dev-proxy at /api so cookies are scoped
// to the same origin as the SPA. Direct calls to :3000 won't work in dev.
const API_BASE = 'http://localhost:5174/api';

interface TutorTestSession {
  email: string;
  consumeUrl: string;
  consume(page: Page): Promise<void>;
}

/**
 * Requests a magic link from the real api. In non-prod the controller returns
 * the consume URL in the response body (`devMagicLinkUrl`) so tests don't need
 * to scrape mailer logs.
 */
async function newTutorSession(request: APIRequestContext): Promise<TutorTestSession> {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

test.describe('auth flow (LTR)', () => {
  test('happy path: login → magic link → dashboard → logout', async ({ page }) => {
    await page.goto('/login?lang=en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('h1')).toContainText('Sign in');

    // In non-prod the login form auto-redirects through `devMagicLinkUrl`, so
    // a single submit lands us on /dashboard — the "check your email"
    // interstitial only renders in prod (where the field is stripped).
    const altEmail = `ui-${Date.now()}@example.com`;
    await page.getByTestId('login-email').fill(altEmail);
    await page.getByTestId('login-submit').click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect(page.getByTestId('dashboard')).toContainText('Welcome');

    await page.getByTestId('logout-button').click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('protected route redirects unauthed user to /login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/dashboard?lang=en');
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows rate-limit error after 4 quick requests for the same email', async ({ page, request }) => {
    const email = `ratetest-${Date.now()}@example.com`;

    // Burn through the 3-per-minute allowance via API.
    for (let i = 0; i < 3; i++) {
      const res = await request.post(`${API_BASE}/auth/magic-link`, { data: { email } });
      expect(res.status()).toBe(202);
    }
    // Now the 4th from the UI should show the rate-limit error.
    await page.goto('/login?lang=en');
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('login-error')).toContainText(/Too many requests/i);
  });
});

test.describe('auth flow (RTL — Hebrew)', () => {
  test('login page renders RTL with Hebrew strings', async ({ page }) => {
    await page.goto('/login?lang=he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.locator('h1')).toContainText('התחברות');
    // Email input must stay LTR even in an RTL page.
    await expect(page.getByTestId('login-email')).toHaveAttribute('dir', 'ltr');
  });

  test('dashboard renders RTL after sign-in', async ({ page }) => {
    await page.goto('/login?lang=he');
    const email = `he-${Date.now()}@example.com`;
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-submit').click();

    // The consume redirect drops the query string; re-apply so the SPA picks
    // Hebrew on first paint of /dashboard.
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/dashboard?lang=he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('dashboard')).toContainText('ברוך שובך');
  });
});
