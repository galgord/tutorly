import { test, expect } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 8 PWA structural checks. The dev server doesn't serve the SW unless
// VITE_PWA_DEV=true (hot-reload + workbox don't mix), so these specs validate
// the production build artifacts directly — manifest validity, icon
// presence, and service-worker emission. A Lighthouse score check is
// deliberately deferred to Phase 10 (real Chrome + lighthouse CLI) and
// flagged in FOLLOWUPS.md.

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');

test.describe('Phase 8 — PWA build artifacts', () => {
  test.beforeAll(() => {
    test.skip(
      !existsSync(distDir),
      'apps/web/dist not present — run `pnpm --filter web build` before this spec',
    );
  });

  test('manifest.webmanifest parses as valid JSON', () => {
    const path = join(distDir, 'manifest.webmanifest');
    expect(existsSync(path), 'manifest.webmanifest must be emitted').toBe(true);
    const raw = readFileSync(path, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test('manifest declares all required PWA fields', () => {
    const raw = readFileSync(join(distDir, 'manifest.webmanifest'), 'utf8');
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    expect(manifest.name).toBe('Tutor App');
    expect(manifest.short_name).toBe('Tutor');
    expect(manifest.start_url).toBe('/dashboard');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.lang).toBeTruthy();
    expect(Array.isArray(manifest.icons)).toBe(true);

    const icons = manifest.icons as Array<{ src: string; sizes: string; purpose?: string }>;
    const sizes = icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    // At least one maskable variant.
    expect(icons.some((i) => i.purpose?.includes('maskable'))).toBe(true);
  });

  test('all icon files referenced by the manifest exist on disk', () => {
    const manifest = JSON.parse(
      readFileSync(join(distDir, 'manifest.webmanifest'), 'utf8'),
    ) as { icons: Array<{ src: string }> };
    for (const icon of manifest.icons) {
      // Manifest URLs are root-relative; strip the leading slash for fs.
      const filePath = join(distDir, icon.src.replace(/^\//, ''));
      expect(existsSync(filePath), `icon ${icon.src} missing`).toBe(true);
      // Reject empty placeholder files.
      expect(statSync(filePath).size).toBeGreaterThan(200);
    }
  });

  test('service worker (sw.js) is emitted by the PWA plugin', () => {
    const swPath = join(distDir, 'sw.js');
    expect(existsSync(swPath), 'sw.js must be emitted by vite-plugin-pwa').toBe(true);
    const sw = readFileSync(swPath, 'utf8');
    // Workbox precaches the app shell; the manifest-driven precache list is
    // a load-bearing signal that the SW will hydrate on install.
    expect(sw).toMatch(/precache|workbox/i);
  });

  test('built index.html links the manifest + theme-color + apple-touch-icon', () => {
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    expect(html).toMatch(/<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"/);
    expect(html).toMatch(/name="theme-color"/);
    expect(html).toMatch(/rel="apple-touch-icon"/);
  });

  test('Hebrew font woff2 files are NOT in the workbox precache list', () => {
    // The font files exist (they're emitted by @fontsource-variable/* on
    // demand) but excluding them from precache means English/Portuguese
    // users don't eagerly download Hebrew typography on first SW install.
    const sw = readFileSync(join(distDir, 'sw.js'), 'utf8');
    expect(sw).not.toMatch(/heebo-.*\.woff2/);
    expect(sw).not.toMatch(/rubik-.*\.woff2/);
  });

  test('Hebrew font @font-face CSS is in its own chunk (not in main bundle)', () => {
    // Scan all CSS files; the @font-face declarations should sit in a
    // separate chunk so the en/pt critical-path CSS doesn't carry them.
    const cssFiles = readdirSync(join(distDir, 'assets')).filter((f) => f.endsWith('.css'));
    expect(cssFiles.length).toBeGreaterThan(1); // at least the app shell + 1+ font chunk
    const fontChunks = cssFiles.filter((f) => {
      const c = readFileSync(join(distDir, 'assets', f), 'utf8');
      return /@font-face/.test(c) && /Heebo|Rubik/.test(c);
    });
    expect(fontChunks.length).toBeGreaterThanOrEqual(1);
    // The main shell CSS (the one linked from index.html) must not embed
    // @font-face for Heebo/Rubik.
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    const mainCssMatch = html.match(/href="\/(assets\/index-[^"]+\.css)"/);
    expect(mainCssMatch).toBeTruthy();
    const mainCssPath = mainCssMatch?.[1];
    expect(mainCssPath, 'index.html must reference a main CSS chunk').toBeTruthy();
    const mainCss = readFileSync(join(distDir, mainCssPath as string), 'utf8');
    expect(mainCss).not.toMatch(/@font-face[^}]*Heebo/);
    expect(mainCss).not.toMatch(/@font-face[^}]*Rubik/);
  });
});
