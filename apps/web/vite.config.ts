import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// In dev, proxy /api/* to the NestJS api on :3000 so the browser sees the
// api as same-origin. Lets SameSite=Lax cookies set by the api be sent on
// subsequent SPA fetches without CORS + SameSite=None gymnastics.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Service worker is OFF in dev by default — hot-reload + workbox don't
      // mix. Flip VITE_PWA_DEV=true when explicitly testing the install flow
      // against the dev server.
      devOptions: {
        enabled: process.env.VITE_PWA_DEV === 'true',
        type: 'module',
      },
      includeAssets: ['pwa-favicon.png'],
      workbox: {
        // Precache the app shell only; API responses are dynamic and never
        // safe to serve stale. SPA navigations fall back to the cached
        // index.html so the dashboard renders even offline (data fetches
        // surface the offline banner — full offline play is out of scope).
        //
        // EXCLUDE Hebrew font files (heebo / rubik) from the precache so
        // English / Portuguese users don't eagerly download Hebrew typography
        // on the first SW install. The `useDirection` hook dynamically
        // imports the CSS only when locale=he; once fetched, workbox's
        // default runtime cache picks it up.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        globIgnores: ['**/heebo-*.woff2', '**/rubik-*.woff2'],
        navigateFallback: 'index.html',
        // Don't intercept /api/* — let the SPA's fetch wrapper handle errors.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Cache font woff2 files at runtime so a returning Hebrew user
            // gets them from cache without forcing an English user to
            // download them up front.
            urlPattern: /\.woff2$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      manifest: {
        name: 'Tutor App',
        short_name: 'Tutor',
        description:
          'A companion tool for private tutors — connect Google Calendar, manage students, write feedback, and turn it into practice games.',
        // PWA manifest only supports a single `lang` + `dir` per build. We
        // pick en/ltr as the canonical; per-locale manifest builds are
        // documented in FOLLOWUPS.md as a Phase 10 consideration.
        lang: 'en',
        dir: 'ltr',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f8fafc',
        theme_color: '#0f172a',
        start_url: '/dashboard',
        scope: '/',
        icons: [
          {
            src: '/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
});
