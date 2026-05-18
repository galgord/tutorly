import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev, proxy /api/* to the NestJS api on :3000 so the browser sees the
// api as same-origin. Lets SameSite=Lax cookies set by the api be sent on
// subsequent SPA fetches without CORS + SameSite=None gymnastics.
export default defineConfig({
  plugins: [react()],
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
