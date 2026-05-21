import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        hebrew: ['"Heebo"', '"Rubik"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Semantic tokens — backed by CSS vars in src/styles.css so a palette
        // swap is a one-file change. Use these in new code; existing pages can
        // migrate over time.
        brand: {
          50: 'var(--color-brand-50)',
          100: 'var(--color-brand-100)',
          200: 'var(--color-brand-200)',
          300: 'var(--color-brand-300)',
          400: 'var(--color-brand-400)',
          500: 'var(--color-brand-500)',
          600: 'var(--color-brand-600)',
          700: 'var(--color-brand-700)',
          800: 'var(--color-brand-800)',
          900: 'var(--color-brand-900)',
        },
        surface: {
          DEFAULT: 'var(--color-surface)',
          muted: 'var(--color-surface-muted)',
          sunken: 'var(--color-surface-sunken)',
        },
        line: {
          DEFAULT: 'var(--color-line)',
          strong: 'var(--color-line-strong)',
        },
        ink: {
          DEFAULT: 'var(--color-ink)',
          muted: 'var(--color-ink-muted)',
          subtle: 'var(--color-ink-subtle)',
        },
        // Translucent backdrop for modals/drawers — already has alpha baked in,
        // so use it as a plain `bg-scrim` (no `/opacity` modifier).
        scrim: 'var(--color-scrim)',
      },
    },
  },
  plugins: [],
};

export default config;
